# Acceptance matrix

Tất cả mục bên dưới **chưa chạy** ở phiên tài liệu. Mỗi task triển khai dùng trạng thái PASS / FAIL / BLOCKED / NOT RUN và link evidence (command, environment, commit, report/screenshot). Không suy diễn PASS từ việc viết test hay có fixture. DoD prompt gốc áp dụng sau điều chỉnh scope; SQL Import là optional extension.

| Phạm vi | Điều cần chứng minh | Kiểm tra/evidence |
|---|---|---|
| Contracts | TS/Java/Pydantic cùng request/response; strict enum/null/decimal/pagination/error | Schema validation + consumer/provider contract tests |
| FE shell | Sidebar fixed + route active đúng, hai selectors, typography/layout/ảnh sát reference từ đầu | Screenshot cùng viewport + visual diff/manual notes |
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
| Build/deployment | FE build/tests, mvn test, pytest, Compose all services | Actual commands/logs with versions/host evidence |

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

Tính năng mandatory không được đánh dấu done bằng placeholder, TODO hoặc UnsupportedOperationException. SQL Import/local training chỉ được đưa vào acceptance khi có task mở rộng riêng, không làm chậm scope chính.
