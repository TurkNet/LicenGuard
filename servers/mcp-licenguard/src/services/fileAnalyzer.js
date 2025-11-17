export function detectPackageManager(filename, content) {
  const lowered = (filename || "").toLowerCase();
  const snippet = (content || "").slice(0, 400).toLowerCase();
  if (lowered.includes("package.json") || snippet.includes('"dependencies"')) return "npm";
  if (lowered.endsWith("requirements.txt") || snippet.includes("pip") || snippet.includes("==")) return "pypi";
  if (lowered.endsWith("pom.xml")) return "maven";
  if (lowered.endsWith(".csproj") || snippet.includes("nuget")) return "nuget";
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

export function analyzeFile({ filename, content }) {
  const manager = detectPackageManager(filename || "unknown", content || "");
  const result = { packageManager: manager, ecosystem: manager, dependencies: [] };
  if (manager === "npm") {
    result.dependencies = parsePackageJson(content || "");
  } else if (manager === "pypi") {
    result.dependencies = parseRequirements(content || "");
  }
  return result;
}
