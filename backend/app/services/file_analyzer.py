import json
import xml.etree.ElementTree as ET
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
    if lowered.find("packages.config") != -1 or "nuget" in snippet:
        return "nuget"
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
    # Support two common formats:
    # 1) pip-style requirements (lines with optional ==version)
    # 2) NuGet packages.config XML
    text_stripped = text.strip()
    # Heuristic: if it looks like XML and contains <package ... />, parse as packages.config
    if text_stripped.startswith("<?xml") or "<packages" in text_stripped or "<package" in text_stripped:
        deps: List[Dict[str, Any]] = []
        try:
            root = ET.fromstring(text)
            # Handle <packages><package id="..." version="..." /></packages>
            for pkg in root.findall('.//package'):
                name = pkg.get('id') or pkg.get('Id') or pkg.get('name')
                version = pkg.get('version') or pkg.get('Version')
                if name:
                    deps.append({"name": name, "version": version})
        except ET.ParseError:
            # Fall back to pip-style parsing if XML parsing fails
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

    # Default: pip-style requirements
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
        result["dependencies"] = parse_requirements(content)
        result["ecosystem"] = "nuget"
    else:
        result["ecosystem"] = "unknown"

    return result
