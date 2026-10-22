# Canonical domain

JSON dùng camelCase; ID là opaque string ổn định, không parse ý nghĩa từ ID. Timestamp ISO-8601 UTC (`...Z`), date `YYYY-MM-DD`. Engine/dialect enum duy nhất: `POSTGRESQL | MYSQL | SQL_SERVER`. Số lượng/latency dùng integer không âm trong phạm vi an toàn JSON; confidence là number 0..1. Field `?` là optional; nullable phải ghi rõ. Không gửi secret qua DTO.

## Warehouse

| Field                         | Kiểu / ý nghĩa                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| warehouseId                   | string                                                                             |
| name                          | string                                                                             |
| engine                        | engine enum; authoritative source cho sqlDialect                                   |
| status                        | ACTIVE / UNAVAILABLE / INVALID / DISABLED                                          |
| host, database, defaultSchema | string; defaultSchema có thể null khi engine không áp dụng                         |
| port                          | integer 1..65535                                                                   |
| username                      | string; chỉ trả connection config cho admin                                        |
| credentialReference           | string; write-only trong create/update; không trả secret/reference vào public list |
| capabilities                  | `{readOnlyQuery:boolean, metadataDiscovery:boolean}`                               |
| createdAt, updatedAt          | timestamp                                                                          |

List/selector dùng safe summary `{warehouseId,name,engine,status,capabilities}`; admin detail có connection fields trừ credentialReference. Test/discover không trả connection string có password. ACTIVE nghĩa kết nối khả dụng, không thay cho authorization.

## Dataset

| Field                                     | Kiểu / ý nghĩa                                       |
| ----------------------------------------- | ---------------------------------------------------- |
| datasetId, warehouseId, name, description | string                                               |
| status                                    | ACTIVE / INVALID_SCHEMA / DISABLED                   |
| allowedSchemas                            | string[]                                             |
| allowedTables                             | TableRef[]; `{schema:string, name:string}`           |
| semanticVersion, schemaVersion            | string, snapshot identifier; không lấy version từ UI |
| updatedAt                                 | timestamp                                            |

Không dùng tên bảng không qualified làm security allowlist. Với MySQL, `schema` trong canonical TableRef là database/catalog. Metadata normalization/quoting theo adapter; không lowercase mọi identifier bất kể engine/case rules. Status dataset không phản ánh mọi trạng thái warehouse; phải kiểm tra cả hai.

## Query request

`{warehouseId:string,datasetId:string,question:string,mode?:AUTO|API|DETERMINISTIC,providerId?:string}`. providerId chỉ hợp lệ cho API, chọn profile đã cấu hình; AUTO dùng mặc định, DETERMINISTIC không dùng provider. Default AUTO dùng provider server đã cấu hình; không ngầm chuyển deterministic khi provider lỗi. `question` trim, 1..1000 ký tự Unicode. Java suy ra dialect, allowed context, model và versions. Không chấp nhận client-supplied SQL/semanticContext/credential ở endpoint này.

## Query (public detail)

| Field                                            | Kiểu / ý nghĩa                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queryId, correlationId, warehouseId, datasetId   | string                                                                                                                                                                                                                                                                       |
| engine                                           | engine enum                                                                                                                                                                                                                                                                  |
| question                                         | string                                                                                                                                                                                                                                                                       |
| status                                           | RUNNING / SUCCESS / REJECTED / VALIDATION_ERROR / QUERY_ERROR / TIMEOUT                                                                                                                                                                                                      |
| candidateSql                                     | string hoặc null; output ban đầu của model/compiler, snapshot cũ default null                                                                                                                                                                                                |
| generatedSql                                     | string hoặc null nếu chưa sinh được; khi SUCCESS là SQL logic cuối được guard normalize/validate và chuyển executor; Query lỗi có thể giữ planned SQL trước khi guard đạt, không được gắn nhãn đã thực thi thành công; adapter có thể thêm envelope LIMIT hoặc cursor bounds |
| sqlDialect                                       | engine enum                                                                                                                                                                                                                                                                  |
| model                                            | string hoặc null trước khi xác định; model thực provider báo (fallback requested name nếu provider không trả)                                                                                                                                                                |
| provider                                         | nullable snapshot `{providerId,revision,name,kind,model,source}` theo [model providers](model-providers.md); model trong snapshot là requested model, không chứa key; snapshot cũ/offline/structured default null                                                            |
| executionMode                                    | API / DETERMINISTIC / SEMANTIC (structured metric selection; no LLM call)                                                                                                                                                                                                    |
| semanticVersion, schemaVersion                   | string, versions snapshot lúc chạy                                                                                                                                                                                                                                           |
| latencyMs                                        | integer hoặc null khi đang chạy                                                                                                                                                                                                                                              |
| createdAt, completedAt                           | timestamp; completedAt nullable                                                                                                                                                                                                                                              |
| explanation                                      | string hoặc null                                                                                                                                                                                                                                                             |
| assumptions, selectedMetrics, selectedDimensions | string[], default []                                                                                                                                                                                                                                                         |
| sourceTables                                     | TableRef[]                                                                                                                                                                                                                                                                   |
| result                                           | QueryResult hoặc null khi lỗi/chưa xong                                                                                                                                                                                                                                      |
| chart                                            | ChartSpec hoặc null                                                                                                                                                                                                                                                          |
| error                                            | ErrorBody hoặc null                                                                                                                                                                                                                                                          |

Terminal Query immutable; “chạy lại” tạo queryId mới, không ghi đè history. Query detail từ history vẫn dùng snapshot cũ; chạy lại kiểm tra context hiện tại. Status phản ánh execution, không chỉ thành công HTTP hay LLM.

## QueryResult

```text
columns: [{name, label, dataType, semanticRole, unit?}]
rows: array of objects keyed by unique column name
returnedRowCount: integer      # tổng số hàng materialized trong snapshot có giới hạn
page: integer                 # 1-based
pageSize: integer             # 1..100, default 20
truncated: boolean            # engine result bị cắt bởi max rows/bytes
```

`dataType`: STRING, INTEGER, BIGINT, DECIMAL, FLOAT, BOOLEAN, DATE, TIMESTAMP. `semanticRole`: DIMENSION, METRIC, TIME, OTHER. DECIMAL và BIGINT truyền chuỗi thập phân để tránh mất precision; FLOAT là JSON number hữu hạn, không NaN/Infinity; NULL giữ null; BOOLEAN giữ boolean. TIMESTAMP chuẩn hóa UTC khi có timezone, cột không có timezone phải có quy tắc dataset công khai và Java chuyển đổi trước khi trả. Không bịa timezone.

Java tạo alias duy nhất nếu output có tên trùng, đồng thời bảo toàn label nguồn. `rows.length` là số dòng trang hiện tại, `returnedRowCount` là tổng snapshot có thể phân trang. Không gọi returnedRowCount là tổng thật trong warehouse khi truncated. Không bắt chạy COUNT(*) toàn query chỉ để hiển thị số tổng.

Kết quả được lưu snapshot có giới hạn; GET trang sau và CSV đọc cùng snapshot, không rerun SQL âm thầm. Khi snapshot hết hạn trả RESULT_EXPIRED. Export chỉ xuất snapshot được cấp quyền, không bypass max rows/bytes bằng nút “xuất toàn bộ”. UI phải thông báo phạm vi dữ liệu export.

## ChartSpec

`{type, title, x?:string, series: [{column:string,label:string}], reason?:string}`.

`type`: table / number / bar / grouped-bar / line / area / pie. `x` và series.column phải tồn tại trong result. table có series=[]; number có một metric scalar; bar/pie có dimension + metric; line/area ưu tiên time + metric; grouped-bar có dimension + nhiều metrics đơn vị tương thích. Không trộn tiền và số đơn hàng trên cùng một trục như một số ảnh minh họa.

Python recommendation dùng cùng cấu trúc nhưng Java quyết định chart cuối sau khi kiểm tra shape/type/units; không hợp lệ thì table với reason. FE validate allowlist lần nữa. Không executable JS, HTML/component hay callback từ AI.

## List convention

Query params: `page=1&pageSize=20&sort=createdAt&direction=DESC`; pageSize tối đa 100. sort dùng allowlist từng endpoint, không nối trực tiếp SQL. Response `{items:[],page:1,pageSize:20,totalItems:0,totalPages:0}`; đây là count của resource list (registry/history), không tổng query warehouse. Stable sort có tie-breaker ID. Search là `search`, time filter UTC là `from`,`to` theo khoảng [from,to). Không tự giữ dataset cũ khi đổi warehouse.
