from fastapi import APIRouter, Query, UploadFile, File
import os
import shutil
from typing import List
from ..controllers.library_controller import (
    add_version,
    create_library,
    get_library,
    list_libraries,
    search_libraries,
    search_libraries_local,
    update_library
)
from ..models.library import (
    LibraryCreate,
    LibraryDocument,
    LibrarySearchResponse,
    LibraryUpdate,
    VersionModel
)
from ..services.mcp_client import get_mcp_http_client, MCPClientError
from ..services.repo_scanner import clone_and_scan


router = APIRouter(prefix='/libraries', tags=['libraries'])


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


@router.post('/repositories/scan')
async def handle_repo_scan(payload: dict):
    repo_url = payload.get('url')
    if not repo_url:
        raise HTTPException(status_code=400, detail='url is required')
    client = get_mcp_http_client()
    if not client:
        raise HTTPException(status_code=503, detail='MCP HTTP client not configured')
    tmpdir = None
    try:
        scan_result = clone_and_scan(repo_url)
        tmpdir = scan_result.get('root')
    except Exception as error:
        raise HTTPException(status_code=502, detail=f'Repo scan failed: {error}')

    analyzed_files = []
    try:
        for relpath in scan_result.get('files', []):
            full_path = os.path.join(scan_result['root'], relpath)
            try:
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as fh:
                    content = fh.read()
                report = await client.analyze_file({"filename": relpath, "content": content}) or {}
            except Exception as exc:
                report = {"error": str(exc)}
            analyzed_files.append({"path": relpath, "report": report})
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    return {"url": repo_url, "files": analyzed_files}
