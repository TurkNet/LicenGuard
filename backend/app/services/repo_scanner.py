import os
import shutil
import subprocess
import tempfile
from typing import List, Dict, Any
from urllib.parse import urlparse, urlunparse


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


def _with_host_auth(repo_url: str) -> tuple[str, str | None]:
    """
    Insert provider-specific auth into the clone URL if available and applicable.
    Returns (clone_url, secret_used) so we can redact the secret from errors.
    """
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return repo_url, None

    host = (parsed.hostname or "").lower()
    port = f":{parsed.port}" if parsed.port else ""

    # GitHub personal access token
    if host in ("github.com", "www.github.com"):
        token = None
        for key in ("REPO_SCAN_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
            token = os.getenv(key)
            if token:
                break
        if not token:
            return repo_url, None
        netloc = f"{token}:x-oauth-basic@{parsed.hostname}{port}"
        clone_url = urlunparse(parsed._replace(netloc=netloc))
        return clone_url, token

    # Bitbucket app password (username + app password)
    if host in ("bitbucket.org", "www.bitbucket.org"):
        username = None
        for key in ("REPO_SCAN_BITBUCKET_USER", "BITBUCKET_USER", "BITBUCKET_USERNAME"):
            username = os.getenv(key)
            if username:
                break
        app_pw = None
        for key in ("REPO_SCAN_BITBUCKET_APP_PASSWORD", "BITBUCKET_APP_PASSWORD", "BITBUCKET_TOKEN"):
            app_pw = os.getenv(key)
            if app_pw:
                break
        if not username or not app_pw:
            return repo_url, None
        netloc = f"{username}:{app_pw}@{parsed.hostname}{port}"
        clone_url = urlunparse(parsed._replace(netloc=netloc))
        return clone_url, app_pw

    return repo_url, None


def clone_and_scan(repo_url: str) -> Dict[str, Any]:
    tmpdir = tempfile.mkdtemp(prefix="repo-scan-")
    try:

        # Prepare environment for OpenShift/K8s compatibility
        # 1. Set HOME to temp dir as random UIDs might not have a writable home
        # 2. Disable terminal prompts
        env = os.environ.copy()
        env["HOME"] = tmpdir
        env["GIT_TERMINAL_PROMPT"] = "0"

        clone_url, secret_used = _with_host_auth(repo_url)
        result = subprocess.run(
            ["git", "clone", "--depth", "1", clone_url, tmpdir],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=env,
        )
        if result.returncode != 0:
            stderr = (result.stderr or b"").decode(errors="ignore").strip()
            if secret_used:
                stderr = stderr.replace(secret_used, "***redacted***")
            hint = "Check that the repository URL is correct and reachable."
            lower_url = repo_url.lower()
            if not secret_used and "github.com" in lower_url:
                hint += " If it is private, set GITHUB_TOKEN (or GH_TOKEN/REPO_SCAN_GITHUB_TOKEN)."
            if not secret_used and "bitbucket.org" in lower_url:
                hint += " If it is private, set BITBUCKET_USER (or REPO_SCAN_BITBUCKET_USER/BITBUCKET_USERNAME) and BITBUCKET_APP_PASSWORD (or REPO_SCAN_BITBUCKET_APP_PASSWORD/BITBUCKET_TOKEN)."
            raise RuntimeError(f"git clone failed: {stderr or 'unknown error'}. {hint}")

        files = find_dependency_files(tmpdir)
        return {"files": files, "root": tmpdir}
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
