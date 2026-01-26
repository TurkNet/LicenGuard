import logging
import os
import shutil
import subprocess
import tempfile
from typing import List, Dict, Any
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)


DEP_FILES = {
    # JavaScript / Node
    "package.json", "yarn.lock", "pnpm-lock.yaml",
    # Python
    "requirements.txt", "Pipfile", "pyproject.toml",
    # Java / Kotlin
    "pom.xml", "build.gradle", "build.gradle.kts",
    # .NET
    "packages.config",
    ".csproj",
    # Go
    "go.mod", "vendor/modules.txt",
}


def is_dependency_file(filename: str) -> bool:
    lower = filename.lower()

    if lower.endswith(".csproj"):
        return True
    return lower in DEP_FILES


# Common directories and files to ignore during scanning
IGNORED_DIRS = {
    "node_modules",
    "build",
    "dist",
    ".git",
    ".svn",
    ".hg",
    "vendor",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".venv",
    "venv",
    "env",
    ".env",
    "target",
    "bin",
    "obj",
    ".idea",
    ".vscode",
    ".vs",
    "coverage",
    ".coverage",
    ".nyc_output",
    ".next",
    "out",
    ".cache",
    "tmp",
    "temp",
    ".tmp",
    ".temp",
}


def _should_ignore_path(path: str) -> bool:
    """
    Check if a path should be ignored based on common ignore patterns.
    Path can be absolute or relative.
    """
    # Normalize path separators
    normalized = path.replace("\\", "/")
    parts = normalized.split("/")
    
    # Check if any part matches ignored directories
    for part in parts:
        if part in IGNORED_DIRS:
            return True
        # Ignore hidden directories (starting with .) except for specific files
        if part.startswith(".") and part not in [".", ".."]:
            # Allow .csproj files (they are dependency files, not directories)
            if part.endswith(".csproj"):
                continue
            # Ignore other hidden directories
            return True
    
    return False


def find_dependency_files(root: str) -> List[str]:
    """
    Find dependency files in a repository, excluding common build/ignore directories.
    """
    matches = []
    root_abs = os.path.abspath(root)
    
    for dirpath, dirnames, files in os.walk(root):
        # Prune ignored directories from os.walk
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
        
        # Check if current directory should be ignored
        rel_dir = os.path.relpath(dirpath, root)
        if _should_ignore_path(rel_dir):
            continue
        
        for name in files:
            if is_dependency_file(name):
                rel = os.path.relpath(os.path.join(dirpath, name), root)
                # Double-check the full path isn't in an ignored directory
                if not _should_ignore_path(rel):
                    matches.append(rel)
    
    return matches


def _with_host_auth(repo_url: str) -> tuple[str, str | None]:
    """
    Insert provider-specific auth into the clone URL if available and applicable.
    Returns (clone_url, secret_used) so we can redact the secret from errors.
    """
    logger.info(f"Preparing auth for repo URL: {repo_url}")
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
                logger.info(f"Found GitHub token in env var {key}")
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
                logger.info(f"Found Bitbucket username in env var {key}")
                break

        app_pw = None
        for key in ("REPO_SCAN_BITBUCKET_APP_PASSWORD", "BITBUCKET_APP_PASSWORD", "BITBUCKET_TOKEN" ,"BITBUCKET_BASIC_TOKEN"):
            app_pw = os.getenv(key)
            if app_pw:
                logger.info(f"Found Bitbucket app password in env var {key}")
                break
        if not username or not app_pw:
            return repo_url, None
        netloc = f"{username}:{app_pw}@{parsed.hostname}{port}"
        clone_url = urlunparse(parsed._replace(netloc=netloc))
        return clone_url, app_pw

    return repo_url, None


# NOTE: `clone_and_scan` removed — use `clone_repository` + `scan_repository` instead.


def clone_repository(repo_url: str, target_dir: str | None = None) -> str:
    """
    Clone the repository and return the path to the cloned repo (root directory).
    If `target_dir` is not provided a temp dir will be created.
    """
    tmpdir = target_dir or tempfile.mkdtemp(prefix="repo-scan-")
    created_tmp = target_dir is None

    # Prepare minimal env for non-interactive containers
    env = os.environ.copy()
    env["HOME"] = tmpdir
    env["GIT_TERMINAL_PROMPT"] = "0"

    clone_url, secret_used = _with_host_auth(repo_url)
    result = subprocess.run(
        ["git", "clone", "--depth", "1", "--single-branch", "--filter=blob:none", clone_url, tmpdir],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=env,
    )
    if result.returncode == 0:
        return tmpdir

    stderr = (result.stderr or b"").decode(errors="ignore").strip()
    if secret_used:
        stderr = stderr.replace(secret_used, "***redacted***")

    logger.warning(f"HTTPS clone failed for {repo_url}: {stderr}")

    hint = "Check that the repository URL is correct and reachable."
    lower_url = repo_url.lower()
    is_github = "github.com" in lower_url
    is_bitbucket = "bitbucket.org" in lower_url

    if not secret_used:
        if is_github:
            hint += " For private repos, set GITHUB_TOKEN."
        elif is_bitbucket:
            hint += " For private repos, set BITBUCKET_USER and BITBUCKET_APP_PASSWORD."
        else:
            hint += " For private repos, ensure authentication credentials are provided via environment variables."

    if "terminal prompts disabled" in stderr:
        hint += " Terminal prompts are disabled. You must provide credentials (env vars) or use SSH with keys."

    # Try SSH fallback if appropriate
    try_ssh_fallback = False
    has_ssh = shutil.which("ssh") is not None
    if not has_ssh:
        hint += " SSH client not found, SSH fallback disabled."

    try:
        parsed = urlparse(repo_url)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme in ("http", "https")) and (not secret_used) and host in ("github.com", "www.github.com", "bitbucket.org", "www.bitbucket.org") and has_ssh:
            try_ssh_fallback = True
    except Exception:
        try_ssh_fallback = False

    if try_ssh_fallback:
        path = parsed.path.lstrip('/')
        ssh_url = f"git@{host}:{path}"
        logger.info(f"Attempting SSH fallback for {repo_url} -> {ssh_url}")

        ssh_env = env.copy()
        ssh_env["GIT_SSH_COMMAND"] = "ssh -o StrictHostKeyChecking=no"

        try:
            ssh_result = subprocess.run(
                ["git", "clone", "--depth", "1", ssh_url, tmpdir],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                env=ssh_env,
            )
            if ssh_result.returncode == 0:
                return tmpdir
            ssh_stderr = (ssh_result.stderr or b"").decode(errors="ignore").strip()
            logger.warning(f"SSH fallback failed: {ssh_stderr}")
        except Exception as e:
            ssh_stderr = str(e)
            logger.error(f"SSH fallback exception: {e}")

        full_err = f"HTTPS clone stderr: {stderr or 'unknown'}, SSH clone stderr: {ssh_stderr or 'unknown'}. {hint}"
        # cleanup if we created tmpdir here
        if created_tmp:
            shutil.rmtree(tmpdir, ignore_errors=True)
        raise RuntimeError(f"git clone failed: {full_err}")

    # No SSH fallback possible
    if created_tmp:
        shutil.rmtree(tmpdir, ignore_errors=True)
    raise RuntimeError(f"git clone failed: {stderr or 'unknown error'}. {hint}")


def scan_repository(root: str) -> Dict[str, Any]:
    """
    Scan a cloned repository directory for dependency files and return
    the same shape as the original `clone_and_scan` (files + root).
    """
    if not root or not os.path.isdir(root):
        raise RuntimeError("scan_repository: invalid root path")
    files = find_dependency_files(root)
    return {"files": files, "root": root}


def list_repository_packages(root: str) -> List[Dict[str, Any]]:
    """
    Return a list of dependency-file summaries found in a cloned repository.
    Each item is {"path": relative_path, "report": <local analyze_file report>}.

    This uses the local file analyzer (no MCP HTTP calls) so it's safe to call
    in non-networked contexts and suitable for UI previews.
    """
    if not root or not os.path.isdir(root):
        raise RuntimeError("list_repository_packages: invalid root path")

    summaries: List[Dict[str, Any]] = []
    try:
        # Import locally to avoid circular imports at module import time
        from .file_analyzer import analyze_file as local_analyze_file
    except Exception:
        local_analyze_file = None

    for rel in find_dependency_files(root):
        full = os.path.join(root, rel)
        try:
            with open(full, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()
            if local_analyze_file:
                report = local_analyze_file(rel, content)
            else:
                report = {"packageManager": "unknown", "dependencies": []}
        except Exception as e:
            report = {"error": str(e), "packageManager": "unknown", "dependencies": []}
        summaries.append({"path": rel, "report": report})

    return summaries
