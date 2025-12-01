from typing import List
from fastapi import APIRouter, HTTPException, Query, Path
from ..controllers.repository_scan_controller import (
    create_repository_scan,
    get_repository_scan,
    list_repository_scans,
    search_repository_scans,
    update_repository_scan
)
from ..models.repository_scan import (
    RepositoryScanCreate,
    RepositoryScanDocument,
    RepositoryScanUpdate
)


router = APIRouter(prefix='/repository-scans', tags=['repository-scans'])


@router.get('/', response_model=List[RepositoryScanDocument])
async def handle_list_repository_scans(limit: int | None = Query(default=None, gt=0)):
    return await list_repository_scans(limit)


@router.get('/search', response_model=List[RepositoryScanDocument])
async def handle_search_repository_scans(
    q: str = Query(..., min_length=1, description='Search text'),
    limit: int | None = Query(default=None, gt=0)
):
    return await search_repository_scans(q, limit)


# Backward compatibility: keep /{scan_id} but hide from docs to avoid /search collision
@router.get('/{scan_id}', include_in_schema=False, response_model=RepositoryScanDocument)
async def handle_get_repository_scan_legacy(scan_id: str = Path(..., pattern=r'^[0-9a-fA-F]{24}$')):
    return await get_repository_scan(scan_id)


@router.get('/id/{scan_id}', response_model=RepositoryScanDocument)
async def handle_get_repository_scan(scan_id: str = Path(..., pattern=r'^[0-9a-fA-F]{24}$')):
    return await get_repository_scan(scan_id)


@router.post('/', response_model=RepositoryScanDocument, status_code=201)
async def handle_create_repository_scan(payload: RepositoryScanCreate):
    return await create_repository_scan(payload)


@router.patch('/id/{scan_id}', response_model=RepositoryScanDocument)
async def handle_update_repository_scan(scan_id: str, payload: RepositoryScanUpdate):
    if payload is None:
        raise HTTPException(status_code=400, detail='Body required')
    return await update_repository_scan(scan_id, payload)
