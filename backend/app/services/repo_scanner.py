import os
import shutil
import subprocess
import tempfile
from typing import List, Dict, Any


DEP_FILES = {
    # JavaScript / Node
    "package.json", "yarn.lock", "pnpm-lock.yaml",
    # Python
    "requirements.txt", "Pipfile", "pyproject.toml",
    # Java / Kotlin
    "pom.xml", "build.gradle", "build.gradle.kts",
    # .NET
    "csproj",
    # Go
    "go.mod", "vendor/modules.txt",
}


def is_dependency_file(filename: str) -> bool:
    lower = filename.lower()
    if lower.endswith(".csproj"):
        return True
    return lower in DEP_FILES


def find_dependency_files(root: str) -> List[str]:
    matches = []
    for dirpath, _, files in os.walk(root):
        for name in files:
            if is_dependency_file(name):
                rel = os.path.relpath(os.path.join(dirpath, name), root)
                matches.append(rel)
    return matches


def clone_and_scan(repo_url: str) -> Dict[str, Any]:
    tmpdir = tempfile.mkdtemp(prefix="repo-scan-")
    try:
        subprocess.check_call(
            ["git", "clone", "--depth", "1", repo_url, tmpdir],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        files = find_dependency_files(tmpdir)
        return {"files": files, "root": tmpdir}
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
