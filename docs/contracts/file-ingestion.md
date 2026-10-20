# File ingestion — shared contract

Java remains the only public API and warehouse writer. The private parser receives bytes, never credentials. A file is parsed in full, all columns/types inferred, then shown as a bounded preview; no manual INSERT/row-entry workflow is required.

Base: `/api/v1/warehouse/ingestion`. All writes require ADMIN or OPERATOR and target warehouse authorization. Upload ownership is private to its actor (ADMIN may inspect); a target grant is checked again before confirm and execution. Unsupported/malformed files fail closed before creating tables. `.sql` uses the existing SQL Import flow, never this parser.

## Formats and bounds

CSV/TSV/TXT delimited text (UTF-8/UTF-16 BOM, comma/tab/semicolon/pipe); JSON records, JSONL/NDJSON; XLSX (select sheet); Parquet; Arrow IPC/Feather; ORC; Avro. 25 MiB input, 100,000 rows, 200 columns, 16,384 characters/cell, 75 MiB canonical spool. Header names normalize to unique safe identifiers while `sourceName` preserves original labels. Full-file inference preserves leading-zero strings and exact decimal/BIGINT values. Nested JSON is retained as canonical JSON text. Formula cells, macros, encrypted workbooks, external references, unsafe ZIP expansion and malformed records are rejected. Binary native readers run in the private bounded parser container.

Types: `STRING | BIGINT | DECIMAL | BOOLEAN | DATE | TIMESTAMP`. Decimal maps to DECIMAL(38,10); values outside its exact precision remain STRING on inference. UTC timestamps are canonicalized without silently dropping offsets. No source rows are silently skipped.

## Public operations

- `GET /files/targets?warehouseId=` → `{warehouseId,namespaces:string[]}` actual CREATE-capable namespaces discovered with the registered import writer. No fixed namespace is assumed.
- `POST /files` multipart `file`, optional `sheet`, optional one-character `delimiter` → FileUpload. XLSX defaults to first sheet and returns all sheet names; changing the sheet reuploads the original file and invalidates the previous plan in the caller.
- `GET /files/{id}` → FileUpload owned by actor.
- `POST /files/{id}/validate` JSON `{warehouseId,targetSchema,targetTable,datasetName,columns}` → FilePlan. All columns supplied in original source order; mapping may rename/retype but not invent/drop columns. Validation scans every row for compatibility. Existing target tables are rejected. The writer must have CREATE/INSERT in a pre-provisioned isolated namespace.
- `POST /files/runs` JSON `{planId,digest,idempotencyKey}` → FileRun (202). Plan + mapping + file digest + warehouse connection revision are immutable. Expired plans cannot start new work. Exact retries with same actor/key return the original run; changed payload returns 409.
- `GET /files/runs?warehouseId=&page=&pageSize=` → ordinary Page<FileRun>.
- `GET /files/runs/{id}` → FileRun.
- `POST /files/runs/{id}/cancel` → FileRun. Interrupts pending/running work and rolls back transactional work; committed MySQL DDL is explicitly reported as partial, never automatically retried/dropped.

FileUpload: `{id,fileName,fileType,fileSize,rowCount,columnCount,columns,previewRows,warnings,sheets,sheet?,expiresAt}`. Column: `{sourceName,name,dataType,nullable}`. `previewRows` is an ordered array of row arrays, max20. Nulls remain null; DECIMAL/BIGINT are strings. Uploads expire after24h and are removed by scheduled cleanup after no active job references them. Plans expire after15min.

FilePlan: `{id,uploadId,warehouseId,targetSchema,targetTable,datasetName,digest,status:'VALIDATED',fileName,rowCount,columns,previewRows,layers,expiresAt,warnings}`. Layer: `{name:'RAW'|'STAGING'|'WAREHOUSE'|'MART',schema,table}`. Raw preserves source text; staging validates typed values; warehouse/mart contain the typed accepted records. Table suffixes `_raw`, `_staging`, `_warehouse`, `_mart` are derived from validated base name and shown before confirmation.

FileRun: `{id,sourceKind:'FILE',status:'PENDING'|'RUNNING'|'SUCCESS'|'FAILED'|'CANCELLED',warehouseId,datasetId:string|null,fileName,startedAt,completedAt:string|null,rowCount,rowsLoaded,stages,error:ApiError|null,partialFailure:boolean,createdTables}`. Stage: `{name,status:'PENDING'|'RUNNING'|'SUCCESS'|'FAILED'|'SKIPPED'|'CANCELLED',rowsLoaded}`. On SUCCESS a Dataset is registered with an explicit allowlist of the generated mart table, physical metadata from the actual database, source provenance and an empty semantic model; callers refresh selectors/catalog. No generated business meaning is presented as curated semantics.

## Private parser

`POST /internal/v1/parse`, bearer `FILE_SERVICE_TOKEN`, multipart as above. Response `application/x-ndjson`: one metadata record `{columns,rowCount,fileType,sheets,sheet?,warnings}`, then exactly `rowCount` records `{row:[...]}`. The complete source is validated and spooled before the first response byte. Java streams the output into an actor-owned private spool and retains at most20 preview rows. Health `/health` is unauthenticated, contains only `{status:'ok'}`. No browser route, network URL, user-selected server path, SQL, extension install or warehouse connection is accepted.

Errors use existing envelope: INVALID_REQUEST, FORBIDDEN, NOT_FOUND, PAYLOAD_TOO_LARGE, FILE_PARSE_ERROR, FILE_SERVICE_UNAVAILABLE, FILE_EXPIRED, FILE_MAPPING_INVALID, FILE_TARGET_CONFLICT, FILE_PLAN_STALE, FILE_INGESTION_BUSY, FILE_INGESTION_ERROR. Responses/audit never include raw source rows, credentials, server paths or driver errors.
