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
| POST /warehouses | Admin: name,engine,host,port,database,defaultSchema,username,credentialReference → 201 Warehouse safe detail |
| GET /warehouses/{id} | Authorized safe detail; admin mới có connection fields |
| PATCH /warehouses/{id} | Admin: name,host,port,database,defaultSchema,username,credentialReference,status; status mutation chỉ ACTIVE/DISABLED theo validation |
| POST /warehouses/{id}/test | Admin → `{warehouseId,reachable,latencyMs,checkedAt,error:null|ErrorBody}`; lỗi kiểm tra nghiệp vụ reachable=false, lỗi API dùng envelope |
| POST /warehouses/{id}/discover | Admin → 202 DiscoveryRun `{runId,warehouseId,status,createdAt}` |
| GET /warehouses/{id}/discoveries/{runId} | DiscoveryRun + completedAt nullable, metadata nullable, error nullable |
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
| GET /datasets/{id}/catalog | `{datasetId,semanticVersion,schemaVersion,tableCount,metricCount,dimensionCount,relationshipCount,exampleCount,categories:[{name,count}]}` |
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

Pipeline chỉ chạy nguồn đã đăng ký và dataset được phép ghi bằng operator credential tách biệt. Không upload SQL hay tự fetch URL bất kỳ từ browser.

| Method/path | Input / output |
|---|---|
| GET /warehouse/ingestion/sources | Page<IngestionSource> theo warehouseId/datasetId; `{sourceId,name,type,status}` không secrets |
| POST /warehouse/ingestion/run | `{warehouseId,datasetId,sourceId,idempotencyKey}` → 202 IngestionRun |
| GET /warehouse/ingestion/runs | Page<IngestionRun>; warehouseId,engine,datasetId,status,from,to,search |
| GET /warehouse/ingestion/runs/{runId} | IngestionRun + stage details/errors sanitized |

IngestionRun: runId,batchId,warehouseId,datasetId,engine,status,sourceId,rowsWritten,rejectedCount,startedAt,completedAt,durationMs,idempotent,steps,error. Nullable timestamps/duration trước hoàn tất. Stages RAW,STAGING,WAREHOUSE,MART; status PENDING,RUNNING,SUCCESS,FAILED,SKIPPED. Run status PENDING,RUNNING,SUCCESS,PARTIAL,FAILED. Idempotency key cùng principal+source+dataset+payload trả cùng run; reuse key với payload khác trả 409 INVALID_REQUEST. Không tự rerun failure và double insert.

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

Không có `/import/sql` trong phạm vi chính. Xem [future extensions](../future-extensions.md).
