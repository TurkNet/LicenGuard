from fastapi import APIRouter, Query
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


router = APIRouter(prefix='/libraries', tags=['libraries'])


@router.get('/', response_model=List[LibraryDocument])
async def handle_list_libraries():
    return await list_libraries()


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
