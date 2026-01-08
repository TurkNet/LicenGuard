from fastapi import APIRouter, Query, UploadFile, File, HTTPException
import os
import shutil
from typing import Any, Dict, List, Optional
from ..controllers.library_controller import (
    add_version,
    create_library,
    get_library,
    list_libraries,
    search_libraries,
    search_libraries_local,
    update_library
)
from ..controllers.repository_scan_controller import create_repository_scan
from ..models.library import (
    LibraryCreate,
    LibraryDocument,
    LibrarySearchResponse,
    LibraryUpdate,
    VersionModel
)
from ..models.repository_scan import RepositoryScanCreate
from ..services.mcp_client import get_mcp_http_client, MCPClientError
from ..services.repo_scanner import (
    clone_repository,
    scan_repository,
    list_repository_packages,
)
from urllib.parse import urlparse


router = APIRouter(prefix='/libraries', tags=['libraries'])


def normalize_version(ver):
    return (ver or '').lstrip('^').lstrip('v').strip()


def compute_risk_from_license(license_name=None, license_summary=None, confidence=None):
    summaries = license_summary or []
    text_parts = []
    emoji_parts = []
    for item in summaries:
        if isinstance(item, dict):
            if item.get('summary'):
                text_parts.append(item['summary'])
            if item.get('emoji'):
                emoji_parts.append(item['emoji'])
        else:
            text_parts.append(str(item))
    haystack = ' '.join([license_name or '', *text_parts]).lower()
    has_strong = 'agpl' in haystack or 'gpl' in haystack or 'sspl' in haystack or 'copyleft' in haystack or any(
        '🔴' in e or '🚫' in e for e in emoji_parts
    )
    has_weak = 'lgpl' in haystack or 'mpl' in haystack or 'cddl' in haystack or any(
        '🟠' in e or '🟡' in e for e in emoji_parts
    )
    has_perm = 'mit' in haystack or 'apache' in haystack or 'bsd' in haystack or 'isc' in haystack or any(
        '🟢' in e or '✅' in e for e in emoji_parts
    )
    level = 'unknown'
    base = 50
    if has_strong:
        level = 'high'
        base = 90
    elif has_weak:
        level = 'medium'
        base = 60
    elif has_perm:
        level = 'low'
        base = 10
    conf = confidence if isinstance(confidence, (int, float)) else 1
    score = min(100, max(0, round(base * conf)))
    reason = 'based on detected license hints'
    if has_strong:
        reason = 'strong copyleft indicators (e.g., GPL/AGPL/SSPL)'
    elif has_weak:
        reason = 'weak/limited copyleft indicators (e.g., LGPL/MPL)'
    elif has_perm:
        reason = 'permissive license indicators (e.g., MIT/Apache/BSD)'
    explanation = f"{level} risk — score {score}/100 {reason}"
    return {'level': level, 'score': score, 'explanation': explanation}


def _infer_repo_meta(repo_url: str) -> tuple[str, str]:
    parsed = urlparse(repo_url)
    platform = (parsed.hostname or '').split('.')[-2] if parsed.hostname else 'unknown'
    path_parts = (parsed.path or '').strip('/').split('/')
    repo_name = '/'.join(path_parts[:2]) if len(path_parts) >= 2 else (path_parts[0] if path_parts else 'unknown')
    return platform or 'unknown', repo_name or 'unknown'


def pick_version_match(versions, target):
    if not versions:
        return None
    if target:
        for ver in versions:
            if normalize_version(getattr(ver, 'version', None) or ver.get('version')).lower() == target.lower():
                return ver
    return versions[0]


async def resolve_dependency_entry(dep: Dict[str, Any], relpath: str, report: Dict[str, Any]) -> Dict[str, Any]:
    """
    Look up dependency in Mongo first; if missing, fall back to MCP search and persist the result.
    Returns an enriched dependency dict with risk data and sources.
    """
    name = dep.get('name')
    if not name:
        return {**dep, "sources": [relpath]}

    version_raw = dep.get('version')
    version_norm = normalize_version(version_raw)
    ecosystem = dep.get('ecosystem') or report.get('ecosystem') or report.get('packageManager') or 'unknown'
    query = f"{name} {version_norm}" if version_norm else name

    search_res = await search_libraries(query)
    match_doc: Optional[LibraryDocument] = None

    if search_res.results:
        match_doc = search_res.results[0]
        if search_res.source == 'mcp':
            # Persist MCP discovery so future lookups use Mongo
            payload = LibraryCreate(
                name=match_doc.name,
                ecosystem=match_doc.ecosystem or ecosystem,
                description=match_doc.description,
                repository_url=match_doc.repository_url,
                officialSite=getattr(match_doc, 'officialSite', None),
                versions=[VersionModel(**v.model_dump()) for v in (match_doc.versions or [])]
            )
            try:
                match_doc = await create_library(payload)
            except Exception:
                # If persistence fails, continue using in-memory match
                pass
    elif search_res.discovery and search_res.discovery.matches:
        best = search_res.discovery.matches[0]
        target_version = normalize_version(getattr(best.versions[0], 'version', None) if best.versions else version_norm) or version_norm or 'unknown'
        # Compute risk if MCP did not provide
        version_model = best.versions[0] if best.versions else None
        risk = compute_risk_from_license(
            getattr(version_model, 'license_name', None) if version_model else None,
            getattr(version_model, 'license_summary', None) if version_model else None,
            getattr(version_model, 'confidence', None) if version_model else None
        )
        def get_comp(vm, key):
            if vm is None:
                return None
            if isinstance(vm, dict):
                return vm.get(key)
            return getattr(vm, key, None)
        payload = LibraryCreate(
            name=best.name or name,
            ecosystem=best.ecosystem or ecosystem,
            description=best.description,
            repository_url=best.repository_url or best.officialSite,
            officialSite=best.officialSite or best.repository_url,
            versions=[
                VersionModel(
                    version=target_version,
                    license_name=getattr(version_model, 'license_name', None) if version_model else None,
                    license_url=getattr(version_model, 'license_url', None) if version_model else None,
                    notes=getattr(version_model, 'notes', None) if version_model else None,
                    license_summary=getattr(version_model, 'license_summary', None) or [],
                    evidence=getattr(version_model, 'evidence', None) or [],
                    confidence=getattr(version_model, 'confidence', None),
                    risk_level=getattr(version_model, 'risk_level', None) or risk['level'],
                    risk_score=getattr(version_model, 'risk_score', None) or risk['score'],
                    risk_score_explanation=getattr(version_model, 'risk_score_explanation', None) or risk.get('explanation'),
                    license_risk_score=get_comp(version_model, 'license_risk_score'),
                    security_risk_score=get_comp(version_model, 'security_risk_score'),
                    maintenance_risk_score=get_comp(version_model, 'maintenance_risk_score'),
                    usage_context_risk_score=get_comp(version_model, 'usage_context_risk_score'),
                )
            ]
        )
        try:
            match_doc = await create_library(payload)
        except Exception:
            from datetime import datetime
            fallback = payload.model_dump()
            fallback['created_at'] = datetime.utcnow()
            fallback['updated_at'] = datetime.utcnow()
            match_doc = LibraryDocument(**fallback)  # type: ignore

    risk_score = dep.get('risk_score')
    risk_level = dep.get('risk_level')
    risk_explanation = dep.get('risk_score_explanation')
    license_risk_score = dep.get('license_risk_score')
    security_risk_score = dep.get('security_risk_score')
    maintenance_risk_score = dep.get('maintenance_risk_score')
    usage_context_risk_score = dep.get('usage_context_risk_score')
    library_id = None
    repository_url = None

    if match_doc:
        library_id = str(getattr(match_doc, 'id', None) or getattr(match_doc, '_id', None) or '') or None
        repository_url = getattr(match_doc, 'repository_url', None)
        version_match = pick_version_match(getattr(match_doc, 'versions', None) or [], version_norm)
        if version_match:
            risk_score = risk_score or getattr(version_match, 'risk_score', None) or (version_match.get('risk_score') if isinstance(version_match, dict) else None)
            risk_level = risk_level or getattr(version_match, 'risk_level', None) or (version_match.get('risk_level') if isinstance(version_match, dict) else None)
            risk_explanation = risk_explanation or getattr(version_match, 'risk_score_explanation', None) or (version_match.get('risk_score_explanation') if isinstance(version_match, dict) else None)
            license_risk_score = license_risk_score or getattr(version_match, 'license_risk_score', None) or (version_match.get('license_risk_score') if isinstance(version_match, dict) else None)
            security_risk_score = security_risk_score or getattr(version_match, 'security_risk_score', None) or (version_match.get('security_risk_score') if isinstance(version_match, dict) else None)
            maintenance_risk_score = maintenance_risk_score or getattr(version_match, 'maintenance_risk_score', None) or (version_match.get('maintenance_risk_score') if isinstance(version_match, dict) else None)
            usage_context_risk_score = usage_context_risk_score or getattr(version_match, 'usage_context_risk_score', None) or (version_match.get('usage_context_risk_score') if isinstance(version_match, dict) else None)
            license_summary = getattr(version_match, 'license_summary', None) if not isinstance(version_match, dict) else version_match.get('license_summary')
            license_name = getattr(version_match, 'license_name', None) if not isinstance(version_match, dict) else version_match.get('license_name')
            confidence = getattr(version_match, 'confidence', None) if not isinstance(version_match, dict) else version_match.get('confidence')
            if risk_score is None or risk_level is None:
                computed = compute_risk_from_license(license_name, license_summary, confidence)
                risk_score = risk_score or computed['score']
                risk_level = risk_level or computed['level']
                risk_explanation = risk_explanation or computed.get('explanation')
            elif not risk_explanation and (license_name or license_summary):
                computed = compute_risk_from_license(license_name, license_summary, confidence)
                risk_explanation = computed.get('explanation')

    enriched = {
        "name": name,
        "version": version_raw,
        "ecosystem": ecosystem,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "risk_score_explanation": risk_explanation,
        "license_risk_score": license_risk_score,
        "security_risk_score": security_risk_score,
        "maintenance_risk_score": maintenance_risk_score,
        "usage_context_risk_score": usage_context_risk_score,
        "sources": [relpath],
        "library_id": library_id,
        "repository_url": repository_url
    }
    return enriched


@router.get('/', response_model=List[LibraryDocument])
async def handle_list_libraries(limit: int = Query(50, ge=1, le=500, description='Max items to return')):
    return await list_libraries(limit)


@router.get('/search', response_model=LibrarySearchResponse)
async def handle_search_libraries(q: str = Query(..., min_length=1, description='Library name or keyword')):
    return await search_libraries(q)


@router.get('/search/local', response_model=LibrarySearchResponse)
async def handle_search_libraries_local(q: str = Query(..., min_length=1, description='Library name or keyword')):
    return await search_libraries_local(q)


@router.post('/', response_model=LibraryDocument, status_code=201)
async def handle_create_library(payload: LibraryCreate):
    return await create_library(payload)


@router.get('/{library_id}', response_model=LibraryDocument)
async def handle_get_library(library_id: str):
    return await get_library(library_id)


@router.patch('/{library_id}', response_model=LibraryDocument)
async def handle_update_library(library_id: str, payload: LibraryUpdate):
    return await update_library(library_id, payload)


@router.post('/{library_id}/versions', response_model=LibraryDocument)
async def handle_add_version(library_id: str, payload: VersionModel):
    return await add_version(library_id, payload)


@router.post('/analyze/file')
async def handle_analyze_file(file: UploadFile = File(...)):
    client = get_mcp_http_client()
    if not client:
        raise HTTPException(status_code=503, detail='MCP HTTP client not configured')
    content = (await file.read()).decode('utf-8', errors='ignore')
    try:
        report = await client.analyze_file({"filename": file.filename, "content": content})
    except MCPClientError as error:
        raise HTTPException(status_code=502, detail=str(error))
    return {"file": file.filename, **(report or {})}



@router.post('/repositories/clone')
async def handle_repo_clone(payload: dict):
    """Clone a repository and return a preview list of dependency files and parsed packages.

    Response: { url, root, files: [ { path, report }, ... ] }
    """
    repo_url = payload.get('url')
    if not repo_url:
        raise HTTPException(status_code=400, detail='url is required')
    if not isinstance(repo_url, str):
        raise HTTPException(status_code=400, detail='url must be a string')
    # ensure static type checkers see a plain str
    repo_url = str(repo_url)

    try:
        root = clone_repository(repo_url)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f'Repo clone failed: {error}')

    try:
        summaries = list_repository_packages(root)
    except Exception as error:
        # cleanup cloned repo on failure
        shutil.rmtree(root, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f'Failed to list repository packages: {error}')

    # Note: we keep the cloned repo on disk for now so the UI can request a follow-up scan if needed.
    return {"url": repo_url, "root": root, "files": summaries}


@router.post('/repositories/list-packages')
async def handle_repo_list_packages(payload: dict):
    """Return parsed dependency-file summaries for an existing cloned repo (by `root`) or for a repo URL.

    Request body: { "root": "/path/to/clone" } OR { "url": "https://..." }
    Response: { url?, root, files: [ { path, report }, ... ] }
    """
    root = payload.get('root')
    repo_url = payload.get('url')

    if not root and not repo_url:
        raise HTTPException(status_code=400, detail='root or url is required')

    try:
        if root:
            summaries = list_repository_packages(root)
            return {"root": root, "files": summaries}
        # else clone then list
        elif repo_url:
            if not isinstance(repo_url, str):
                raise HTTPException(status_code=400, detail='url must be a string')
            root = clone_repository(str(repo_url))
            summaries = list_repository_packages(root)
            return {"url": repo_url, "root": root, "files": summaries}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@router.post('/repositories/scan/highest-risk')
async def handle_repo_scan_highest_risk(payload: dict):
    """
    Scan a repository (same flow as /repositories/scan) and return the libraries
    with the highest risk score across all discovered dependencies. Intended for
    CI/CD pipelines to gate on risk_score.
    """
    repo_url = payload.get('url')
    if not repo_url:
        raise HTTPException(status_code=400, detail='url is required')
    if not isinstance(repo_url, str):
        raise HTTPException(status_code=400, detail='url must be a string')
    repo_url = str(repo_url)

    client = get_mcp_http_client()
    if not client:
        raise HTTPException(status_code=503, detail='MCP HTTP client not configured')

    # Use existing route handlers to support both UI and CI flows:
    #  - clone the repository (handle_repo_clone)
    #  - list packages for the cloned repo (handle_repo_list_packages)
    # Then enrich each dependency using `resolve_dependency_entry`.
    try:
        clone_res = await handle_repo_clone({"url": repo_url})
        # clone_res should contain `root` and `files`
        root = clone_res.get("root")
        scanned_files = clone_res.get("files") or []

        # If clone returned no files, try listing packages explicitly
        if not scanned_files and root:
            list_res = await handle_repo_list_packages({"root": root})
            scanned_files = list_res.get("files") or []

        dependencies = []
        analyzed_files = []

        for f in scanned_files:
            relpath = f.get("path")
            report = f.get("report") or {}
            # collect analyzed file summary
            analyzed_files.append({"path": relpath, "report": report})

            deps = Array = report.get("dependencies") if isinstance(report.get("dependencies"), list) else []
            for dep in deps:
                try:
                    enriched = await resolve_dependency_entry(dep, relpath, report)
                except Exception:
                    # fallback: still include minimal dep info
                    enriched = {
                        "name": dep.get("name"),
                        "version": dep.get("version"),
                        "ecosystem": dep.get("ecosystem") or report.get("ecosystem"),
                        "sources": [relpath]
                    }
                # attach source file info
                enriched["file"] = relpath
                dependencies.append(enriched)
    except HTTPException:
        # propagate HTTP errors as-is
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Persist summarized scan to repository_scans collection
    platform, repo_name = _infer_repo_meta(repo_url)
    try:
        # Group enriched dependencies by their source file path (library_path)
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for d in dependencies:
            # prefer explicit file field, fall back to first source if present
            path = d.get('file') or (d.get('sources')[0] if d.get('sources') else None) or 'unknown'
            if not d.get('name'):
                continue
            lib_entry = {
                "library_name": d.get('name'),
                "library_version": normalize_version(d.get('version')) or d.get('version') or "unknown",
                "ecosystem": d.get('ecosystem')
            }
            grouped.setdefault(path, []).append(lib_entry)

        deps_payload = [
            {"library_path": path, "libraries": libs}
            for path, libs in grouped.items()
        ]

        payload = RepositoryScanCreate(
            repository_url=repo_url,
            repository_platform=platform,
            repository_name=repo_name,
            dependencies=deps_payload,
        )
        await create_repository_scan(payload)
    except Exception as exc:
        print(f'{datetime.utcnow().isoformat()} [repo_scan_highest] failed to persist scan: {exc}')

    deps_with_scores = [d for d in dependencies if d.get('risk_score') is not None]
    if deps_with_scores:
        global_top_score = max(d['risk_score'] for d in deps_with_scores if d.get('risk_score') is not None)
        highest = [
            {
                "name": d.get('name'),
                "version": d.get('version'),
                "ecosystem": d.get('ecosystem'),
                "risk_score": d.get('risk_score'),
                "risk_level": d.get('risk_level'),
                "risk_score_explanation": d.get('risk_score_explanation'),
                "library_id": d.get('library_id'),
                "repository_url": d.get('repository_url'),
                "sources": d.get('sources', [])
            }
            for d in deps_with_scores
            if d.get('risk_score') == global_top_score
        ]
    else:
        global_top_score = None
        highest = []

    return {
        "url": repo_url,
        "dependencies": dependencies,
        "analyzed_files": analyzed_files,
        "highest_risk_score": global_top_score,
        "highest_risk_libraries": highest
    }
