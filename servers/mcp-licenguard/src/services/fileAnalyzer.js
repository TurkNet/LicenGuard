export function detectPackageManager(filename, content) {
  const lowered = (filename || "").toLowerCase();
  const snippet = (content || "").slice(0, 400).toLowerCase();
  if (lowered.includes("package.json") || snippet.includes('"dependencies"')) return "npm";
  if (lowered.endsWith("requirements.txt") || snippet.includes("pip") || snippet.includes("==")) return "pypi";
  if (lowered.endsWith("pom.xml")) return "maven";
  if (lowered.endsWith(".csproj") || snippet.includes("nuget")) return "nuget";
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

export function analyzeFile({ filename, content }) {
  const manager = detectPackageManager(filename || "unknown", content || "");
  const result = { packageManager: manager, ecosystem: manager, dependencies: [] };
  if (manager === "npm") {
    result.dependencies = parsePackageJson(content || "");
  } else if (manager === "pypi") {
    result.dependencies = parseRequirements(content || "");
  } else if (manager === "go") {
    result.dependencies = parseGoMod(content || "");
  }
  return result;
}
