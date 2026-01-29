import json
import xml.etree.ElementTree as ET
from typing import List, Dict, Any
import urllib.request
import urllib.error


def detect_package_manager(filename: str, content: str) -> str:
    lowered = filename.lower()
    snippet = content[:200].lower()
    if "package.json" in lowered or '"dependencies"' in snippet:
        return "npm"
    if lowered.endswith("requirements.txt") or "pip" in snippet:
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

def parse_maven_pom(text: str) -> List[Dict[str, Any]]:
    """Parse Maven pom.xml and extract dependencies.
    
    Returns list of {name, version, groupId, artifactId}.
    """
    deps: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    
    def local_name(tag: str) -> str:
        return tag.split('}')[-1] if '}' in tag else tag
    
    # Find all <dependency> elements (handle XML namespaces)
    for elem in root.iter():
        if local_name(elem.tag) != 'dependency':
            continue
        
        group_id = None
        artifact_id = None
        version = None
        scope = None
        
        for child in list(elem):
            child_name = local_name(child.tag)
            child_text = (child.text or '').strip()
            
            if child_name == 'groupId':
                group_id = child_text
            elif child_name == 'artifactId':
                artifact_id = child_text
            elif child_name == 'version':
                version = child_text
            elif child_name == 'scope':
                scope = child_text
        
        # Skip test dependencies
        if scope == 'test':
            continue
        
        if group_id and artifact_id:
            # Maven convention: groupId:artifactId
            name = f"{group_id}:{artifact_id}"
            deps.append({
                "name": name,
                "version": version,
                "groupId": group_id,
                "artifactId": artifact_id
            })
    
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


def get_latest_npm_version(package_name: str) -> str | None:
    """Get the latest version of an npm package."""
    try:
        url = f"https://registry.npmjs.org/{package_name}/latest"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read())
            return data.get("version")
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, Exception):
        return None


def get_latest_pypi_version(package_name: str) -> str | None:
    """Get the latest version of a PyPI package."""
    try:
        url = f"https://pypi.org/pypi/{package_name}/json"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read())
            info = data.get("info", {})
            version = info.get("version")
            return version
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, Exception):
        return None


def get_latest_maven_version(group_id: str, artifact_id: str) -> str | None:
    """Get the latest version of a Maven artifact."""
    try:
        # Maven Central search API
        url = f"https://search.maven.org/solrsearch/select?q=g:{group_id}+AND+a:{artifact_id}&rows=1&wt=json"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read())
            docs = data.get("response", {}).get("docs", [])
            if docs:
                return docs[0].get("latestVersion")
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, Exception):
        return None


def get_latest_nuget_version(package_name: str) -> str | None:
    """Get the latest version of a NuGet package."""
    try:
        url = f"https://api.nuget.org/v3-flatcontainer/{package_name.lower()}/index.json"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read())
            versions = data.get("versions", [])
            if versions:
                # Return the last (latest) version
                return versions[-1]
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, Exception):
        return None


def get_latest_go_version(module_path: str) -> str | None:
    """Get the latest version of a Go module."""
    try:
        # Go module proxy
        url = f"https://proxy.golang.org/{module_path}/@latest"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read())
            return data.get("Version")
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, Exception):
        return None


def enrich_dependencies_with_latest_versions(dependencies: List[Dict[str, Any]], ecosystem: str) -> List[Dict[str, Any]]:
    """Enrich dependencies that don't have versions with their latest versions.
    
    Supports: npm, pypi, maven, nuget, go
    """
    enriched = []
    for dep in dependencies:
        name = dep.get("name")
        version = dep.get("version")
        
        # Skip if version already exists
        if version:
            enriched.append(dep)
            continue
        
        latest_version = None
        version_source = None
        
        if ecosystem == "npm" and name:
            latest_version = get_latest_npm_version(name)
            version_source = "latest_from_npm"
        elif ecosystem == "pypi" and name:
            latest_version = get_latest_pypi_version(name)
            version_source = "latest_from_pypi"
        elif ecosystem == "maven" and name:
            # Maven format: groupId:artifactId
            if ":" in name:
                group_id, artifact_id = name.split(":", 1)
                latest_version = get_latest_maven_version(group_id, artifact_id)
                version_source = "latest_from_maven"
            # Also check if we have separate groupId/artifactId fields
            elif dep.get("groupId") and dep.get("artifactId"):
                latest_version = get_latest_maven_version(dep["groupId"], dep["artifactId"])
                version_source = "latest_from_maven"
        elif ecosystem == "nuget" and name:
            latest_version = get_latest_nuget_version(name)
            version_source = "latest_from_nuget"
        elif ecosystem == "go" and name:
            # Use full_name if available (includes module path), otherwise use name
            module_path = dep.get("full_name") or name
            latest_version = get_latest_go_version(module_path)
            version_source = "latest_from_goproxy"
        
        if latest_version:
            dep = dep.copy()
            dep["version"] = latest_version
            dep["version_source"] = version_source
        
        enriched.append(dep)
    
    return enriched


def analyze_file(filename: str, content: str) -> Dict[str, Any]:
    manager = detect_package_manager(filename, content)
    result = {"packageManager": manager, "dependencies": []}

    if manager == "npm":
        deps = parse_package_json(content)
        # Enrich with latest versions for packages without version
        result["dependencies"] = enrich_dependencies_with_latest_versions(deps, "npm")
        result["ecosystem"] = "npm"
    elif manager == "pypi":
        deps = parse_requirements(content)
        # Enrich with latest versions for packages without version
        result["dependencies"] = enrich_dependencies_with_latest_versions(deps, "pypi")
        result["ecosystem"] = "pypi"
    elif manager == "maven":
        deps = parse_maven_pom(content)
        # Enrich with latest versions for packages without version
        result["dependencies"] = enrich_dependencies_with_latest_versions(deps, "maven")
        result["ecosystem"] = "maven"
    elif manager == "nuget":
        deps = parse_requirements(content, filename=filename)
        # Enrich with latest versions for packages without version
        result["dependencies"] = enrich_dependencies_with_latest_versions(deps, "nuget")
        result["ecosystem"] = "nuget"
    else:
        result["ecosystem"] = "unknown"

    return result
