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

            # If HTTPS clone failed and we did not inject HTTP auth, try SSH fallback
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
                # Construct SSH clone URL: git@host:owner/repo.git
                path = parsed.path.lstrip('/')
                ssh_url = f"git@{host}:{path}"
                logger.info(f"Attempting SSH fallback for {repo_url} -> {ssh_url}")

                # Disable strict host key checking for this operation to avoid "Host key verification failed"
                # in non-interactive environments (containers).
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
                        # Success with SSH fallback
                        return {"files": find_dependency_files(tmpdir), "root": tmpdir}
                    ssh_stderr = (ssh_result.stderr or b"").decode(errors="ignore").strip()
                    logger.warning(f"SSH fallback failed: {ssh_stderr}")
                except Exception as e:
                    ssh_stderr = str(e)
                    logger.error(f"SSH fallback exception: {e}")

                # Redact nothing for SSH attempt
                full_err = f"HTTPS clone stderr: {stderr or 'unknown'}, SSH clone stderr: {ssh_stderr or 'unknown'}. {hint}"
                raise RuntimeError(f"git clone failed: {full_err}")

            raise RuntimeError(f"git clone failed: {stderr or 'unknown error'}. {hint}")

        files = find_dependency_files(tmpdir)
        return {"files": files, "root": tmpdir}
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
