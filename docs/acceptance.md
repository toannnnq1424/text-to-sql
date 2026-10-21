# Acceptance matrix

Các mục bên dưới là acceptance cuối. Một số FE/BE/AI/warehouse paths đã chạy theo [work log](work-log.md), nhưng phản hồi UI ngày 2026-10-19 ghi nhận gaps còn mở tại [current review](current-review.md); không đánh dấu toàn bộ sản phẩm hoàn thành. Mỗi task ghi PASS / FAIL / BLOCKED / NOT RUN cùng command, environment, commit và report/screenshot. SQL Import trực tiếp trong app, ingestion, OIDC login và live-data completeness đều mandatory.

| Phạm vi | Điều cần chứng minh | Kiểm tra/evidence |
|---|---|---|
| Contracts | TS/Java/Pydantic cùng request/response; strict enum/null/decimal/pagination/error | Schema validation + consumer/provider contract tests |
| FE shell | Sidebar fixed + route active đúng, hai selectors, typography/layout/ảnh sát reference từ đầu | Screenshot cùng viewport + visual diff/manual notes |
| UI review regression | Single-number chart, narrow/wide result table, evaluation SQL blocks, filters/categories, all field/form density | Regression screenshots per review images 2026-10-19; responsive viewport; no clipped/overflow content; badge/list counts agree |
| Runtime content provenance | Không hardcode sample dataset identity/descriptions/counts; tách physical metadata và semantic configuration | Trace UI values to API response and selected DB; empty semantic state; tests for changing warehouses/datasets |
| FE states | Loading/empty/error/timeout/partial/disabled/unavailable/schema mismatch/large data | Vitest/RTL + UI interaction checks |
| FE query | Submit/clear/samples/context switch stale request handling, six tabs dynamic | MSW tests rồi Java integration |
| Result | 0,1,10,100,1000+ rows; wide/long/null/bool/date/timestamp/decimal/percentage | Table paging/sort/scroll/copy/export/truncation, no precision loss |
| Chart/SQL | Allowlist, invalid spec fallback, dynamic dialect/source tables, long SQL scroll | Fixture shape cases, reject executable content |
| Registry/catalog | Register/edit/disable/test/discover; semantic vs physical schema validation | DB-backed API tests 3 engines, metadata large-list tests |
| Java adapters | Tất cả methods required implement thật, safe limit/dialect/quoting/timeout | Shared contract Testcontainers PostgreSQL/MySQL/MSSQL |
| Security | Recursive AST, multi stmt/write/file/network deny, allowlist/auth/read-only grant | Parser corpus + DB privilege tests 3 engines |
| Query/history | Persistence status/versions/model/correlation, immutable snapshot paging/CSV, expiry | Success + failed query integration, filters/pagination |
| Python real API | Configurable provider, no DB credentials, structured output, controlled errors | pytest httpx mock; configured real provider smoke (no key in report) |
| Python deterministic | Offline, 3 dialects, cross-domain, unsupported explicit | pytest no outbound network, same fixture protocol |
| AI context | Selection/budget/join paths/few-shot/dialect/ambiguity/confidence | Vietnamese/English cases, no hardcoded business domain |
| Data/ELT | Schema agreed with BE, deterministic seeds, provenance, idempotency, rejected rows | Repeat same batch no duplicates; row counts/integrity checks |
| Ingestion UI/API | Registered sources + stages/history/detail/error state | Controlled pipeline run via Java, no arbitrary SQL |
| Evaluation | ≥40 logical cases, ≥2 domains, Việt/Anh, all 3 dialects = ≥120 combinations | Result equivalence + dialect/parse/validation/execution/chart/latency reports |
| Monitoring | Volume/rates/provider errors/rejections/timeouts/p95 per engine/dataset | Seed known event counts; null for no sample, accurate denominators |
| Settings/auth | Safe config only, role/resource scope, dev profile isolated | API authorization tests, no leaked credential |
| Login/OIDC | Real sign-in/out, callback, token renewal/expiry/error, identity and role mapping; local token is dev-only | Configured test IdP + browser E2E + API unauthenticated/forbidden/resource-scope tests |
| SQL Import | Native/cross-dialect SQL subset across PostgreSQL/MySQL/SQL Server; no arbitrary execution | Upload→detect/parse→preview/warnings→confirm immutable plan→progress/result/error, parser/security corpus, DB integrity and idempotency tests per target |
| In-app ingestion | Registered source and actual Raw→Staging→Warehouse→Mart writes per engine | Repeated-batch idempotency, source/schema validation, rejected row accounting, run detail/recovery and UI history from real API |
| Live data completeness | Every product route reflects selected warehouse/dataset and authoritative API; no stale/fixture payload | Route-by-route API/network evidence, compare table/page/category/row totals against DB, engine switch and empty/error/loading cases |
| Build/deployment | FE build/tests, mvn test, pytest, Compose all services | Actual commands/logs with versions/host evidence |

## Điều kiện hoàn thành từng module

Áp dụng đầy đủ [implementation-rules.md](implementation-rules.md). Mỗi module phải có implementation thật trong scope cam kết, validation, error handling, security liên quan, tests cần thiết và tích hợp thật thuộc cùng lần triển khai. Abstraction bắt buộc phải có implementation tương ứng hoạt động. Không chấp nhận skeleton, endpoint/screen placeholder, core TODO, chỉ happy path, UI/contract/mock/stub-only hoặc giảm target để demo. Không chuyển chức năng bắt buộc còn thiếu thành future work/roadmap/extension point.

Ảnh mock chỉ là chuẩn phong cách UI; không lấy dữ liệu giả/fallback giả làm bằng chứng UI đã tích hợp. Thiếu dữ liệu/lỗi phải hiển thị đúng state. Kết quả kiểm thử cô lập không thay evidence đường chạy thật.

## E2E cuối bắt buộc

- React → Java → Python → PostgreSQL → React.
- React → Java → Python → MySQL → React.
- React → Java → Python → SQL Server → React.

Mỗi path cần câu hỏi hợp lệ, kết quả/SQL/dialect/metadata/chart đúng, history có record và correlationId, đồng thời có rejected unsafe question/SQL và timeout scenario. Deterministic dùng để tái lập pipeline; real provider mode cần smoke riêng để chứng minh feature gọi API, không chỉ deterministic hoặc UI mock. UI chọn engine từ registry, không branch screen theo vendor.

Cùng logical question và equivalent dataset phải kết quả tương đương sau canonicalization. Không yêu cầu SQL giống hệt string. Case TOP N có ties cần tie-break/order expectation; decimal/timezone/collation và null khác engine phải được định nghĩa trong evaluation, không tự bỏ qua khác biệt.

## Mẫu báo cáo

```text
Task / commit:
Mode (MSW / mock AI / deterministic / real provider):
Engine + database/image versions + host:
Command / scenario:
Status PASS|FAIL|BLOCKED|NOT RUN:
Evidence:
Remaining limitation:
```

Tính năng mandatory không được đánh dấu done bằng placeholder, TODO hoặc UnsupportedOperationException. SQL Import/ingestion/login chưa được pass chỉ bằng UI/API shape; cần end-to-end security, failure handling và three-engine evidence. Local training vẫn là tùy chọn.

## Workbench và local model

- Semantic editor: active physical context → validate expression/references/cardinality → activate phiên bản mới; structured metrics/dimensions/filter → native plan → Java guard → DB3 → immutable Query/history. Sai grain/column/version/timezone và unauthorized role/resource bị từ chối.
- Knowledge: real source-kit LanceDB index/search, local embeddings, persisted status/counts, stale fingerprint, approval/delete/reset; không data rows/secrets, SQL examples phải còn hợp lệ. Real API mode qua local Ollama phải chứng minh model + SQL + giá trị DB3; deterministic/mock không thay thế.
- Pipeline: actual source → independently projected/filtered/aggregated RAW/STAGING/WAREHOUSE/MART, preview không DDL và nói rõ sample, canonical precision/time, full-source quota fail closed, persisted async/idempotency/collision, reader-verifiable mart Dataset. PG/MSSQL rollback khác MySQL partial/outcome-unknown; không tự drop dữ liệu ngoài identity test.
- UI: ba sidebar routes mới, active warehouse/dataset, loading/empty/error/permission, controls lấy metadata thật và ngăn submit draft chưa validate; screenshot cùng style mock, actual OIDC caller3engines. Source-kit CPU compatibility phải chạy vector operations trong image build.

## Chất lượng dữ liệu và inference admission

- Sáu loại quality rules phải chạy full-table read-only trên cả3engine: null, duplicate-extra, numeric inclusive range, text accepted-set, count assertion và reference NOT EXISTS; null/rỗng/duplicate reference không nhân counts, count/decimal strings chính xác. Independent reader oracle và dữ liệu được app upload không dùng sample fallback.
- Rule revisions và run snapshot/history persist sau restart, role/resource scoped reads/writes; schema/disabled/unknownref bị chặn, queue/deadline/interruption/late-result bảo toàn terminal state và partial checks. UI editor/run/history/context switch/readonly role/responsive cùng Java thật.
- Inference active+waiter bounded, admission nằm trong deadline và shared generation/semantic-assist; correction giữslot, timeout/cancel/error release; offline/native/business bypass. Test concurrency/error isolation và local Ollama smoke riêng, online không tự thử.
