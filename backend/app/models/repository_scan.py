from datetime import datetime
from typing import List, Optional
from bson import ObjectId
from pydantic import BaseModel, Field, ConfigDict
from .library import PyObjectId


class RepoLibrary(BaseModel):
    library_name: str = Field(..., description='Discovered library name')
    library_version: str = Field(..., description='Discovered library version')
    model_config = ConfigDict(populate_by_name=True)


class RepoDependency(BaseModel):
    library_path: str = Field(..., description='Path of the dependency manifest inside the repository')
    libraries: List[RepoLibrary] = Field(default_factory=list, description='Libraries found in this file')


class RepositoryScanBase(BaseModel):
    repository_url: str = Field(..., description='Full repository URL (e.g., GitHub repo URL)')
    repository_platform: str = Field(..., description='Platform of the repository (github/gitlab/bitbucket/etc)')
    repository_name: str = Field(..., description='Repository name')
    dependencies: List[RepoDependency] = Field(default_factory=list, description='Grouped dependencies by file')
    model_config = ConfigDict(populate_by_name=True)


class RepositoryScanCreate(RepositoryScanBase):
    createdAt: Optional[datetime] = Field(default=None, description='Creation timestamp (optional)')
    updatedAt: Optional[datetime] = Field(default=None, description='Last update timestamp (optional)')


class RepositoryScanUpdate(BaseModel):
    repository_url: Optional[str] = None
    repository_platform: Optional[str] = None
    repository_name: Optional[str] = None
    dependencies: Optional[List[RepoDependency]] = None
    model_config = ConfigDict(populate_by_name=True)


class RepositoryScanDocument(RepositoryScanBase):
    id: PyObjectId = Field(default_factory=PyObjectId, alias='_id')
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str, PyObjectId: str},
        extra='allow'
    )
