"""Build Wren manifests and plan SQL using the native semantic engine."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from wren.engine import WrenEngine
from wren.nla_planning import DatasetPlanningError

from third_party.wren_semantic.session_context import session_context


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_by_name=True)


class PhysicalTable(StrictModel):
    schema_: str = Field(alias="schema", min_length=1, max_length=256)
    table: str = Field(min_length=1, max_length=256)


class ManifestColumn(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    type: str = Field(min_length=1, max_length=100)


class ManifestModel(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    tableReference: PhysicalTable
    columns: list[ManifestColumn] = Field(min_length=1, max_length=1000)
    primaryKey: str | None = Field(default=None, max_length=256)


JoinType = Literal["ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"]


class ManifestRelationship(StrictModel):
    name: str = Field(min_length=1, max_length=512)
    models: list[str] = Field(min_length=2, max_length=2)
    joinType: JoinType
    condition: str = Field(min_length=1, max_length=2000)


class Manifest(StrictModel):
    catalog: Literal["nla"]
    schema_: Literal["semantic"] = Field(alias="schema")
    dataSource: Literal["postgres", "mysql", "mssql"]
    models: list[ManifestModel] = Field(min_length=1, max_length=1000)
    relationships: list[ManifestRelationship] = Field(max_length=5000)


class PlanRequest(StrictModel):
    correlationId: str = Field(min_length=1, max_length=100)
    sqlDialect: Literal["POSTGRESQL", "MYSQL", "SQL_SERVER"]
    sql: str = Field(min_length=1, max_length=100000)
    manifest: Manifest


class SourceTable(StrictModel):
    schema_: str = Field(alias="schema")
    name: str


class PlanResponse(StrictModel):
    sql: str
    sourceModels: list[str]
    sourceTables: list[SourceTable]
    plannerVersion: Literal["wren-core-py/0.4.0"]


DIALECTS = {
    "POSTGRESQL": ("postgres", "postgres"),
    "MYSQL": ("mysql", "mysql"),
    "SQL_SERVER": ("mssql", "tsql"),
}


# Preserve the private HTTP error contract while the fork owns physical planning.
PlanningFailure = DatasetPlanningError


def plan_sql(request: PlanRequest) -> PlanResponse:
    data_source, _ = DIALECTS[request.sqlDialect]
    planned = WrenEngine.plan_for_dataset(
        sql=request.sql,
        manifest=request.manifest.model_dump(by_alias=True),
        data_source=data_source,
        session_lease=session_context,
    )
    return PlanResponse(
        sql=planned.sql,
        sourceModels=list(planned.source_models),
        sourceTables=[
            SourceTable(schema_=schema, name=table) for schema, table in planned.source_tables
        ],
        plannerVersion="wren-core-py/0.4.0",
    )
