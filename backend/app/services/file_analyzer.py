import json
from typing import List, Dict, Any


def detect_package_manager(filename: str, content: str) -> str:
    lowered = filename.lower()
    snippet = content[:200].lower()
    if "package.json" in lowered or '"dependencies"' in snippet:
        return "npm"
    if lowered.endswith("requirements.txt") or "pip" in snippet or "==" in snippet:
        return "pypi"
    if lowered.endswith("pom.xml"):
        return "maven"
    if lowered.endswith(".csproj") or "nuget" in snippet:
        return "nuget"
    return "unknown"


def parse_package_json(text: str) -> List[Dict[str, Any]]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    deps = []
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        for name, version in (data.get(section) or {}).items():
            deps.append({"name": name, "version": version})
    return deps


def parse_requirements(text: str) -> List[Dict[str, Any]]:
    deps = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "==" in line:
            name, ver = line.split("==", 1)
            deps.append({"name": name.strip(), "version": ver.strip()})
        else:
            deps.append({"name": line, "version": None})
    return deps


def analyze_file(filename: str, content: str) -> Dict[str, Any]:
    manager = detect_package_manager(filename, content)
    result = {"packageManager": manager, "dependencies": []}

    if manager == "npm":
        result["dependencies"] = parse_package_json(content)
        result["ecosystem"] = "npm"
    elif manager == "pypi":
        result["dependencies"] = parse_requirements(content)
        result["ecosystem"] = "pypi"
    elif manager == "maven":
        result["ecosystem"] = "maven"
    elif manager == "nuget":
        result["ecosystem"] = "nuget"
    else:
        result["ecosystem"] = "unknown"

    return result
