# UI, authentication và dữ liệu — các điểm còn mở

Ghi nhận từ phản hồi và ảnh chụp app ngày 2026-10-19, cập nhật theo kiểm chứng ngày 2026-10-20. Phần chưa đáp ứng vẫn là acceptance bắt buộc; phần đã kiểm chứng được ghi dưới đây và trong [đánh giá hiện tại](project-status.md).

## Quy tắc dữ liệu giao diện

- UI nhận warehouse/dataset name, description, engine, schema/table/column, metrics, dimensions, examples, query results, history, ingestion/evaluation/monitoring từ Java API.
- Physical metadata và query rows phải được đọc từ warehouse đang chọn. Không hardcode số liệu, schema labels, database identity hoặc mô tả giả trong React/component hoặc Java bootstrap hiển thị như dữ liệu live.
- Warehouse/dataset display name và description là metadata cấu hình có chủ sở hữu (admin hoặc nguồn metadata); nếu tạo mặc định local thì lấy tên database/engine và đếm tables/columns/relations từ discovery thật. Không ghi câu như “metadata/result đọc trực tiếp” nếu nội dung đó thực ra được viết sẵn.
- Semantic metrics, dimensions, business rules và sample questions là metadata nghiệp vụ có thể do admin/data owner cấu hình. Phải tải từ semantic API, gắn trạng thái/nguồn và để empty state khi chưa có; không gọi chúng là giá trị tự sinh từ physical database. Fixture chỉ dành cho test.
- Filter options và badges phải thuộc đúng tập dữ liệu đang lọc (table categories không trộn với metric/example categories); count, page total và danh sách trả về phải nhất quán.

## Quan sát và tiêu chí sửa

| Ảnh người dùng gửi | Quan sát | Tiêu chí nghiệm thu |
|---|---|---|
| `Ảnh màn hình 2026-10-19 lúc 22.26.29.png` | Biểu đồ dạng số có khoảng trắng lớn; lựa chọn loại chart không khả dụng chưa thể hiện thật rõ. | Đã giảm chiều cao/padding biểu đồ số; cần kiểm tra visual regression trên trang kết quả và trạng thái các chart không tương thích. |
| `Ảnh màn hình 2026-10-19 lúc 22.27.01.png` | Bảng một hàng bị giãn rộng; thao tác sao chép trông như một cột dữ liệu. | Đã chuyển bảng sang intrinsic width và giới hạn action column; Playwright live kiểm tra bảng một cột không bị kéo đầy panel. Vẫn cần kiểm tra layout với bảng rộng/nhiều cột và màn nhỏ. |
| `Ảnh màn hình 2026-10-19 lúc 22.27.34.png` | Chọn danh mục `Sales` có badge 2 nhưng bảng trống; danh mục đang bị trộn giữa physical schema và semantic category. | Tách table/metric/example category; badge count phải là count đúng cho list endpoint tương ứng. Khi lọc schema/category hợp lệ, danh sách khớp với cùng API criteria; không có count 2 cho kết quả 0. |
| `Ảnh màn hình 2026-10-19 lúc 22.28.12.png` và ảnh follow-up 23.39.08 | SQL expected/generated trong evaluation/result bị dồn một dòng, thiếu syntax color; layout panel chiếm không gian chưa cân bằng. | SQL một dòng được format cho hiển thị thành clauses/projection nhiều dòng, có line numbers và màu syntax keyword/function/string/number/identifier theo ảnh. Copy vẫn lấy SQL gốc, React render text an toàn. Unit và browser test kiểm chứng line breaks/highlighting/copy; screenshot browser xác nhận layout ở 1728px bằng fixture. Còn cần visual regression đầy đủ desktop/tablet và đường evaluation chạy với Java thật. |
| `Ảnh màn hình 2026-10-19 lúc 22.32.19.png` | “Chinook Music Store” và dòng mô tả trong dataset panel được tạo cứng ở `LocalBootstrap`, không phải warehouse result. | Dùng tên DB/engine thật và mô tả counts lấy từ discovery; metadata user-configured chỉ được hiển thị như metadata, không tự khẳng định là live result. |

## Login và authorization

OIDC browser client và Java resource server đã chạy với IdP Keycloak thật, gồm authorization-code/PKCE, callback, sign-in/out, renewal/expiry, identity/role mapping và warehouse/dataset grants. Browser suite bốn roles đã PASS trên production bundle local, cùng kiểm tra token thiếu subject/sai audience/chữ ký, anonymous 401 và resource/role 403. Hướng dẫn tái tạo ở [oidc-local.md](oidc-local.md) và [docker-local.md](docker-local.md).

Local anonymous reader/token admin vẫn là development mode trên loopback, không thay cho OIDC. Deployment production HTTPS, IdP của môi trường đích và cấu hình vận hành dài hạn chưa được suy ra là đã nghiệm thu từ local IdP.

OIDC user session hiện được lưu trong `sessionStorage`, nên được duy trì sau khi tải lại trang trong cùng tab và tự hết khi đóng tab. Access token không được chuyển sang `localStorage`. Warehouse/dataset selection được lưu riêng theo subject; query cache bị xóa khi chuyển subject để tránh giữ context giữa các tài khoản. Local development token vẫn chỉ tồn tại trong memory của tab.

Chuông thông báo lấy warehouse health, ingestion health và số lỗi truy vấn từ Monitoring API khi mở menu; menu có loading/error state và không giả định sẵn một trạng thái hệ thống.

## Kiểm tra data thật trên mọi route

Với mỗi route Home, Query/Result, History, Catalog (mọi tabs/filter), Warehouse Registry, Ingestion, Evaluation, Monitoring và Settings, ghi lại request API, response source, warehouse/dataset ID và UI state. Physical data phải truy về selected engine; metadata platform phải truy về metadata store; semantic data phải là phiên bản đang active. Thử đổi engine/dataset, empty/error/loading, paginate/filter và bảo đảm không giữ dữ liệu cũ hoặc hiển thị fixture trong production.

“API trả 200” chưa đủ: so sánh row/category/page counts với database/API, và screenshot UI với cùng route/state/viewport của mock. Các ảnh là bằng chứng feedback; không thay screenshot/ảnh tham chiếu gốc.

## AI service — trạng thái sau `module/ai-completion`

### Native semantic planner reuse

`module/semantic-planner` adds a real private Wren runtime call to the query path. Python uses pinned `wren-core-py==0.4.0` and the adapted upstream CTE rewrite to resolve request-scoped physical models and rewrite candidate SQL for PostgreSQL, MySQL and SQL Server. Java builds the manifest only from the selected dataset's authorized CatalogService snapshot, validates the planner response, runs `SqlGuard` on rewritten SQL, and checks exact source-table lineage before JDBC. Planner errors fail closed. Provenance and limits are in [semantic-planner integration](integrations/semantic-planner.md); private request/response is in [the contract](contracts/semantic-planner.md).

Python native/unit tests and Java unit tests pass for the implementation branch. The Linux/amd64 image builds and a container HTTP smoke exercises SQL Server native rewrite. This evidence does not yet claim live Java→Python→three warehouse query-result equivalence on the final merged deployment. Provider smoke remains NOT RUN without a user-configured API key. The adapted manifest currently contains physical models/columns/relationships and does not compile user-configured metric expressions into Wren measures; that depth is separately INCOMPLETE.

Python nhận context bằng nested Pydantic models strict, kiểm tra tham chiếu table/column/metric/dimension/relationship/example trước khi gọi model, chọn examples cùng dialect và từ chối context vượt budget không thể giữ nhất quán. Candidate metrics/dimensions/chart được kiểm tra theo đúng context đã chọn gửi cho model; deterministic cũng chỉ khớp examples trong context đó. Provider chỉ nhận question, dialect và semantic context, không nhận warehouse/dataset IDs hay credential fields. Mocked HTTP tests kiểm tra request privacy, lỗi HTTP, timeout, response sai cấu trúc, SQL nhiều statement/comment, thao tác ghi và hàm truy cập file/network. Khi provider lỗi, AI không fallback sang deterministic; deterministic không tự bịa schema. Python chưa thay thế AST identifier security của Java; Java vẫn phải kiểm tra toàn bộ tên bảng/cột và là nơi duy nhất thực thi candidate SQL.

Trong nhánh hoàn thiện AI hiện tại, selector dùng index có cache theo hash của snapshot semantic cấu trúc; `referenceTime` mới nhất được đưa vào từng provider request. Mọi request đều retrieval, giữ đủ schema vật lý được chọn, metric/dimension liên quan, business rules, examples theo dialect và đường join khai báo; examples không khai báo selections vẫn giữ bảng được chỉ ra bởi FROM/JOIN. `LLM_REQUEST_MAX_BYTES` giới hạn chính xác body UTF-8 đã gửi qua HTTP. Với cùng snapshots dưới giới hạn, so với selector cũ (tối đa 8 examples cùng dialect), body Chinook giảm từ 12,438 xuống 5,177 bytes (58.38%), synthetic-support từ 10,428 xuống 6,429 bytes (38.35%). Test stress riêng đo full input chưa chọn 240,412 bytes và body đã chọn 22,894 bytes (90.47% nhỏ hơn); đây không phải baseline call production thông thường. Đây là số đo kích thước payload mocked, không phải token billing, latency, chất lượng model hay E2E thật. Attribution/hash Wren ở [docs/platform-reuse.md](platform-reuse.md); provider thật vẫn NOT RUN khi thiếu cấu hình.

Evaluation fixtures hiện nêu rõ 42 logical cases với `logicalCaseId`, gồm Chinook và một schema support tổng hợp chỉ dùng cho test; mỗi case có expectation cho PostgreSQL, MySQL và SQL Server, tổng cộng 126 logical case/dialect combinations. Test route deterministic xác nhận SQL candidate, metric/dimension, chart và rejection. **AI acceptance vẫn INCOMPLETE:** provider smoke thật bị skip khi chủ dự án chưa cấu hình key/URL/model; không có claim chất lượng provider thật từ bộ test deterministic/mock. Domain support đã được dựng bằng bảng test riêng trên cả ba engines và chạy 108 cases Việt/Anh qua Java, so expected độc lập bằng SQLite; bảng test được dọn và dataset test được disable. Cần xem work log cho lần rerun selector/checkout mới nhất. Chi tiết và cách chạy nằm ở [ai-service/evaluation](../ai-service/evaluation/README.md).

## Trạng thái tại điểm bàn giao

- Catalog categories, dataset label/description provenance, bảng một cột, scalar chart spacing và SQL format/highlight đã có implementation và regression checks. Chưa nghiệm thu pixel accuracy mọi màn/state/viewport.
- Frontend tích hợp: 118 unit tests PASS, production build/formatter PASS ; 23 mocked browser cases và live query/import/ingestion ba engines đã có bằng chứng. Mocked cases chỉ kiểm tra UI, không thay caller thật.
- Registry ingestion generic có API persistence và UI create/edit/test/run/history. Browser thao tác trên 12 bảng test typed mới, ghi đủ 24 dòng tại mỗi lớp RAW/STAGING/WAREHOUSE/MART của ba engines; kiểm COUNT độc lập và cleanup đã PASS. Không bắt người dùng thêm `data/<database>` để đăng ký nguồn. Targets/write grants được DBA tạo trước; pipeline không có quyền DDL tùy ý.
- SQL Import đã có upload/parse/preview/confirm immutable plan, async progress, idempotency, trạng thái partial/rollback/error và writer riêng. Chín cặp native/cross-dialect qua Java và UI ba engines đã PASS trong subset allowlisted. Unsupported SQL bị từ chối rõ; không execute file tùy ý.
- Docker Compose đóng gói FE/BE/Python/DB3, IdP và registry bootstrap qua API thật. Provider chưa được cấu hình; không có real-model acceptance.
- Đối chiếu dữ liệu live trên tất cả route/filter/large-result, nhiều datasets lớn, failure/recovery/load và production deployment vẫn cần nghiệm thu thêm. Không coi số test hoặc việc merge main là 100% hoàn thiện.

Các số trên là mốc bằng chứng, không là cam kết toàn bộ acceptance đã PASS; đọc [work log](work-log.md) cho commit, lần chạy cuối và phần NOT RUN.
