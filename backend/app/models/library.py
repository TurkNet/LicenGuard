from datetime import datetime
from typing import List, Literal, Optional
from bson import ObjectId
from pydantic import BaseModel, Field, ValidationInfo, ConfigDict


class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, info: ValidationInfo | None = None):
        if isinstance(v, ObjectId):
            return v
        if not ObjectId.is_valid(v):
            raise ValueError('Invalid objectid')
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        json_schema = handler(core_schema)
        json_schema.update(type='string', examples=['6650f7ab5b4c4e2b3c1a1234'])
        return json_schema


class VersionModel(BaseModel):
    version: str = Field(..., description='Semantic version string')
    license_name: Optional[str] = Field(None, description='License name e.g. MIT')
    license_url: Optional[str] = Field(None, description='Link to license file or SPDX entry')
    notes: Optional[str] = None
    license_summary: List[str] = Field(default_factory=list, description='Optional bullet list summarizing license terms')
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LibraryBase(BaseModel):
    name: str
    ecosystem: str = Field(..., description='E.g. npm, nuget, maven, pip')
    description: Optional[str] = None
    repository_url: Optional[str] = None


class LibraryCreate(LibraryBase):
    versions: List[VersionModel] = Field(default_factory=list)


class LibraryUpdate(BaseModel):
    description: Optional[str] = None
    repository_url: Optional[str] = None


class LibraryDocument(LibraryBase):
    id: PyObjectId = Field(default_factory=PyObjectId, alias='_id')
    versions: List[VersionModel] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        arbitrary_types_allowed = True
        json_encoders = {ObjectId: str}


class LibraryDiscoveryQuery(BaseModel):
    name: str
    version: Optional[str] = None
    ecosystem: Optional[str] = None
    notes: Optional[str] = None


class LibraryDiscoveryMatch(BaseModel):
    name: Optional[str] = None
    officialSite: Optional[str] = None
    repository: Optional[str] = None
    version: Optional[str] = None
    license: Optional[str] = None
    license_url: Optional[str] = None
    license_summary: Optional[List[str]] = Field(default=None, alias='licenseSummary')
    confidence: Optional[float] = None
    description: Optional[str] = None
    evidence: Optional[List[str]] = None
    model_config = ConfigDict(populate_by_name=True, extra='ignore')


class LibraryDiscoveryReport(BaseModel):
    query: LibraryDiscoveryQuery
    matches: List[LibraryDiscoveryMatch] = Field(default_factory=list)
    summary: Optional[str] = None
    model_config = ConfigDict(extra='ignore')


class LibrarySearchResponse(BaseModel):
    source: Literal['mongo', 'mcp']
    results: List[LibraryDocument] = Field(default_factory=list)
    discovery: Optional[LibraryDiscoveryReport] = None
