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

def parse_csproj_file(content: str) -> List[Dict[str, Any]]:
    """Parse a .csproj file content and extract PackageReference entries.

    Returns a list of dicts with keys: `name` and `version` (version may be None).
    Handles both attribute-style (`<PackageReference Include="Foo" Version="1.2.3" />`)
    and nested `<Version>` child elements. Works with XML namespaces.
    """
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return []

    deps: List[Dict[str, Any]] = []

    def local_name(tag: str) -> str:
        return tag.split('}')[-1] if '}' in tag else tag

    # Iterate through all elements and find PackageReference nodes
    for elem in root.iter():
        if local_name(elem.tag) != 'PackageReference':
            continue

        # Name can be in Include or Update attribute
        name = elem.get('Include') or elem.get('Update')

        # Version can be an attribute or a child <Version> element
        version = elem.get('Version')
        if version is None:
            for child in list(elem):
                if local_name(child.tag) == 'Version' and (child.text or '').strip():
                    version = (child.text or '').strip()
                    break

        if name:
            deps.append({"name": name, "version": version})

    return deps

def parse_requirements(text: str, filename: str="") -> List[Dict[str, Any]]:
    # Support two common formats:
    # 1) pip-style requirements (lines with optional ==version)
    # 2) NuGet packages.config XML
    text_stripped = text.strip()
    deps: List[Dict[str, Any]] = []

    if filename and filename.lower().endswith(".csproj"):
        deps = parse_csproj_file(content=text_stripped)
    elif (filename and filename.lower().find("packages.config") != -1):
        return parse_packages_config(text)
    else:
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


def parse_packages_config(text: str) -> List[Dict[str, Any]]:
    """Parse a NuGet `packages.config` XML or fall back to pip-style lines.

    Returns list of {name, version}.
    """
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
        result["dependencies"] = parse_requirements(content, filename=filename)
        result["ecosystem"] = "nuget"
    else:
        result["ecosystem"] = "unknown"

    return result
