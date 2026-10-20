# Đánh giá mức hoàn thiện — 2026-10-20

Đây là ước lượng kỹ thuật theo phạm vi và bằng chứng acceptance, không phải phần trăm dòng code, số file hoặc số test. Dùng điểm tròn để phản ánh độ bất định; merge vào `main` không tự đồng nghĩa sản phẩm đã nghiệm thu. Cấu hình LLM API key được chủ dự án chủ động để lại tới khi có key.

## Trường hợp 1: target gốc, không tính việc tận dụng hai bộ nguồn Downloads

**Ước lượng khoảng 80%**, với trọng số FE 25%, BE 35%, Data 20%, AI 20%.

| Phần | Ước lượng | Đã có bằng chứng | Phần còn thiếu để nghiệm thu target |
|---|---:|---|---|
| FE | 85% | Các routes dùng API Java; query/result/catalog/history, registry, import, ingestion, evaluation, monitoring/settings; regression unit/browser; query thật qua ba engines | Đối chiếu thị giác toàn bộ màn/state theo ảnh gốc, kiểm tra live đầy đủ mọi route/filter/large-result và accessibility; không tuyên bố pixel-perfect |
| BE | 85% | Ba adapters thực, guard/query/persistence; OIDC roles/resource checks; immutable import plan và async run; generic source registry và bốn lớp pipeline; native metadata | Mở rộng security/failure/timeout/recovery corpus qua caller thật; tải đồng thời và vận hành dài hạn; deployment HTTPS/IdP thực tế của môi trường đích |
| Data | 80% | Chinook có provenance/checksum/grants ba engines; typed four-layer provisioning; application ingestion có API thật; import matrix chín cặp; domain support độc lập đã chạy qua Java và ba databases | Kiểm thử datasets lớn và nhiều schema/type/constraint thực tế ngoài corpus đã chạy; data-quality/recovery/operational coverage rộng hơn. Chinook không phải star-schema warehouse |
| AI | 65% | Provider API path có implementation, structured output và controlled errors; deterministic ba dialects/hai domain; context/few-shot/request-byte checks | Provider smoke/evaluation thật chưa chạy; chưa có số liệu chất lượng câu hỏi mới, typo/ambiguity, token billing và latency thực; budget hiện đếm bytes, chưa đếm tokens theo model. Deterministic chỉ khớp examples đã khai báo |

Tổng điểm theo các trọng số trên là 80%; phạm vi chưa nghiệm thu vẫn thuộc target, không được chuyển thành “future work” để gọi 100%. Local training là tùy chọn nên không tính là phần bắt buộc còn thiếu.

## Trường hợp 2: tính thêm việc tận dụng sâu hai bộ nguồn Downloads

**Ước lượng khoảng 70%** nếu dành khoảng 80% trọng số cho target gốc và 20% cho hạng mục reuse sâu đã ghi trong [platform-reuse.md](platform-reuse.md). Hạng mục reuse hiện khoảng 25–30%; 80% × 80% + 20% × 25–30% ≈ 69–70%.

Mức này thấp hơn vì phạm vi cần hoàn thiện tăng, không phải code đã làm bị mất giá trị. Không được cộng số lượng connector của upstream vào tiến độ của app.

| Bộ nguồn | Phạm vi reuse đã chọn để chốt lần này | Chưa tích hợp sâu |
|---|---|---|
| Semantic engine | Index/relevance context, mô tả schema và cache được nối vào selector/provider path; giữ authorization snapshot và business rules; license/provenance riêng | Rust/DataFusion planner, MDL compiler/semantic rewrite, lineage đầy đủ, vector retrieval, SDK/connector lifecycle chưa trở thành runtime của app |
| Data tool runtime | Native metadata SQL cho mô tả bảng/cột của ba engines, có caller discovery → Java→Python context và kiểm tra DB thật | Chưa chạy Go MCP server, connection-pool/toolset lifecycle, transport/auth/telemetry upstream hoặc executor riêng; không expose `execute_sql` tùy ý |

Các connector S3/Spark/Doris/Athena/BigQuery/ClickHouse/Databricks/DuckDB/GCS/Local files/MinIO/Oracle/Redshift/Snowflake/Trino đã được ghi theo yêu cầu tại [future-connectors.md](future-connectors.md). Chúng không thuộc denominator ba engines bắt buộc hiện tại và chưa được báo là app hỗ trợ. “Tận dụng tối đa” cần chọn consumer có ích và nghiệm thu từng capability; không có nghĩa chép toàn bộ source rồi tính hoàn thành.

## Bằng chứng và giới hạn

- Frontend tích hợp: 118 unit tests, 23 mocked browser cases, build và format PASS; live import/ingestion DB3 có kiểm tra persistence độc lập. Python: 44 PASS, 1 provider smoke SKIP; infra/data: 31 PASS.
- Backend sau khi tích hợp metadata: 65 tests, không failure/error/skip, có Docker/Testcontainers và ba database thật.
- SQL Import qua Java: chín cặp source→target, preview/digest/idempotency/persistence, rows/NULL/decimal kiểm tra trực tiếp DB; PASS.
- Domain support: 108 Vietnamese/English case-engine runs qua Java→Python→database, so với expected độc lập bằng SQLite; PASS trong deterministic mode.
- Docker: đã build ba app images, healthchecks và query API/browser qua ba engines; OIDC bốn roles, 401/403, renewal/expiry/logout đã PASS. Lần chạy cuối dùng app source `57ddbcf`, có cả hai phần reuse; query UI/API, import9, support108 và OIDC đều PASS. Work log ghi lệnh và giới hạn.
- Unit/mock provider tests chỉ chứng minh request/response/error handling, không chứng minh model thật sinh SQL chính xác. Mức giảm payload trong corpus kiểm thử không suy ra mức giảm billing/latency của provider.
- Chưa có clean-machine run với volumes hoàn toàn mới, CI pipeline bắt buộc hoặc audit production/performance toàn diện; không suy ra các mục đó từ build PASS.

Lệnh, branch/commit, kết quả FE/AI cuối và trạng thái PR/main được ghi tại [work-log.md](work-log.md). Tài liệu này là điểm dừng bàn giao theo yêu cầu người dùng, không phát sinh task triển khai mới.
