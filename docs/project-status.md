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

## Trường hợp2: tính thêm hai bộ nguồn — cập nhật tích hợp

Ước lượng70% / reuse25–30% trước đây đã cũ: khi ấy chỉ có context index và native metadata. Hiện đã đưa native semantic core/CTE rewrite và native executor dùng driver/pool/cursor của bộ thứ hai vào luồng mặc định. Không đổi số phần trăm theo số dòng mã; trạng thái dưới đây thể hiện capability đã chạy và giới hạn thật.

| Nguồn | Runtime đã nối | Bằng chứng tích hợp |
|---|---|---|
| Semantic engine | Core native0.4.0, ManifestExtractor, SessionContext transform, upstream CTE/dialect rewrite, phân giải projection/CTE/physical lineage; Java kiểm tra AST và nguồn lần nữa | Query API/browser DB3;108 ca support song ngữ so với SQLite độc lập;58 Python PASS/1 provider SKIP; native quoted-case/qualifier/CTE regression |
| Data tool runtime | Native PG/pgx, MySQL và SQLServer drivers, bounded connection pools/leases/rotation, cancellation, canonical decimal/BIGINT/UUID/bool/time, private Java transport | Native Go race/DB3 tests; Java→Go→DB3; query API/browser; giữ reader grants/time/row/byte bounds |
| Local file dispatch | Arrow format conversion và upload parser riêng13 extension, automatic full-file inference, preview/mapping, batch4layers, Dataset registration |39 format/engine pairs plus active100k-row cancellation DB3, exact persistence/cleanup; real OIDC browser upload/catalog DB3 |

Không claim cả sản phẩm upstream hoặc mọi cloud connector đã chạy. Native metric-measure compiler của upstream, vector retrieval/cloud IAM/connectors ngoài DB3 và vận hành production/load dài hạn chưa được nghiệm thu. LLM provider thật vẫn chưa chạy theo lựa chọn của người dùng để key cấu hình sau; core SQL planner không tự thay thế model sinh câu hỏi tự do. [Chi tiết nguồn/mapping](platform-reuse.md), [file contract](contracts/file-ingestion.md), [work log](work-log.md).

## Bằng chứng baseline trước đợt tích hợp này và giới hạn

- Frontend tích hợp: 118 unit tests, 23 mocked browser cases, build và format PASS; live import/ingestion DB3 có kiểm tra persistence độc lập. Python: 44 PASS, 1 provider smoke SKIP; infra/data: 31 PASS.
- Backend sau khi tích hợp metadata: 65 tests, không failure/error/skip, có Docker/Testcontainers và ba database thật.
- SQL Import qua Java: chín cặp source→target, preview/digest/idempotency/persistence, rows/NULL/decimal kiểm tra trực tiếp DB; PASS.
- Domain support: 108 Vietnamese/English case-engine runs qua Java→Python→database, so với expected độc lập bằng SQLite; PASS trong deterministic mode.
- Docker: đã build ba app images, healthchecks và query API/browser qua ba engines; OIDC bốn roles, 401/403, renewal/expiry/logout đã PASS. Lần chạy cuối dùng app source `57ddbcf`, có cả hai phần reuse; query UI/API, import9, support108 và OIDC đều PASS. Work log ghi lệnh và giới hạn.
- Unit/mock provider tests chỉ chứng minh request/response/error handling, không chứng minh model thật sinh SQL chính xác. Mức giảm payload trong corpus kiểm thử không suy ra mức giảm billing/latency của provider.
- Chưa có clean-machine run với volumes hoàn toàn mới, CI pipeline bắt buộc hoặc audit production/performance toàn diện; không suy ra các mục đó từ build PASS.

Lệnh, branch/commit, kết quả FE/AI cuối và trạng thái PR/main được ghi tại [work-log.md](work-log.md). Tài liệu này là điểm dừng bàn giao theo yêu cầu người dùng, không phát sinh task triển khai mới.

## Acceptance mới của đợt tích hợp source/file

Backend79 tests PASS/no skip trên Docker/Testcontainers và DB3; frontend124 unit PASS, build/25 mocked browser PASS; parser18 PASS; native planner58 PASS/1 provider SKIP. Packaged Compose có đủ5 app services healthy. Upload13extension×3engine39 pairs và3active cancellation PASS. Browser OIDC thật query và file upload/catalog DB3 PASS, các bảng kiểm thử đã được kiểm tra/dọn theo manifest. Các thay đổi nhỏ về quoted-case/qualifier/source identity và packaging evaluation được kiểm tra lại khi đóng đợt; work log là nguồn evidence cuối, không suy PASS provider từ tests offline.

## Source adoption — cập nhật2026-10-21

Hai bộ source đã được nhập trong repo với417.117 dòng code theo inventory. Python cài/gọi SDK semantic trực tiếp từ source; Go gọi native source factories trực tiếp từ source qua local module replace. [Bản đồ caller và giới hạn](integrations/full-source-adoption.md) ghi chính xác phần đang chạy. Không cộng phần trăm chỉ từ lượng code nhập. Engine source không bao gồm toàn bộ Wren AI Service; [Ollama/API](llm-provider.md) có hướng dẫn cấu hình nhưng inference thật vẫn NOT RUN.
