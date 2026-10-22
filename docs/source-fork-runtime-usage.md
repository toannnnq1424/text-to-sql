# Kiểm chứng mức sử dụng thật của hai source fork

Ngày kiểm tra: 2026-10-22. Báo cáo này lần theo import, caller, cấu hình build và bài kiểm tra trong repo. “Đã đưa source vào repo” không đồng nghĩa toàn bộ 417.117 dòng đang chạy; danh sách dưới đây tập trung vào các điểm tích hợp runtime có bằng chứng.

## Kết luận nhanh

- Gợi ý câu hỏi ở Query/Home **không gọi AI và không gọi source fork nào**. `DatasetSuggestionService.derive` ở Java đọc bảng/cột, metrics/dimensions và ví dụ đã duyệt từ catalog rồi dựng các câu hỏi theo quy tắc đơn giản. Các câu “Tổng … theo …” dựa trên kiểu cột có thể không mang nghĩa nghiệp vụ. Cần khai báo semantic definitions đã được quản trị xác nhận để có tên, công thức, đơn vị và dimension có ý nghĩa.
- Source fork semantic được gọi thật cho planning/rewrite SQL, compiler semantic/pipeline, và kho tri thức truy hồi theo dataset. Một số file trong namespace fork là phần NLA tự thêm, không phải implementation nguyên gốc.
- Source fork data-tool được gọi thật để khởi tạo native pool cho PostgreSQL, MySQL, SQL Server. Ứng dụng **không chạy MCP Toolbox server** và không gọi trực tiếp các MCP SQL tools; executor riêng của ứng dụng giữ authentication, read-only boundary, giới hạn và chuẩn hóa kết quả.
- Hai snapshot được import đầy đủ, nhưng nhiều connector, CLI, MCP server, cloud service và tool chỉ hiện diện trong `vendor/upstream/`; chúng không được tính là tính năng runtime.

## 1. Gợi ý câu hỏi trong ảnh đến từ đâu?

Caller UI là [QueryPage.tsx](../frontend/src/pages/QueryPage.tsx), gọi API qua [catalogApi.ts](../frontend/src/api/catalogApi.ts) đến `GET /datasets/{id}/question-suggestions`. Controller và phần tạo gợi ý nằm ở [DatasetSuggestionController.java](../backend/src/main/java/dev/nla/DatasetSuggestionController.java) và [DatasetSuggestionService.java](../backend/src/main/java/dev/nla/DatasetSuggestionService.java), phương thức `derive`.

`derive` đọc physical schema hiện tại để tạo câu hỏi đếm dòng, nhóm theo cột phân loại, hoặc tổng hợp cột số theo cột khác/thời gian. Sau đó nó đọc semantic metrics/dimensions đang active và curated examples phù hợp dialect. Cả nội dung lẫn provenance đều trả từ Java. Endpoint không gọi `AiClient`, `SemanticPlannerClient`, Python, `WrenEngine`, `WrenMemory`, Go runtime hay model provider. Tests: [DatasetSuggestionTest.java](../backend/src/test/java/dev/nla/DatasetSuggestionTest.java) và [AnalyticsExperience.test.tsx](../frontend/src/pages/AnalyticsExperience.test.tsx).

Điều này có ích như một danh sách khởi đầu dựa trên nguồn hiện tại, nhưng không tương đương “AI hiểu domain”. Loại `DECIMAL` chỉ chứng minh một cột là số; nó không chứng minh cột đó là doanh thu hay có đơn vị tiền. Đó là lý do gợi ý vật lý được gắn nhãn `Từ schema thực`, còn gợi ý từ semantic model và ví dụ admin có provenance riêng. Semantic model hiện là nơi khai báo tên metric, công thức, đơn vị, grain và dimension tương thích.

## 2. Source fork semantic (`wren-engine-main`)

### Files điều khiển build và cài source

| File | Vai trò đang dùng |
|---|---|
| [ai-service/Dockerfile](../ai-service/Dockerfile) | Copy SDK từ `vendor/upstream/semantic-engine/wren/` vào image và cài package local đó. |
| [ai-service/sdk-requirements.txt](../ai-service/sdk-requirements.txt) | Pin dependency closure, `sqlglot` và native `wren-core-py`; đây là binary native phụ thuộc platform, không phải toàn bộ Rust core tự build từ source trong mỗi lần chạy. |
| [infra/upstream/install_ai.py](../infra/upstream/install_ai.py) | Cài SDK từ snapshot local cho môi trường phát triển. |

### Runtime files có caller thật

| File trong source fork | Caller phía app | Năng lực thật đang dùng |
|---|---|---|
| `vendor/upstream/semantic-engine/wren/src/wren/engine.py` | Java [QueryService.java](../backend/src/main/java/dev/nla/QueryService.java) → [SemanticPlannerClient.java](../backend/src/main/java/dev/nla/SemanticPlannerClient.java) → Python [app.py](../ai-service/app.py) → [semantic_planner.py](../ai-service/semantic_planner.py) | `WrenEngine.plan_for_dataset` chuyển sang specialization NLA, sau đó dùng `WrenEngine.dry_plan` và native semantic session để rewrite candidate. Planning-only chặn mở connector/thi hành truy vấn. |
| `vendor/upstream/semantic-engine/wren/src/wren/mdl/__init__.py` | [session_context.py](../ai-service/third_party/wren_semantic/session_context.py) và `engine.py` | Gọi factory `get_session_context` thật. Wrapper app giới hạn cache 8 manifest nhỏ và lease/lock; không cache câu hỏi, SQL, kết quả hay câu trả lời model. |
| `vendor/upstream/semantic-engine/wren/src/wren/mdl/cte_rewriter.py` | `engine.py::dry_plan` | CTE rewriting/dialect behavior của SDK; candidate được native planner xử lý, không chỉ pass-through. |
| `vendor/upstream/semantic-engine/wren/src/wren/policy.py` | `engine.py::_plan` với strict mode | Policy kiểm tra câu SQL trong bước native planning; Java vẫn chạy SqlGuard độc lập sau rewrite. |
| `vendor/upstream/semantic-engine/wren/src/wren/type_mapping.py` | `nla_planning.py` | Parse kiểu vật lý mà alias nội bộ chưa bao phủ; loại không hỗ trợ bị từ chối. |
| `vendor/upstream/semantic-engine/wren/src/wren/memory/__init__.py`, `vendor/upstream/semantic-engine/wren/src/wren/memory/store.py`, `vendor/upstream/semantic-engine/wren/src/wren/memory/schema_indexer.py` | [knowledge.py](../ai-service/knowledge.py) | `WrenMemory` thật lập chỉ mục schema/semantic metadata, tìm context và ghi/nhớ ví dụ đã duyệt bằng LanceDB. Khi bật `KNOWLEDGE_ENABLED`, luồng generation AUTO/API gọi retrieval; deterministic bỏ qua. Ollama embedding được inject bởi app adapter. |

### File NLA thêm/sửa bên trong fork (không phải upstream nguyên bản)

Các file này có patch manifest trong [full-source-patches.json](integrations/full-source-patches.json); chúng thể hiện phần fork đã chỉnh cho sản phẩm:

| File trong source fork | Caller | Trách nhiệm |
|---|---|---|
| `vendor/upstream/semantic-engine/wren/src/wren/engine.py` (đã sửa) | `semantic_planner.py` | Điểm nối từ API SDK vào planner theo physical dataset, session lease và planning-only mode. |
| `vendor/upstream/semantic-engine/wren/src/wren/nla_planning.py` (mới) | `engine.py::plan_for_dataset`; Python [semantic_assist.py](../ai-service/semantic_assist.py) cũng dùng reason code | Bind bảng/cột theo manifest đã cấp quyền, kiểm tra CTE/AST read-only, native resolution, lineage trước/sau rewrite, parse type. Không thay Java authorization/SqlGuard. |
| `vendor/upstream/semantic-engine/wren/src/wren/nla_compaction.py` (mới) | `nla_planning.py` | Dọn wrapper CTE/projection identity chỉ trong cấu trúc đã xác minh, giữ CTE có nghĩa và kiểm tra lại source lineage. |
| `vendor/upstream/semantic-engine/wren/src/wren/nla_business.py` (mới) | `app.py` business-plan/validate; `semantic_assist.py`; Java `QueryService` và `SemanticController` | Compiler AST cho metric/dimension đã khai báo, lọc, join/cardinality và grain. Không phải text-to-SQL LLM và không được xem output là SQL đã thực thi. |
| `vendor/upstream/semantic-engine/wren/src/wren/nla_transform.py` (mới) | `app.py` transform-plan ← Java [TransformationPipelineService.java](../backend/src/main/java/dev/nla/TransformationPipelineService.java) | Compile biểu thức/filter/group-by đã khai báo thành SQL theo dialect trong các stage pipeline. Java kiểm tra và thực thi output. |
| `vendor/upstream/semantic-engine/wren/src/wren/memory/__init__.py`, `vendor/upstream/semantic-engine/wren/src/wren/memory/store.py`, `vendor/upstream/semantic-engine/wren/src/wren/memory/schema_indexer.py` (đã sửa) | `knowledge.py` | Mở rộng record index cho metric/dimension/business rule và nhận embedding adapter do app quản lý; giữ LanceDB/retrieval implementation của source kit. |

Các caller được kiểm tra bằng [test_semantic_planner.py](../ai-service/test_semantic_planner.py), [test_sql_compaction.py](../ai-service/test_sql_compaction.py), [test_workbench.py](../ai-service/test_workbench.py), [SemanticPlannerClientTest.java](../backend/src/test/java/dev/nla/SemanticPlannerClientTest.java), [QueryRuntimeSecurityTest.java](../backend/src/test/java/dev/nla/QueryRuntimeSecurityTest.java) và [TransformationPipelineTest.java](../backend/src/test/java/dev/nla/TransformationPipelineTest.java). Chúng kiểm tra contract, planner/compiler, retrieval, policy và caller; không chứng minh mọi native connector của SDK hoạt động trong app.

## 3. Source fork data-tool (`mcp-toolbox-main`)

### Files gọi native source thật

| File trong source fork | Caller trong app | Năng lực thật đang dùng |
|---|---|---|
| `vendor/upstream/data-tool-platform/internal/sources/postgres/postgres.go` | [sources.go](../data-tool-runtime/sources.go) | `postgres.Config.Initialize`, URL/pool setup và native pgx pool. |
| `vendor/upstream/data-tool-platform/internal/sources/mysql/mysql.go` | `sources.go` | `mysql.Config.Initialize` và native `database/sql` pool. |
| `vendor/upstream/data-tool-platform/internal/sources/mssql/mssql.go` (đã patch) | `sources.go` | `mssql.Config.Initialize` và native SQL Server pool; app patch thêm connect timeout/TLS/IPv6-safe host handling. |
| `vendor/upstream/data-tool-platform/internal/util/util.go` | `sources.go` | User-agent context helper trong lúc mở source. |

[`data-tool-runtime/go.mod`](../data-tool-runtime/go.mod) dùng Go `replace` trỏ thẳng đến snapshot trong repo. Điểm gọi backend là [DataToolRuntimeClient.java](../backend/src/main/java/dev/nla/warehouse/DataToolRuntimeClient.java); chỉ sau khi Java authorize và validate SQL mới gọi private Go `/internal/v1/query`.

### Phần là adapter của sản phẩm, không phải tool server của upstream

`data-tool-runtime/main.go`, `server.go`, `sources.go`, `pools.go` và `results.go` là private executor wrapper của sản phẩm. Nó dùng native source factory/pool của fork, còn lớp HTTP riêng, host allowlist, service token, bounded pool leases, cancellation, read-only transaction, cursor scan, byte/row caps và canonical JSON do adapter sở hữu. Query không đi qua MCP tool `RunSQL` của upstream. Java còn xác nhận kết quả/giới hạn và giữ quyền quyết định thi hành.

`backend/src/main/java/dev/nla/warehouse/NativeMetadataDescriptions.java` và các resource metadata SQL là code/adaptation riêng có license/provenance trong repo, không phải lời gọi MCP metadata tool. JDBC discovery vẫn lấy physical identity, column type và keys từ database thật.

Bài kiểm tra caller nằm ở [runtime_test.go](../data-tool-runtime/runtime_test.go), [DataToolRuntimeClientTest.java](../backend/src/test/java/dev/nla/warehouse/DataToolRuntimeClientTest.java) và [NativeMetadataLiveTest.java](../backend/src/test/java/dev/nla/warehouse/NativeMetadataLiveTest.java). Integration test native cần Compose/credential local; unit test không thay thế phép đo production load.

## 4. Source hiện có nhưng không tính là capability đã bật

Không có caller runtime trong sản phẩm cho: các MCP HTTP/stdio server và YAML toolsets tổng quát của data-tool; tool quản trị/ghi như DDL, filesystem, cloud IAM; các nguồn ngoài PostgreSQL/MySQL/SQL Server; phần lớn connector/CLI/server/MCP/cloud deployments của semantic snapshot; và SQL engines khác ngoài dependency path đã mô tả. `vendor/upstream/` giữ inventory gốc và patch provenance; sự hiện diện ở đó không làm UI/API tự hỗ trợ connector.

## Cách lần theo nhanh

1. Tìm điểm gọi sản phẩm: `QueryService`, `SemanticController`, `TransformationPipelineService` hoặc `DataToolRuntimeClient`.
2. Theo private route/caller Python hoặc Go adapter.
3. Xác nhận import package local/build path (`Dockerfile`, `sdk-requirements.txt`, Go `replace`).
4. Đối chiếu file upstream/patch với `docs/integrations/full-source-patches.json` và test caller.

Số dòng code source fork, UI demo, tên thư mục hay README upstream không phải bằng chứng dùng runtime. Chỉ call chain và test ở trên được tính là phần đang tích hợp.
