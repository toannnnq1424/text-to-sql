# React → Java public API baseline

Base `/api/v1`, JSON camelCase. Đây là đặc tả cần triển khai, chưa có server. Auth bắt buộc khi triển khai: token OIDC/JWT do Java validate; role VIEWER, ANALYST, OPERATOR, ADMIN. Scope resource luôn kiểm tra warehouse/dataset, kể cả history/result/CSV. Provider identity cụ thể cấu hình ở C0; không tự viết password store. Local demo chỉ được dùng dev profile tường minh, không bypass auth trong production.

VIEWER đọc resource được cấp quyền; ANALYST thêm query/save result; OPERATOR thêm pipeline/evaluation; ADMIN quản lý registry/semantic và cấu hình. Token không đưa vào query string. GET /health chỉ thông tin liveness tối thiểu, chi tiết health có auth.

List dùng convention trong [domain](domain.md). PATCH body chỉ chứa field được phép đổi; không đổi warehouse engine trên resource đã có dataset/query, cần đăng ký mới. Resource mutation trả 200/201; create có Location header. Unknown JSON fields phải reject ở request nghiệp vụ để phát hiện drift.

## Registry và platform

| Method/path | Input / output |
|---|---|
| GET /health | `{status:"UP"}`; không chi tiết secrets/host |
| GET /platform/summary | PlatformSummary bên dưới, context-neutral |
| GET /warehouses | Page<WarehouseSummary>; filters engine,status,search |
| POST /warehouses | Admin: name,engine,host,port,database,defaultSchema,username,credentialReference,optional `importUsername` + write-only `importCredentialReference`, optional `ingestionUsername` + write-only `ingestionCredentialReference` → 201 safe `Warehouse` detail |
| GET /warehouses/{id} | Authorized safe detail; admin mới có connection fields |
| PATCH /warehouses/{id} | Admin: name,host,port,database,defaultSchema,username,credentialReference, `importUsername`/`importCredentialReference`, `ingestionUsername`/`ingestionCredentialReference`, status; credential references are write-only and omitted from responses; status mutation chỉ ACTIVE/DISABLED theo validation |
| POST /warehouses/{id}/test | Admin → `{warehouseId,reachable,latencyMs,checkedAt,error:null|ErrorBody}`; lỗi kiểm tra nghiệp vụ reachable=false, lỗi API dùng envelope |
| POST /warehouses/{id}/discover | Admin → 202 DiscoveryRun `{runId,warehouseId,status,createdAt}` |
| GET /warehouses/{id}/discoveries/{runId} | DiscoveryRun + completedAt nullable, metadata nullable, error nullable |
| GET /warehouses/{id}/access | Admin → danh sách `{subject,warehouseId}` đã được cấp quyền tài nguyên |
| POST /warehouses/{id}/access | Admin: `{subject}` → 201 cấp quyền subject OIDC vào warehouse |
| DELETE /warehouses/{id}/access?subject=... | Admin → 204 thu hồi quyền tài nguyên |
| GET /datasets | Page<Dataset>; filters warehouseId,status,search |
| POST /datasets | Admin: warehouseId,name,description,allowedSchemas,allowedTables,semanticVersion,schemaVersion → 201 Dataset |
| GET /datasets/{id} | Dataset |
| PATCH /datasets/{id} | Admin: name,description,allowlists,status (ACTIVE/DISABLED); Java validate trước ACTIVE |
| GET /datasets/{id}/semantic-model | Context đầy đủ + versions; authorized |
| PUT /datasets/{id}/semantic-model | Admin: semantic model; validate against metadata → Dataset với version mới |

PlatformSummary: `{warehouseCount,datasetCount,healthyWarehouseCount,querySuccessRate,recentQueries:QuerySummary[],recentEvaluationRuns:EvaluationRun[],recentIngestionRuns:IngestionRun[],systemHealth}`. Rate number 0..1 hoặc null khi không đủ mẫu; count không âm. Không cố định revenue/orders; endpoint phải hỗ trợ home platform overview.

DiscoveryRun statuses: PENDING,RUNNING,SUCCESS,FAILED. Metadata canonical gồm schemas/tables/columns/PK/FK; không tự tạo bảng. Schema đổi khiến semantic mapping sai thì Dataset INVALID_SCHEMA; không âm thầm cập nhật meaning metric.

## Catalog

| Method/path | Output |
|---|---|
| GET /datasets/{id}/catalog | `{datasetId,semanticVersion,schemaVersion,tableCount,metricCount,dimensionCount,relationshipCount,exampleCount,tableCategories:[{name,count}],metricCategories:[{name,count}],exampleCategories:[{name,count}]}`. Counts are computed separately from live physical tables and the active semantic model. |
| GET /datasets/{id}/tables | Page<TableMetadata>; filters search,schema,category,status,queryable |
| GET /datasets/{id}/tables/{tableId} | TableMetadata + columns/PK/FK/description/grain; tableId opaque do discovery cấp |
| GET /datasets/{id}/metrics | Page<Metric>; search,category,dataType |
| GET /datasets/{id}/metrics/{name} | Metric gồm expression,unit,synonyms,compatibleDimensions,examples |
| GET /datasets/{id}/dimensions | Page<Dimension>; search,dataType |
| GET /datasets/{id}/dimensions/{name} | Dimension |
| GET /datasets/{id}/relationships | Page<Relationship>; search,tableId |
| GET /datasets/{id}/examples | Page<Example>; search,category,language |

Metadata DTO lấy shape tại semantic-model.md; TableMetadata thêm tableId, PK/FK, queryable và physical/logical name. Các chi tiết collection lớn cần pagination; không ép FE tải toàn bộ schema để lọc. OpenAPI C0 phải định nghĩa tất cả nested DTO và collection detail theo bảng này trước khi FE mock riêng.

## Query và history

| Method/path | Input / output |
|---|---|
| POST /query | QueryRequest → 201 Query terminal, sync bounded deadline; lỗi dùng error envelope với queryId nếu đã tạo |
| GET /query/history | Page<QuerySummary>, đặt route tĩnh trước /query/{id} |
| GET /query/{id} | Query, bao gồm trang đầu result nếu còn snapshot |
| GET /query/{id}/result | QueryResult; params page,pageSize,sort,direction,search; filter/sort trên cùng bounded snapshot |
| GET /query/{id}/export.csv | text/csv UTF-8, attachment; cùng authorized bounded snapshot; cột Decimal/BIGINT không mất precision |
| POST /query/{id}/saved | `{name:string}` → 201 `{savedResultId,queryId,name,createdAt}`; lưu bookmark + retention snapshot theo policy |
| GET /query/{id}/saved | Danh sách bookmark authorized của query |

QuerySummary: queryId,warehouseId,datasetId,engine,question,status,model,executionMode,semanticVersion,schemaVersion,latencyMs,rowCount,createdAt,correlationId. rowCount nullable khi chưa có result. History filters search,warehouseId,engine,datasetId,status,model,from,to; sort createdAt/latencyMs/status, stable tie-breaker queryId. Context change không làm mất filter warehouse nếu user chưa đổi filter.

CSV escape delimiters/quotes/newlines và chống spreadsheet formula injection cho string bắt đầu bằng =,+,-,@ hoặc control char nguy hiểm; không biến giá trị numeric hợp lệ thành string tùy tiện. Không tạo share link công khai chưa được authorization; nút share trong ảnh là optional UX mở rộng, không hứa có sharing endpoint hiện tại.

## Ingestion

Pipeline chỉ chạy nguồn đã đăng ký và dataset được phép ghi bằng operator credential tách biệt. Không tự fetch URL bất kỳ từ browser. SQL script file được xử lý bởi module Import SQL riêng bên dưới; không gửi SQL file vào ingestion-run endpoint.

| Method/path | Input / output |
|---|---|
| GET /warehouse/ingestion/sources | Page<IngestionSource> theo warehouseId/datasetId; `{sourceId,name,type,status,sourceWarehouseId,sourceDatasetId}` không secrets |
| GET /warehouse/ingestion/sources/{sourceId} | Authorized `IngestionSource`; caller must have access to both source and target warehouse |
| POST /warehouse/ingestion/sources | Admin đăng ký pipeline từ warehouse/dataset đã đăng ký: `{name,warehouseId,datasetId,sourceWarehouseId,sourceDatasetId,readSql,raw,stage,warehouse,mart,columns,requiredColumns,columnTypes,maxStringLengths,maxRows,maxBytes,timeoutSeconds}` → 201 safe `IngestionSource`; all four target objects use `{schema,name}`, `columns` is an ordered array of result aliases, `sourceId` is server-generated, and writer credential comes from server-managed secret references |
| PATCH /warehouse/ingestion/sources/{sourceId} | Admin sends a partial body containing only changed fields; fields merge into the registered source and the complete merged configuration is revalidated. `raw`/`stage`/`warehouse`/`mart` use `{schema,name}`. Secrets are never accepted or returned. |
| POST /warehouse/ingestion/sources/{sourceId}/test | Admin checks the bounded source query, dataset table allowlist, output names/types, and all four writer target tables and canonical column types. Success: `{sourceId,reachable,checkedAt,sourceEngine,targetEngine,rowCount,truncated,columns,targets}`; `targets` contains `raw`, `stage`, `warehouse`, and `mart`; failures use the standard sanitized API error envelope. |
| POST /warehouse/ingestion/run | `{warehouseId,datasetId,sourceId,idempotencyKey}` → 202 `IngestionRun`; caller needs access to both source and target warehouse |
| GET /warehouse/ingestion/runs | Page<IngestionRun>; warehouseId,engine,datasetId,status,from,to,search. Results are filtered by access to both source and target warehouse. |
| GET /warehouse/ingestion/runs/{runId} | Authorized `IngestionRun` + stage details/errors sanitized; caller needs access to source and target warehouse |

IngestionSource: `sourceId,name,type,status,warehouseId,datasetId,sourceWarehouseId,sourceDatasetId,readSql,raw:{schema,name},stage:{schema,name},warehouse:{schema,name},mart:{schema,name},columns:string[],requiredColumns:string[],columnTypes:Record<string,STRING|INTEGER|DECIMAL|BOOLEAN|DATE|TIMESTAMP>,maxStringLengths,maxRows,maxBytes,timeoutSeconds,createdAt,updatedAt`. `GET`/`PATCH`/`test`/`run` enforce resource authorization for both source and target warehouses. List endpoints omit sources/runs when the caller lacks access to either side; detail endpoints return not found or forbidden without disclosing the other resource.

IngestionRun: runId,batchId,warehouseId,datasetId,engine,status,sourceId,sourceWarehouseId,sourceDatasetId,rowsWritten,rejectedCount,startedAt,completedAt,durationMs,idempotent,steps,error. Nullable timestamps/duration trước khi hoàn tất. Stages RAW,STAGING,WAREHOUSE,MART; step status PENDING,RUNNING,SUCCESS,FAILED,SKIPPED,ROLLED_BACK. A failed transaction marks already completed layer steps ROLLED_BACK and reports zero committed rows; unstarted layers are SKIPPED. Run status PENDING,RUNNING,SUCCESS,PARTIAL,FAILED. Idempotency key cùng principal+source+dataset+payload trả cùng run; reuse key với payload khác trả 409 INVALID_REQUEST. Không tự rerun failure và double insert.

Pipeline source is application metadata, not a file per warehouse in the repository. `sourceWarehouseId`/`sourceDatasetId` name the registered read-only source and its allowlist; `warehouseId`/`datasetId` name the registered write target. `readSql` is a bounded SELECT candidate validated against source dataset metadata by Java. `columns` is an ordered, unique list of result aliases; `columnTypes` must declare exactly one canonical type per alias (`STRING`,`INTEGER`,`DECIMAL`,`BOOLEAN`,`DATE`,`TIMESTAMP`). `requiredColumns` and `maxStringLengths` must be subsets of columns; string length limits apply only to `STRING`. `raw`/`stage`/`warehouse`/`mart` identifiers are validated, safely quoted, and each table must exist with exactly the configured columns and compatible canonical SQL types. A run stores the bounded source-query snapshot in RAW, writes the validated canonical rows to STAGING, materializes them from STAGING to WAREHOUSE, then publishes the WAREHOUSE rows to MART. All four target replacements and row-count integrity checks run in one target-database transaction; failure rolls back all four layers. Query and writer credentials remain server-managed references; API never accepts or returns secret values. Configuration changes are audited and produce an immutable snapshot for each run. `sourceObjects` in checked-in sample pipeline JSON is local-provisioning metadata and is not accepted by the application API; application source objects are resolved from the authorized registered dataset.

## Import SQL (mandatory)

Upload chỉ qua Java API. Chỉ ADMIN/OPERATOR có quyền trên target warehouse được validate/execute; mọi operation có audit và correlation ID. File tối đa 2 MiB, phần mở rộng `.sql`, tối đa 1000 statements, 500 columns/object, 10000 INSERT rows và 100000 literal values; query timeout 20 giây mỗi câu lệnh và execution deadline 60 giây. Queue tối đa 2 workers và 16 jobs chờ; queue đầy tạo run `FAILED` với `SQL_IMPORT_CAPACITY`. Filename chỉ dùng để kiểm tra extension, không được resolve thành filesystem path. Raw SQL không được log. Metadata store giữ canonical immutable plan tối đa 24 giờ để hỗ trợ confirmation/retry, plan hết hạn xác nhận sau 15 phút.

| Method/path | Input / output |
|---|---|
| POST `/import/sql/validate` | `multipart/form-data`: `file`, `sourceDialect` (`AUTO_DETECT`,`POSTGRESQL`,`MYSQL`,`SQL_SERVER`), `warehouseId`, `targetSchema`; returns `{planId,planDigest,warehouseId,targetSchema,sourceDialect,detectedDialect,targetEngine,mode,statementCount,objectCount,supportedActions,warnings,unsupportedFeatures,preview:{schemas:[{name,tables:[{name,columns:[{name,dataType,nullable,primaryKey,identity,unique,hasDefault,defaultValue}],constraints:[{kind,name,columns,referenceSchema,referenceTable,referenceColumns}],indexes:[{name,columns,unique}]}]}],statements:[{index,kind,objectName,summary}]},expiresAt}`. Statement summaries describe CREATE SCHEMA/TABLE/INDEX and INSERT row counts/column names, without exposing literal values. Validation does not write target objects. |
| POST `/import/sql/runs` | `{planId,planDigest,idempotencyKey}` → 202 `ImportRun`; execution is bounded and response contains run state/progress. Server executes only the immutable stored plan, never SQL supplied at confirmation. The stored target configuration revision is internal; a mismatch returns 409; schema/table collision/destructive operations reject; no implicit overwrite. |
| GET `/import/sql/runs` | Page<ImportRun> theo warehouseId,targetEngine,status,from,to,search. |
| GET `/import/sql/runs/{runId}` | ImportRun + statement/stage outcome, counts, sanitized error. |

`ImportRun`: `{runId,planId,warehouseId,targetSchema,sourceDialect,targetEngine,status,statementCount,completedStatements,rowsAffected,createdAt,completedAt,steps,error}`. `status` is `RUNNING|SUCCESS|PARTIAL|FAILED`; each step is `{index,kind,objectName,status,rowsAffected,error}`, and step status is `PENDING|RUNNING|SUCCESS|FAILED|SKIPPED|ROLLED_BACK`. `PARTIAL` explicitly reports engines (notably MySQL implicit DDL commit) that may retain earlier-created objects after a later statement fails; user must inspect and clean the dedicated target namespace before retrying. A `RUNNING` import older than 15 minutes is recovered as `PARTIAL` with `SQL_IMPORT_INTERRUPTED` and `error.details.outcomeUnknown=true`; the client must inspect the namespace and must not auto-retry. Idempotency key is scoped to authenticated subject; reusing it with the same plan returns the same run, and using it for another plan is `409 INVALID_REQUEST`.

Mỗi warehouse cấu hình writer riêng cho ingestion (`ingestionUsername`, write-only `ingestionCredentialReference`) và SQL Import (`importUsername`, write-only `importCredentialReference`). Credential reference dạng `env:NAME` trỏ tới secret do deployment quản trị; không bao giờ trả về API. Các writer phải được cấp quyền tối thiểu bởi DBA/provisioning riêng; Java không giả định các username/global password giống nhau giữa warehouse. Reader/query principal chỉ SELECT. PostgreSQL/SQL Server `targetSchema` phải được provision và cấp quyền; MySQL dùng `targetSchema` như database/catalog đích. CREATE SCHEMA trong file chỉ được chấp nhận như declaration trùng target, không dùng để mở rộng quyền. Cú pháp chưa hỗ trợ bị từ chối rõ ràng, không silently skip hoặc fallback thực thi nguyên văn. Cross-dialect sinh DDL từ canonical model; parser canonicalize PK/FK/UNIQUE/INDEX, identity/default và scalar types; INSERT literals luôn bind parameters. Các constraints/types chỉ được thực thi khi có mặt trong plan preview. Transaction, rollback/recovery và partial-import semantics khác nhau theo engine và được trả trong trạng thái run.

## Evaluation

| Method/path | Input / output |
|---|---|
| GET /evaluation/test-suites | Page<TestSuite> gồm suiteId,name,version,caseCount,engines |
| POST /evaluation/run | `{warehouseId,datasetId,suiteId,mode}` → 202 EvaluationRun |
| GET /evaluation/runs | Page<EvaluationRun>; warehouseId,engine,datasetId,model,status,from,to |
| GET /evaluation/runs/{runId} | EvaluationRun + aggregate metrics |
| GET /evaluation/results | Page<EvaluationCaseResult>; runId,warehouseId,engine,datasetId,model,status,difficulty,search |
| GET /evaluation/results/{resultId} | Expected/generated SQL, validation, actual bounded result, failure reason, timings |

EvaluationRun: runId,warehouseId,datasetId,engine,model,status,createdAt,completedAt,metrics. Status PENDING,RUNNING,SUCCESS,PARTIAL,FAILED. Metrics: totalCases,completedCases,executionSuccessRate,resultEquivalenceRate,invalidSqlRejectionRate,dialectAccuracy,avgLatencyMs,p95LatencyMs (chưa có mẫu → null). Mẫu số của từng rate phải trả trong metrics.denominators; không trộn injection cases với valid query execution denominator. EvaluationCaseResult có resultId,caseId,runId,question,difficulty,sqlDialect,status,expectedSql,generatedSql,validationResult,resultEquivalent,chartMatch,latencyMs,failureReason. Difficulty EASY,MEDIUM,HARD; status PASSED,FAILED,REJECTED,ERROR; nullable comparison nếu case chưa đủ điều kiện đo.

## Monitoring và settings

GET `/monitoring/summary`: filters warehouseId,engine,datasetId,from,to → queryVolume,successRate,llmErrorCount,sqlValidationRejectionCount,timeoutCount,avgLatencyMs,p95LatencyMs,queriesByEngine,queriesByDataset,warehouseHealth,ingestionHealth. Trả time window và denominator, rate null khi không có mẫu.

GET `/settings`: safe platform settings (locale,timezone,defaultQueryMode,limits,availableModes,providerConfigured,modelDisplayName). PATCH `/settings`: admin cập nhật allowlisted nonsecret defaults/limits trong server bounds; không nhập key qua public settings. Model/provider secrets quản lý deployment env; thay đổi phải audit. UI user preference locale/timezone có thể giữ local, không ảnh hưởng canonical timestamps hay query timezone của dataset.

SQL Import và in-app ingestion là scope bắt buộc theo [scope](../scope.md), không phải future extension. Không có quyền thực thi arbitrary SQL file.
