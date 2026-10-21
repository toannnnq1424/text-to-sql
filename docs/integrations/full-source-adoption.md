# Full source adoption và các điểm gọi thật

## Quyết định hiện hành

Người dùng yêu cầu nhập cả hai source trong Downloads, dùng bộ kit như thành phần thực của dự án và kiểm tra việc nối API. Quyết định này thay giới hạn cũ chỉ lấy các file nhỏ. Hai snapshot đã được đưa vào repo, giữ license/provenance và tên package kỹ thuật; sản phẩm vẫn dùng branding riêng.

| Snapshot | Vị trí trong repo | Entries nhập | Dòng code |
|---|---|---:|---:|
| `wren-engine-main` | `vendor/upstream/semantic-engine` | 1.233 | 142.909 |
| `mcp-toolbox-main` | `vendor/upstream/data-tool-platform` | 2.072 | 274.208 |
| Tổng | | 3.305 | 417.117 |

Entries gồm file và symlink, không bao gồm Git/cache/build output. Một file `.env` của ví dụ DuckDB bị loại, không đưa cấu hình riêng tư vào Git. Dòng code được đếm theo đuôi Go/Rust/Python/Java/TypeScript/JavaScript/C/C++/SQL/Proto/Shell, không tính Markdown như code. [Inventory](full-source-inventory.json) lưu đường dẫn, kích thước, checksum hoặc symlink target gốc. [Patch manifest](full-source-patches.json) lưu hash trước/sau và lý do của các file upstream đã sửa và extension mới của fork. Source còn lại được giữ nguyên; kiểm tra bằng `python3 infra/upstream/verify.py`.

**Đưa toàn bộ source vào repo không có nghĩa toàn bộ source đang chạy.** Bảng dưới mô tả phần đã có consumer thật. Những binary/server/connector khác nằm trong source kit, chưa được bật hoặc nghiệm thu chỉ vì có mặt trong thư mục.

## Caller và dependency thực

| Khả năng | Điểm gọi của app | Implementation từ kit | Trạng thái |
|---|---|---|---|
| Semantic dry plan, manifest extraction, strict policy, CTE rewrite/dialect | React query → Java `QueryService` → `SemanticPlannerClient` → private Python `/internal/v1/semantic-plan` → `semantic_planner.py` → fork `WrenEngine.plan_for_dataset` | Local `wren-engine` SDK `WrenEngine.dry_plan`, MDL utilities, `wren-core-py==0.4.0` | Được gọi thật; Docker cài SDK từ source trong repo, không dùng bản SDK ngầm từ máy maintainer |
| SQL gọn nhưng giữ nghĩa | Cùng caller `QueryService`/semantic-plan → fork `nla_planning.py` → `nla_compaction.py` | Native plan/rewrite từ kit + specialization SQLGlot AST của fork | Bỏ wrapper identity do planner sinh, giữ user CTE/column lists và lineage; Java vẫn kiểm lại SQL cuối, không chỉ hiển thị candidate ngắn hơn |
| Native session lifecycle | `third_party/wren_semantic/session_context.py` lease → SDK session factory; SDK nhận session override | Actual SDK `get_session_context` factory + native core | Cache tối đa8 sessions, manifest eligibility64KiB, khóa theo lease, không cache SQL/rows/provider response |
| SQL physical type conversion | Manifest normalization trong fork `nla_planning.py` | SDK `wren.type_mapping.parse_type` | Được gọi với type không nằm trong alias scalar của app; unsupported type fail closed |
| PostgreSQL/MySQL/SQL Server native sources/pools | Java guard → private `/internal/v1/query` → Go `OpenSource` | Actual `internal/sources/{postgres,mysql,mssql}.Config.Initialize` và native pools | Dependency Go `replace` trỏ source trong repo; query/preview/test/run dùng consumer này |
| Bounded execution/canonical JSON | Go query cursor, source lease/cache | Native source/driver kit + phần guard/result app đã tích hợp | Read-only transaction, reader credentials, auth, host allowlist, time/row/byte/concurrency bounds vẫn bắt buộc |
| Metadata comments và file dispatch/type parsing | Java discovery; private file parser | Các adaptation đã ghi ở hồ sơ trước | Đã nối caller; không bị thay bằng demo của upstream |

SDK đã được fork cho luồng NLA: `engine.py::plan_for_dataset()` gọi implementation mới `nla_planning.py`, nhận SQL vật lý thay vì bắt Java sinh SQL theo model logic. Fork giữ manifest bất biến, phân giải schema/case/CTE, xác minh native model resolution và so khớp physical source set sau rewrite. Các lệnh ghi trong CTE/SELECT INTO/multiple statements bị chặn; planning-only mode chặn mở connector/query. Đây là implementation hiện hành, thay phần planner trùng lặp trước ở AI service; service chỉ giữ DTO/auth/error mapping. SDK cũng nhận session lease do app quản lý, tránh cache không giới hạn của mặc định. SQL Server source patch thêm connection timeout, certificate verification tường minh và IPv6 host formatting. Không đổi public DTO/API/engine enum. Các bản CTE/dialect nhỏ đã copy trước đây được xóa khỏi `ai-service/third_party` để không giữ hai implementation cạnh tranh.

Java tiếp tục sở hữu OIDC/resource authorization, manifest allowlist, SQL guard sau rewrite, lineage comparison, execution decision, snapshots/history/audit và import/ingestion. Python SDK chỉ dry-plan, không gọi connector/query hoặc nhận warehouse credentials. Native tool runtime không expose arbitrary MCP tools cho browser/LLM; SQL/comment telemetry của upstream được tắt, tracer là noop. Adapter/tool chung không bỏ qua quyền của app.

## Engine, bộ AI và model local/API

Snapshot `wren-engine-main` là context/semantic engine, SDK/CLI, connector/server và native core. Nó **không chứa toàn bộ Wren AI Service** với pipeline retrieval/generation/embedding của ứng dụng Wren AI. Xem [README source](../../vendor/upstream/semantic-engine/README.md) và [kiến trúc chính thức](https://docs.getwren.ai/oss/overview/introduction). Không ghi đã apply toàn bộ AI Service khi chỉ cài Engine SDK. Các cloud connectors/CLI/MCP/server còn lại được nhập cùng kit, chưa bật toàn bộ trong sản phẩm.

App hiện có model client riêng gọi API tương thích qua `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`; có thể trỏ về Ollama local theo [hướng dẫn](../llm-provider.md). Ollama local đã được cài và dùng trong đợt workbench theo [hướng dẫn](../ollama-local.md); kiểm chứng cuối nằm ở work log. Model online giữ nguyên cấu hình và không được kiểm thử. Deterministic semantic examples giúp kiểm chứng planner/database; không phải bằng chứng LLM inference, training hoặc chất lượng câu hỏi tự do.

## Build và kiểm chứng

Clone mới chạy Docker bình thường:

```bash
python3 infra/local/compose.py up
python3 infra/upstream/verify.py
python3 infra/upstream/check_runtime.py --suite chinook-core
```

Lệnh cuối cần local Compose/OIDC đã sẵn sàng, chọn đúng corpus Chinook được provision bởi launcher, chạy48cases trên từng engine và lưu report riêng tư `.local/full-adoption-evaluation.json`. Không tự chọn suite theo thứ tự API vì các domain có thể dùng cùng engine.

Chạy AI trực tiếp trên host:

```bash
python3 -m venv ai-service/.venv
python3 infra/upstream/install_ai.py
ai-service/.venv/bin/pip install -r ai-service/requirements-dev.txt
ai-service/.venv/bin/python -m pytest ai-service
```

Các unit tests upstream được chọn trong lần này chạy bằng cùng venv (dev requirements chứa `orjson` cho fixtures):

```bash
ai-service/.venv/bin/python -m pytest \
  vendor/upstream/semantic-engine/wren/tests/unit/test_engine.py \
  vendor/upstream/semantic-engine/wren/tests/unit/test_cte_rewriter.py \
  vendor/upstream/semantic-engine/wren/tests/unit/test_policy.py \
  vendor/upstream/semantic-engine/wren/tests/unit/test_type_mapping.py \
  vendor/upstream/semantic-engine/wren/tests/unit/test_context.py
```

Installer dùng interpreter trong venv, dependency closure đã pin và editable local SDK. Docker build cài cùng source nhưng không editable. Native core Linux hiện cần amd64; Compose giữ platform tường minh. Native Go build dùng source local qua `data-tool-runtime/go.mod`; không yêu cầu repo tiếp tục nằm trong Downloads.

Các kiểm chứng của lần tích hợp và giới hạn nghiệm thu được ghi trong [work log](../work-log.md): app Python/native tests, upstream unit tests, Java suite, DB3 typed/cancellation và caller UI/API thật. Không coi import417k dòng là nghiệm thu tất cả cloud connectors, SDK query/CLI, metric measure compilation, toàn bộ test upstream, LLM thật hay production load.

## Business workbench và model local

Luồng mới và điểm gọi source kit được ghi tại [semantic workbench](../semantic-workbench.md). BusinessCompiler và TransformCompiler là specialization trong source fork: parse/resolve AST theo metadata được cấp phép, output qua native plan và Java guard. MemoryStore/schema_indexer thực của kit lưu LanceDB với Ollama embeddings local, được UI Tri thức AI và provider context selection gọi thật. Java thực thi các lớp biến đổi độc lập và đăng ký mart, còn UI Ngữ nghĩa/Pipelines quản lý definition và caller. Bằng chứng cuối xem work log; không suy ra cloud support từ source presence.

Semantic assistance có caller React→Java→private Python→model đã cấu hình→BusinessCompiler của fork để kiểm tra đề xuất theo cột/bảng thật. Java kiểm tra độc lập bản nháp hợp nhất trước khi trả về, UI cần người dùng xem lại/validate/activate. Đây là tích hợp model client của dự án với compiler đã fork, không chạy nguyên ứng dụng upstream hoặc tự nhận engine kit có sẵn toàn bộ AI Service. Gợi ý câu hỏi từ schema/metrics là mẫu được tạo theo metadata hiện tại; ví dụ curated là cấu hình có chủ sở hữu, không phải kết quả query được chèn sẵn.

Linux/amd64 dùng bản `lancedb-compat==0.40.0` chính thức có CPU baseline x86-64-v2; wheel thông thường cùng version dùng AVX2 và đã segfault dưới emulation trên host arm64. Docker build phải thực thi list/create/vector search để phát hiện lỗi native này trước deployment. Đây là cùng API/source-kit MemoryStore, không thay bằng mock hay in-memory index. [CPU wheel notes](https://github.com/lancedb/lancedb/blob/main/python/README.md).
