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
| `Ảnh màn hình 2026-10-19 lúc 22.26.29.png` | Biểu đồ dạng số có khoảng trắng lớn; lựa chọn loại chart không khả dụng chưa thể hiện thật rõ. | Layout số dùng chiều cao phù hợp; loại không tương thích với scalar có disabled reason/state rõ; chart/title/units lấy từ result metadata, chart fallback đúng. |
| `Ảnh màn hình 2026-10-19 lúc 22.27.01.png` | Bảng một hàng bị giãn rộng; thao tác sao chép trông như một cột dữ liệu. | Copy là action column có kích thước nhỏ; giữ layout cân đối từ ít đến nhiều cột, hỗ trợ scroll ngang, paging/filter/export khớp server result. |
| `Ảnh màn hình 2026-10-19 lúc 22.27.34.png` | Chọn danh mục `Sales` có badge 2 nhưng bảng trống; danh mục đang bị trộn giữa physical schema và semantic category. | Tách table/metric/example category; badge count phải là count đúng cho list endpoint tương ứng. Khi lọc schema/category hợp lệ, danh sách khớp với cùng API criteria; không có count 2 cho kết quả 0. |
| `Ảnh màn hình 2026-10-19 lúc 22.28.12.png` | SQL expected/generated trong evaluation bị cắt và cần cuộn ngang riêng; layout panel chiếm không gian chưa cân bằng. | Dùng grid responsive, line wrap/scroll có chủ đích, không cắt code hoặc đẩy nội dung ngoài viewport; kiểm tra desktop/tablet. |
| `Ảnh màn hình 2026-10-19 lúc 22.32.19.png` | “Chinook Music Store” và dòng mô tả trong dataset panel được tạo cứng ở `LocalBootstrap`, không phải warehouse result. | Dùng tên DB/engine thật và mô tả counts lấy từ discovery; metadata user-configured chỉ được hiển thị như metadata, không tự khẳng định là live result. |

## Login và authorization

Code hiện đã có OIDC browser client và backend JWT resource server, nhưng môi trường Quick Start chưa cấu hình identity provider. Local profile cho phép GET anonymous trên loopback và dùng local API token cho thao tác quản trị. Đây là chế độ development, **chưa phải trải nghiệm login cho người dùng thật**.

Acceptance còn mở: cấu hình OIDC authority/client/redirect/logout; login/logout/callback/loading/expired/error states; hiển thị user/role thật; role-based navigation và action permissions; backend resource-level warehouse/dataset authorization; kiểm thử unauthenticated/forbidden/session expiry. Không tạo local password database. Không coi local admin token là tính năng login hoàn chỉnh.

## Kiểm tra data thật trên mọi route

Với mỗi route Home, Query/Result, History, Catalog (mọi tabs/filter), Warehouse Registry, Ingestion, Evaluation, Monitoring và Settings, ghi lại request API, response source, warehouse/dataset ID và UI state. Physical data phải truy về selected engine; metadata platform phải truy về metadata store; semantic data phải là phiên bản đang active. Thử đổi engine/dataset, empty/error/loading, paginate/filter và bảo đảm không giữ dữ liệu cũ hoặc hiển thị fixture trong production.

“API trả 200” chưa đủ: so sánh row/category/page counts với database/API, và screenshot UI với cùng route/state/viewport của mock. Các ảnh là bằng chứng feedback; không thay screenshot/ảnh tham chiếu gốc.

## Trạng thái

Catalog category bug (mix table/metric/example categories) và local dataset label/description hardcoding đã được sửa trong work branch này. Các layout issues, full OIDC provider configuration, end-to-end SQL Import và xác minh dữ liệu thật trên mọi route vẫn cần implementation/verification trước khi đánh dấu acceptance hoàn tất. Work log phải nêu chính xác checks mới chạy.
