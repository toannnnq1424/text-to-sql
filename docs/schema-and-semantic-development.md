# Phát triển schema docs và semantic layer

Đọc cùng [application deep dive](application-deep-dive.md), [semantic contract](contracts/semantic-model.md) và [semantic workbench](semantic-workbench.md). Tài liệu này giải thích quy trình đang có trong code, cách xây định nghĩa cho một nguồn mới và các ranh giới chưa tự động hóa. Những định nghĩa bán hàng bên dưới là ví dụ hướng dẫn; không được chèn chúng vào core cho mọi database.

## 1. Ba lớp thông tin cần tách biệt

| Lớp             | Trả lời câu hỏi gì?                                                         | Ai là nguồn có thẩm quyền?                           |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Physical schema | Bảng/cột nào tồn tại, kiểu/nullability/PK/FK ra sao?                        | Metadata database qua adapter/discovery              |
| Schema docs     | Bảng/cột đó được mô tả bằng ngôn ngữ dễ hiểu như thế nào?                   | Metadata/comments và nội dung quản trị có provenance |
| Semantic layer  | “Doanh thu”, “khách mới”, “ngày báo cáo” nghĩa là gì, tính và join thế nào? | Data owner/admin duyệt definitions và business rules |

Một cột DECIMAL tên `SalesAmount` chưa tự chứng minh đó là tiền sau thuế, tiền USD hay doanh thu đã ghi nhận. Một FK tới DimDate chưa tự xác định ngày đặt hay ngày giao. Schema docs làm thông tin dễ tìm và dễ đọc; semantic layer chốt ý nghĩa và cấu trúc tính toán.

Tài liệu Markdown trong `docs/` mô tả quy trình phát triển. **Schema docs runtime không phải một thư mục Markdown viết tay cho từng warehouse.** Chúng được dựng từ context của Dataset đang được cấp quyền và được dùng trong Catalog, retrieval và prompt. Hiện chưa có workflow export/import một kho `.md` schema docs bất kỳ làm nguồn authority; không được mô tả workflow đó như tính năng đã có.

## 2. Physical schema đi vào application ra sao?

```text
Warehouse đăng ký → adapter kết nối bằng reader
                 → discover schema/table/column/type/PK/FK/comments
                 → Dataset allowlist lọc phạm vi
                 → Catalog/context của Dataset
```

[CatalogService](../backend/src/main/java/dev/nla/CatalogService.java) là điểm điều phối. Các adapter trong [warehouse](../backend/src/main/java/dev/nla/warehouse) xử lý khác biệt PostgreSQL/MySQL/SQL Server. Cache discovery hiện15giây, không phải bản sao metadata vĩnh viễn. `defaultSchema` giúp resolve tên không qualified; nó không thay allowlist/grants.

Một connection có thể discover nhiều schema hơn Dataset muốn dùng. Ví dụ SQL Server sample có thể trả thêm metadata ở schema khác; Dataset AdventureWorks chỉ chọn12bảng `analytics`. Không lấy tổng số bảng discovery làm số bảng Dataset nếu allowlist chỉ chọn một phần.

Nếu bảng trong allowlist biến mất, `tables(datasetId)` phát hiện thiếu và báo `SCHEMA_MISMATCH`/INVALID_SCHEMA thay vì giữ schema giả cũ. Thay đổi type/cột/constraints vẫn cần refresh, validation/version và kiểm thử tương ứng; app chưa tự dựng một hệ thống migration/version-history đầy đủ cho mọi DDL bên ngoài.

## 3. Code tạo schema docs runtime

### 3.1. Mô tả text và lexical index

[context_index.py](../ai-service/context_index.py) có `describe_schema(context)`. Nó tạo mô tả ổn định từ:

- Tên bảng qualified, logicalName, grain và description khi có.
- Cột, dataType, nullable, description và synonyms khi có.
- Metrics/expressions, dimensions/columns, relationships.
- Business rules và examples đúng context.

Đây là diễn giải có cấu trúc của dữ liệu đã cung cấp, không phải gọi LLM để bịa tài liệu. Ví dụ hình dạng text:

```text
Table analytics.FactInternetSales; grain: một dòng đơn hàng; description: ...
  Column SalesOrderNumber (STRING); nullable: false
  Column SalesAmount (DECIMAL): ...
Metric internet_sales_amount: ...; expression: SUM(...)
Relationship ...SalesTerritoryKey -> ...DimSalesTerritory.SalesTerritoryKey
```

Nội dung ví dụ chỉ minh họa; nếu grain/description chưa có thì runtime phải giữ rỗng/nguồn metadata thực, không trình bày câu trong ví dụ như đã được cấu hình.

`get_schema_index` canonicalize context, bỏ `referenceTime` khỏi cache key vì thời điểm hỏi liên tục đổi, rồi hash snapshot và tạo terms/graph. `referenceTime` hiện hành vẫn được gắn lại cho request. Cache tối đa32snapshot không chứa rows/credential/model response. Chuẩn hóa bỏ dấu và tách CamelCase/underscore phục vụ tìm kiếm; identifiers dùng chạy SQL vẫn giữ nguyên.

### 3.2. Tài liệu cho vector retrieval

[knowledge.py](../ai-service/knowledge.py) chuyển context thành manifest gồm models/columns/properties/relationships cùng semantic metrics/dimensions/rules. SDK source fork `schema_indexer.extract_schema_items`/MemoryStore tạo các mục tài liệu và lưu embeddings vào LanceDB.

Đây là một representation khác của cùng context, không có nghĩa lexical text là nguồn schema độc lập thứ hai. App phải giữ fingerprint và phạm vi truy cập nhất quán giữa chúng.

Namespace hash theo warehouseId + datasetId + dialect. Fingerprint nội dung theo manifest + examples + embedding model. Metadata/definitions đổi làm index STALE. Manifest hiện có semanticVersion và schemaVersion, nên đổi riêng nhãn phiên bản cũng đổi fingerprint và yêu cầu rebuild. Indexing tạo generation mới và chỉ publish khi hoàn tất; lỗi giữ thế hệ trước. Không lấy index cũ STALE làm authority cho schema mới.

Hiện mỗi index giới hạn10.000schemaitems, quota128datasetindexes và tối đa200curatedexamples/context; rebuild có giới hạn an toàn. Những số này là bounds hiện hành, không bảo đảm mọi warehouse hàng nghìn bảng vừa được model giải đúng.

## 4. Quy trình xây semantic layer cho nguồn mới

### Bước 1 — Chốt câu hỏi và grain trước công thức

Liệt kê người dùng cần quyết định gì và dữ liệu hỗ trợ tới đâu. Với AdventureWorks projection, cần phân biệt internet sales và reseller sales. Một dòng fact có khóa `(SalesOrderNumber, SalesOrderLineNumber)`, không phải một đơn hàng.

Định nghĩa tối thiểu của một metric cần trả lời:

1. Số đo nào, đơn vị nào và nguồn gốc đơn vị?
2. Aggregate trên grain nào, có distinct không?
3. Tính/loại những trạng thái, NULL và thời gian nào?
4. Dùng được cùng những dimensions nào?
5. Ai xác nhận ý nghĩa, oracle nào kiểm được?

Đừng dùng `AVG(SalesAmount)` rồi đặt tên `average_order_value` nếu mỗi row là một dòng hàng. Đừng gọi COUNT(*) là số đơn nếu một đơn có nhiều dòng. Một name/description đẹp không sửa được expression sai grain.

### Bước 2 — Xây dimensions

Dimension hiện trỏ tới một cột vật lý, ví dụ:

```json
{
  "name": "sales_country",
  "description": "Quốc gia của lãnh thổ bán hàng, không phải địa chỉ thanh toán.",
  "table": { "schema": "analytics", "name": "DimSalesTerritory" },
  "column": "SalesTerritoryCountry",
  "dataType": "STRING",
  "synonyms": ["quốc gia bán hàng", "sales country"]
}
```

Đây là definition ví dụ cho đúng source/engine/schema, không copy nguyên sang nguồn khác. Column phải tồn tại trong allowlist. Dimension expression/date-role tổng quát chưa được schema hiện tại biểu diễn tùy ý; không nhét một đoạn SQL vào `column` để lách contract.

### Bước 3 — Xây metric và dimensions tương thích

```json
{
  "name": "internet_sales_amount",
  "description": "Tổng SalesAmount của các dòng Internet Sales; chưa quy đổi tiền tệ.",
  "expression": "SUM(\"analytics\".\"FactInternetSales\".\"SalesAmount\")",
  "unit": "source amount",
  "tableRefs": [{ "schema": "analytics", "name": "FactInternetSales" }],
  "compatibleDimensions": ["sales_country"],
  "synonyms": ["tổng tiền bán internet", "internet sales amount"]
}
```

Expression trên minh họa PostgreSQL. SQL Server/MySQL cần quote/dialect đúng khi cấu hình; không đổi enum hoặc giả mọi cú pháp portable. Unit cố ý không suy USD từ tên cột. Khi owner xác nhận đơn vị/conversion, cập nhật definition và tests.

`compatibleDimensions` là ràng buộc nghiệp vụ/cấu trúc, không phải danh sách trang trí. Compiler phải tìm được đường an toàn từ bảng metric tới bảng dimension. Hai metric ở các fact khác nhau chưa có kế hoạch bảo toàn grain thì compiler hiện từ chối kết hợp; không đánh dấu mọi dimension tương thích cho tiện UI.

### Bước 4 — Chốt relationships và date roles

Relationships có endpoints bảng/cột và cardinality. Java merge discoveredFK với semantic relationships theo identity, kiểm các endpoints thuộc phạm vi được phép. Khai báo bổ sung không là quyền truy cập bảng ngoài Dataset.

Side được khai báo là “one” cần khóa vật lý hoặc uniqueness verification trong budget. Không đặt MANY_TO_ONE cho một cột đang trùng chỉ để compiler chịu tạo JOIN. Đường join mơ hồ phải được xử lý rõ.

AdventureWorks có OrderDateKey/DueDateKey/ShipDateKey cùng nối DimDate. Viết businessRule “dùng ngày đặt hàng” giúp model hiểu, nhưng compiler hiện chưa có một trường date-role để tự loại mọi đường khác. Không hứa rule text đã cưỡng chế mọi query. Với yêu cầu chưa biểu diễn được, giữ lỗi rõ, thiết kế contract/implementation thật hoặc dùng câu SQL đã review; không lặng lẽ chọn FK đầu.

### Bước 5 — Business rules, synonyms và examples

- Rule mô tả quyết định nghiệp vụ, chẳng hạn ngày báo cáo hoặc trạng thái tính doanh thu. Quy tắc cần bảo đảm bằng máy phải có structured representation/validator tương ứng; text đơn thuần là context, không phải policy engine hoàn chỉnh.
- Synonyms giúp nối từ người dùng với định nghĩa: tiếng Việt/Anh, cách gọi trong tổ chức. Bỏ dấu hỗ trợ lexical retrieval, không thay quyết định ý nghĩa.
- Examples là cặp question/SQL đúng dialect, có owner và oracle. Không thêm một kho đáp án demo rồi báo AI đã tự hiểu mọi câu.
- Đưa Query SUCCESS vào Knowledge là approval có chủ đích; phải review nghiệp vụ vì SQL chạy được vẫn có thể tính sai.

### Bước 6 — Validate bản nháp

UI Ngữ nghĩa giữ draft riêng; sửa draft làm kết quả validation cũ không còn dùng được. `POST /datasets/{id}/semantic-model/validate` yêu cầu ADMIN và kiểm quyền resource.

[SemanticController.validateDocument](../backend/src/main/java/dev/nla/SemanticController.java) thực hiện:

1. Kiểm fields/size/timezone/schemaVersion.
2. Thay `tables` người gửi bằng physical tables từ Catalog. Không cho “khai thêm bảng” trong payload thành schema thật.
3. Kiểm tên, expression, references, compatibleDimensions và cardinality.
4. Kiểm examples đúng dialect bằng Java guard.
5. Gửi context sang private `business-validate`; source-fork compiler parse/resolve expressions/joins và trả semanticVersion/valid theo contract.

Validate không phải chạy SQL ghi data và không tự activate definition. Nó cũng không chứng minh metric đúng ý business owner hoặc mọi kết quả ổn trên production; cần oracle và review riêng.

### Bước 7 — Activate version mới

Đổi `semanticVersion` khi đổi nội dung rồi lưu qua API/workbench có kiểm quyền. `schemaVersion` phải phù hợp Dataset hiện tại; không sửa tùy ý để bỏ qua schema drift. Định nghĩa active lưu trong metadata, không trong React source.

Version là nhãn snapshot phục vụ truy vết, không phải chiến lược “version1 thiếu chức năng rồi version2 mới làm”. Query cũ giữ version/model/SQL/result lúc chạy; nó không được diễn giải lại như đã dùng công thức mới. Metadata store hiện giữ active definitions và query/run snapshots; không nên quảng cáo một hệ thống Git-like diff/branch/rollback semantic definitions hoàn chỉnh nếu chưa có workflow đó.

### Bước 8 — Chạy oracle, rebuild knowledge và nghiệm thu UI

Chạy structured semantic selection trước để tách compiler/formula khỏi khả năng hiểu câu của LLM. So số liệu với source records hoặc SQL oracle độc lập. Sau đó thử câu tự nhiên Việt/Anh/không dấu/typo, ambiguity/date roles/top-N và error cases. Kiểm chart/result aliases/units và history/version.

Rebuild Knowledge khi nội dung đổi; kiểm READY rồi thử search. Approved examples ở fingerprint cũ không được tự giữ sang metadata mới mà bỏ review. Đổi Warehouse/Dataset trong UI phải đổi suggestions, descriptions, counts và context; không giữ mô tả Chinook trên nguồn mới.

## 5. AI hỗ trợ phát triển ngữ nghĩa ở đâu?

Admin nhập mục tiêu trong “Đề xuất ngữ nghĩa bằng AI”. Model mặc định đọc authorized metadata, đề xuất metrics/dimensions/rules. [semantic_assist.py](../ai-service/semantic_assist.py) dùng strict response và compiler fork kiểm proposal; Java kiểm lại draft được merge với active definitions trước khi trả UI.

Áp dụng proposal chỉ thay draft. Owner vẫn phải kiểm đơn vị, grain, joins và thời gian; đổi version, validate rồi activate. AI không tự đọc hết database để xác nhận ý nghĩa, không tự phát hiện mọi quy tắc kế toán và không có quyền ghi active definition từ prompt. Model error trả lỗi thật, không dựng một proposal giả.

## 6. Những việc hiện làm được và phần còn thiếu

| Khả năng                                                           | Trạng thái thực                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Discovery physical schema/PK/FK/comments ba engine                 | Implementation/caller thật                                                |
| Catalog + schema text/index từ authorized context                  | Implementation thật, không cần Markdown riêng mỗi database                |
| ADMIN editor metrics/dimensions/relationships/rules/examples       | Có validate/activate/version và API/persistence                           |
| AI đề xuất bản nháp ngữ nghĩa                                      | Có model client + fork compiler + Java checks, cần owner review           |
| Structured semantic query                                          | Có compiler/guard/execution, không gọi LLM                                |
| Vector schema docs/approved examples                               | Có source-kit MemoryStore/LanceDB/local embeddings, fingerprint/lifecycle |
| Arbitrary Markdown schema-doc repository import/export             | Chưa có workflow tổng quát được nghiệm thu                                |
| Semantic definition Git-like history/diff/rollback                 | Chưa có workflow hoàn chỉnh; active và query snapshots không thay nó      |
| Date-role selector/calculated dimension tổng quát                  | Chưa đủ representation hiện tại để hứa mọi trường hợp                     |
| Full multi-fact cube/ranking theo metric trong structured explorer | Chưa triển khai đầy đủ; limit hiện không phải top-N ranking               |
| Business meaning tự được AI xác minh đúng                          | Không được bảo đảm; cần owner/oracle                                      |

Khi phát triển tiếp một phần còn thiếu, phải chốt contract, implementation, security, persistence, caller UI và tests trong cùng phạm vi công việc. Không thêm field/interface rỗng rồi gọi semantic layer đã hoàn chỉnh.

## 7. Checklist thực hành cho một Dataset mới

1. Đăng ký/discover qua UI, chọn allowlist đúng và kiểm grants.
2. Ghi grain/keys/nullability/units/date roles từ nguồn có thẩm quyền; đánh dấu chưa biết thay vì đoán.
3. Định nghĩa một metric và một dimension có join an toàn, không trộn fact grain.
4. Validate draft, đổi semanticVersion, activate và xác nhận Catalog đọc đúng definition active.
5. Chạy structured query, so oracle, rồi hỏi tự nhiên bằng model cụ thể; giữ riêng hai loại bằng chứng.
6. Rebuild/search Knowledge, kiểm metadata đổi→STALE và scope không lẫn Dataset khác.
7. Thử typo/không dấu/ambiguous names/NULL/decimal/date/top-N/error, kiểm result và provenance.
8. Ghi work log/evidence/giới hạn; không lấy một screenshot đẹp hoặc model trả SQL hợp cú pháp làm bằng chứng business correctness.
