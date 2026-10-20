# UI, authentication và dữ liệu — các điểm còn mở

Ghi nhận từ phản hồi và ảnh chụp app ngày 2026-10-19. Đây là acceptance gaps của implementation hiện tại và là phần bắt buộc phải hoàn tất, không phải hướng mở rộng.

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

Code hiện đã có OIDC browser client và backend JWT resource server, nhưng môi trường Quick Start chưa cấu hình identity provider. Local profile cho phép GET anonymous trên loopback và dùng local API token cho thao tác quản trị; form đăng nhập admin local hiện đã hiển thị trực tiếp trên banner khi đang ở Local Reader, thay vì chỉ nằm trong Cài đặt. Đây là chế độ development, **chưa phải trải nghiệm login qua identity provider cho người dùng thật**.

Acceptance còn mở: cấu hình OIDC authority/client/redirect/logout; login/logout/callback/loading/expired/error states; hiển thị user/role thật; role-based navigation và action permissions; backend resource-level warehouse/dataset authorization; kiểm thử unauthenticated/forbidden/session expiry. Không tạo local password database. Không coi local admin token là tính năng login hoàn chỉnh.

OIDC user session hiện được lưu trong `sessionStorage`, nên được duy trì sau khi tải lại trang trong cùng tab và tự hết khi đóng tab. Access token không được chuyển sang `localStorage`. Warehouse/dataset selection được lưu riêng theo subject; query cache bị xóa khi chuyển subject để tránh giữ context giữa các tài khoản. Local development token vẫn chỉ tồn tại trong memory của tab.

Chuông thông báo lấy warehouse health, ingestion health và số lỗi truy vấn từ Monitoring API khi mở menu; menu có loading/error state và không giả định sẵn một trạng thái hệ thống.

## Kiểm tra data thật trên mọi route

Với mỗi route Home, Query/Result, History, Catalog (mọi tabs/filter), Warehouse Registry, Ingestion, Evaluation, Monitoring và Settings, ghi lại request API, response source, warehouse/dataset ID và UI state. Physical data phải truy về selected engine; metadata platform phải truy về metadata store; semantic data phải là phiên bản đang active. Thử đổi engine/dataset, empty/error/loading, paginate/filter và bảo đảm không giữ dữ liệu cũ hoặc hiển thị fixture trong production.

“API trả 200” chưa đủ: so sánh row/category/page counts với database/API, và screenshot UI với cùng route/state/viewport của mock. Các ảnh là bằng chứng feedback; không thay screenshot/ảnh tham chiếu gốc.

## AI service — trạng thái sau `module/ai-completion`

Python nhận context bằng nested Pydantic models strict, kiểm tra tham chiếu table/column/metric/dimension/relationship/example trước khi gọi model, chọn examples cùng dialect và từ chối context vượt budget không thể giữ nhất quán. Provider client đã có mocked HTTP tests cho request shape, lỗi HTTP, timeout, response sai cấu trúc, SQL nhiều statement/comment, các thao tác ghi và hàm truy cập file/network. Khi provider lỗi, AI không fallback sang deterministic; deterministic tiếp tục chỉ khớp semantic examples đã khai báo và không tự bịa schema. Candidate SQL vẫn do Java validate rồi mới thực thi.

Evaluation fixtures hiện nêu rõ 42 logical cases với `logicalCaseId`, gồm Chinook và một schema support tổng hợp chỉ dùng cho test; mỗi case có expectation cho PostgreSQL, MySQL và SQL Server, tổng cộng 126 logical case/dialect combinations. Test route deterministic xác nhận SQL candidate, metric/dimension, chart và rejection. **AI acceptance vẫn INCOMPLETE:** provider smoke thật bị skip khi thiếu cấu hình key/URL/model; synthetic support chưa có warehouse vật lý và chưa đi qua Java executor để chứng minh result equivalence; không có claim chất lượng provider thật từ bộ test deterministic/mock này. Chi tiết và cách chạy nằm ở [ai-service/evaluation](../ai-service/evaluation/README.md).

## Trạng thái

Catalog category bug (mix table/metric/example categories), local dataset label/description hardcoding, compact one-column result table, compact scalar chart spacing, SQL line formatting/highlighting, local admin entry, tab-scoped OIDC session, identity-scoped warehouse context và dữ liệu thật trong system notification menu đã có implementation. Frontend suite (101 tests), production build và mocked browser E2E (20 tests, gồm field-heavy routes ở 1024px/390px và system notification API data) đã pass cho FE hiện tại; live E2E ba engines trước đó đã pass cho query paths. Những kết quả này chưa thay cho visual review mọi trường hợp. Ingestion runtime còn chỉ có ba pipeline Chinook sample; source registry/API/UI để đăng ký pipeline cho warehouse khác còn thiếu. OIDC provider chưa được cấu hình trong Quick Start, in-app SQL Import, và đối chiếu nguồn dữ liệu thật trên mọi route vẫn chưa hoàn tất. Work log phải nêu chính xác checks mới chạy.
