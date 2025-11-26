from datetime import datetime
from typing import List, Literal, Optional, Union, Dict
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


class LicenseSummaryItem(BaseModel):
    summary: str
    emoji: Optional[str] = None


class VersionModel(BaseModel):
    version: str = Field(..., description='Semantic version string')
    license_name: Optional[str] = Field(None, description='License name e.g. MIT')
    license_url: Optional[str] = Field(None, description='Link to license file or SPDX entry')
    notes: Optional[str] = None
    license_summary: List[LicenseSummaryItem] = Field(default_factory=list, description='Summary of license key points')
    evidence: List[str] = Field(default_factory=list, description='Evidence/links that support the match')
    confidence: Optional[float] = Field(default=None, description='Confidence score from the matcher')
    risk_level: Optional[str] = Field(default=None, description='Derived risk bucket (low/medium/high/unknown)')
    risk_score: Optional[float] = Field(default=None, description='Derived risk score 0-100 (higher = stricter)')
    risk_score_explanation: Optional[str] = Field(default=None, description='Short human-readable explanation of the risk score')
    license_risk_score: Optional[int] = Field(default=None, description='Component license risk 0-40')
    security_risk_score: Optional[int] = Field(default=None, description='Component security risk 0-30')
    maintenance_risk_score: Optional[int] = Field(default=None, description='Component maintenance risk 0-20')
    usage_context_risk_score: Optional[int] = Field(default=None, description='Component usage-context risk 0-10')


class LibraryBase(BaseModel):
    name: str
    ecosystem: str = Field(..., description='E.g. npm, nuget, maven, pip')
    description: Optional[str] = None
    repository_url: Optional[str] = None
    officialSite: Optional[str] = Field(default=None, alias='officialSite')
    model_config = ConfigDict(populate_by_name=True)



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
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str, PyObjectId: str},
        extra='allow'
    )



class LibraryDiscoveryQuery(BaseModel):
    name: str
    version: Optional[str] = None
    ecosystem: Optional[str] = None
    notes: Optional[str] = None


class LibraryDiscoveryMatch(BaseModel):
    name: Optional[str] = None
    ecosystem: Optional[str] = None
    description: Optional[str] = None
    repository_url: Optional[str] = None
    officialSite: Optional[str] = None
    versions: List[VersionModel] = Field(default_factory=list)


class LibraryDiscoveryReport(BaseModel):
    query: LibraryDiscoveryQuery
    matches: List[LibraryDiscoveryMatch] = Field(default_factory=list)
    summary: Optional[str] = None



class LibrarySearchResponse(BaseModel):
    source: Literal['mongo', 'mcp']
    results: List[LibraryDocument] = Field(default_factory=list)
    discovery: Optional[LibraryDiscoveryReport] = None
    model_config = ConfigDict(json_encoders={ObjectId: str})
