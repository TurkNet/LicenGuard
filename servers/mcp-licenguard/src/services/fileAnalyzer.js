export function detectPackageManager(filename, content) {
  const lowered = (filename || "").toLowerCase();
  const snippet = (content || "").slice(0, 400).toLowerCase();
  if (lowered.includes("package.json") || snippet.includes('"dependencies"')) return "npm";
  if (lowered.endsWith("requirements.txt") || snippet.includes("pip") || snippet.includes("==")) return "pypi";
  if (lowered.endsWith("pom.xml")) return "maven";
  if (lowered.endsWith(".csproj") || lowered.includes("packages.config") || snippet.includes("nuget")) return "nuget";
  if (lowered.endsWith("go.mod") || snippet.includes("module ") || snippet.includes("require")) return "go";
  return "unknown";
}

export function parsePackageJson(text) {
  try {
    const data = JSON.parse(text);
    const deps = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const map = data?.[section] ?? {};
      for (const [name, version] of Object.entries(map)) {
        deps.push({ name, version });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

export function parseRequirements(text) {
  const deps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes("==")) {
      const [name, ver] = line.split("==", 2);
      deps.push({ name: name.trim(), version: ver.trim() });
    } else {
      deps.push({ name: line, version: null });
    }
  }
  return deps;
}

export function parseGoMod(text) {
  const deps = [];
  const lines = text.split(/\r?\n/);
  let inRequireBlock = false;
  const stripHost = (value) => {
    if (!value) return value;
    const match = value.match(/^[^/]+\/(.+)/);
    return match ? match[1] : value;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("require (")) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line.startsWith(")")) {
      inRequireBlock = false;
      continue;
    }
    if (line.startsWith("require ")) {
      const parts = line.replace(/^require\s+/, "").split(/\s+/);
      if (parts[0]) deps.push({ name: stripHost(parts[0]), full_name: parts[0], version: parts[1] ?? null });
      continue;
    }
    if (inRequireBlock) {
      const parts = line.split(/\s+/);
      if (parts[0]) deps.push({ name: stripHost(parts[0]), full_name: parts[0], version: parts[1] ?? null });
    }
  }
  return deps;
}

export function parseMaven(text) {
  // Parse Maven pom.xml dependencies
  // Handles both <groupId>:<artifactId> and <version> within <dependency> blocks
  const deps = [];
  if (!text) return deps;

  // Match <dependency>...</dependency> blocks
  const depBlockRegex = /<dependency>([\s\S]*?)<\/dependency>/gi;
  let m;
  
  while ((m = depBlockRegex.exec(text))) {
    const depBlock = m[1];
    
    // Extract groupId, artifactId, and version from the dependency block
    const groupIdMatch = /<groupId>([^<]+)<\/groupId>/i.exec(depBlock);
    const artifactIdMatch = /<artifactId>([^<]+)<\/artifactId>/i.exec(depBlock);
    const versionMatch = /<version>([^<]+)<\/version>/i.exec(depBlock);
    const scopeMatch = /<scope>([^<]+)<\/scope>/i.exec(depBlock);
    
    if (groupIdMatch && artifactIdMatch) {
      const groupId = groupIdMatch[1].trim();
      const artifactId = artifactIdMatch[1].trim();
      const version = versionMatch ? versionMatch[1].trim() : null;
      const scope = scopeMatch ? scopeMatch[1].trim() : 'compile';
      
      // Skip test dependencies unless we want to include them
      if (scope === 'test') {
        continue; // Skip test dependencies
      }
      
      // Create full Maven artifact name: groupId:artifactId
      const name = `${groupId}:${artifactId}`;
      deps.push({ name, version, groupId, artifactId });
    }
  }

  return deps;
}

export function parseNuget(text) {
  // Parse two common NuGet formats:
  // 1) packages.config entries: <package id="Name" version="1.2.3" ... />
  // 2) SDK-style .csproj PackageReference entries:
  //    <PackageReference Include="Name" Version="1.2.3" />
  //    or
  //    <PackageReference Include="Name">\n    //      <Version>1.2.3</Version>\n    //    </PackageReference>

  const deps = [];
  if (!text) return deps;

  // packages.config <package id="..." version="..." />
  const pkgRegex = /<package\b[^>]*\bid=["']([^"']+)["'][^>]*\bversion=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = pkgRegex.exec(text))) {
    deps.push({ name: m[1], version: m[2] });
  }

  // PackageReference Include="..." Version="..." (single tag)
  const prInlineRegex = /<PackageReference\b[^>]*\bInclude=["']([^"']+)["'][^>]*\bVersion=["']([^"']+)["'][^>]*\/?>/gi;
  while ((m = prInlineRegex.exec(text))) {
    deps.push({ name: m[1], version: m[2] });
  }

  // PackageReference with nested <Version> tag
  const prBlockRegex = /<PackageReference\b[^>]*\bInclude=["']([^"']+)["'][^>]*>([\s\S]*?)<\/PackageReference>/gi;
  let inner;
  while ((m = prBlockRegex.exec(text))) {
    const includeName = m[1];
    inner = m[2];
    const verMatch = /<Version>([^<]+)<\/Version>/i.exec(inner);
    const version = verMatch ? verMatch[1].trim() : null;
    deps.push({ name: includeName, version });
  }

  // Deduplicate by name (keep first seen version)
  const seen = new Map();
  for (const d of deps) {
    const key = (d.name || '').toLowerCase();
    if (!seen.has(key)) seen.set(key, d);
  }
  return Array.from(seen.values());
}

async function getLatestNpmVersion(packageName) {
  /**Get the latest version of an npm package.*/
  try {
    const url = `https://registry.npmjs.org/${packageName}/latest`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.version || null;
  } catch (error) {
    return null;
  }
}

async function getLatestPypiVersion(packageName) {
  /**Get the latest version of a PyPI package.*/
  try {
    const url = `https://pypi.org/pypi/${packageName}/json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.info?.version || null;
  } catch (error) {
    return null;
  }
}

async function getLatestMavenVersion(groupId, artifactId) {
  /**Get the latest version of a Maven artifact.*/
  try {
    const url = `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}&rows=1&wt=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    const docs = data?.response?.docs;
    if (docs && docs.length > 0) {
      return docs[0]?.latestVersion || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function getLatestNugetVersion(packageName) {
  /**Get the latest version of a NuGet package.*/
  try {
    const url = `https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    const versions = data?.versions;
    if (versions && versions.length > 0) {
      // Return the last (latest) version
      return versions[versions.length - 1];
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function getLatestGoVersion(modulePath) {
  /**Get the latest version of a Go module.*/
  try {
    const url = `https://proxy.golang.org/${modulePath}/@latest`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.Version || null;
  } catch (error) {
    return null;
  }
}

async function enrichDependenciesWithLatestVersions(dependencies, ecosystem) {
  /**Enrich dependencies that don't have versions with their latest versions.
  
  Supports: npm, pypi, maven, nuget, go
  */
  const enriched = [];
  for (const dep of dependencies) {
    const name = dep.name;
    const version = dep.version;
    
    // Skip if version already exists
    if (version) {
      enriched.push(dep);
      continue;
    }
    
    let latestVersion = null;
    let versionSource = null;
    
    if (ecosystem === "npm" && name) {
      latestVersion = await getLatestNpmVersion(name);
      versionSource = "latest_from_npm";
    } else if (ecosystem === "pypi" && name) {
      latestVersion = await getLatestPypiVersion(name);
      versionSource = "latest_from_pypi";
    } else if (ecosystem === "maven" && name) {
      // Maven format: groupId:artifactId
      if (name.includes(":")) {
        const [groupId, artifactId] = name.split(":", 2);
        latestVersion = await getLatestMavenVersion(groupId, artifactId);
        versionSource = "latest_from_maven";
      } else if (dep.groupId && dep.artifactId) {
        latestVersion = await getLatestMavenVersion(dep.groupId, dep.artifactId);
        versionSource = "latest_from_maven";
      }
    } else if (ecosystem === "nuget" && name) {
      latestVersion = await getLatestNugetVersion(name);
      versionSource = "latest_from_nuget";
    } else if (ecosystem === "go" && name) {
      // Use full_name if available (includes module path), otherwise use name
      const modulePath = dep.full_name || name;
      latestVersion = await getLatestGoVersion(modulePath);
      versionSource = "latest_from_goproxy";
    }
    
    if (latestVersion) {
      enriched.push({
        ...dep,
        version: latestVersion,
        version_source: versionSource
      });
    } else {
      enriched.push(dep);
    }
  }
  
  return enriched;
}

export async function analyzeFile({ filename, content }) {
  const manager = detectPackageManager(filename || "unknown", content || "");
  const result = { packageManager: manager, ecosystem: manager, dependencies: [] };
  
  let deps = [];
  if (manager === "npm") {
    deps = parsePackageJson(content || "");
    // Enrich with latest versions for packages without version
    deps = await enrichDependenciesWithLatestVersions(deps, "npm");
  } else if (manager === "pypi") {
    deps = parseRequirements(content || "");
    // Enrich with latest versions for packages without version
    deps = await enrichDependenciesWithLatestVersions(deps, "pypi");
  } else if (manager === "go") {
    deps = parseGoMod(content || "");
    // Enrich with latest versions for packages without version
    deps = await enrichDependenciesWithLatestVersions(deps, "go");
  } else if (manager === "maven") {
    deps = parseMaven(content || "");
    // Enrich with latest versions for packages without version
    deps = await enrichDependenciesWithLatestVersions(deps, "maven");
  } else if (manager === "nuget") {
    deps = parseNuget(content || "");
    // Enrich with latest versions for packages without version
    deps = await enrichDependenciesWithLatestVersions(deps, "nuget");
  }
  
  result.dependencies = deps;
  return result;
}
