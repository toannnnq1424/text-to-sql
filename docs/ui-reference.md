# UI reference — chuẩn thị giác từ bước đầu

Ảnh gốc được phép commit, xem [images/README](../images/README.md). Giữ nguyên file; không dùng ảnh toàn màn hình làm UI giả. Mở ảnh local trước khi code màn tương ứng. Ảnh 01–10 là chuẩn chính vì shell đồng nhất và rõ hơn; 11–14 là bổ sung chi tiết, không dùng để đổi shell.

## Mapping ảnh và route

| Ảnh | Route/màn | Cách sử dụng |
|---|---|---|
| [01](../images/01-home.png) | `/` | Shell, hero, card density; nội dung đổi sang platform overview API |
| [02](../images/02-query-workspace.png) | `/query` | Canonical question workspace, suggestions, dataset info, tips |
| [03](../images/03-query-overview.png) | `/query/:id/overview` | Canonical result overview, summary/table và result tabs |
| [04](../images/04-catalog-tables.png) | `/catalog/tables` | Catalog filters, categories, table + detail panel |
| [05](../images/05-evaluation.png) | `/evaluation/*` | Run controls, metrics, case table + SQL comparison |
| [06](../images/06-query-chart.png) | `/query/:id/visualization` | Chart controls, series panel, preview; không copy mixed-unit axis sai |
| [07](../images/07-query-sql.png) | `/query/:id/sql` | SQL pane, explanation, assumptions, source/join/security info |
| [08](../images/08-query-history.png) | `/history/*` | History filters, pagination, selected-row detail |
| [09](../images/09-query-data.png) | `/query/:id/data` | Large table, truncation banner, CSV, horizontal scroll |
| [10](../images/10-ingestion.png) | `/ingestion/*` | Pipeline stages, run history, failure panel |
| [11](../images/11-dataset-selector-alternate.png) | Global dataset selector | Dropdown content only; không lấy alternate sidebar/topbar |
| [12](../images/12-query-overview-alternate.png) | Result overview | Metadata summary/table density tham khảo, không thêm result flow thứ hai |
| [13](../images/13-metric-detail.png) | `/catalog/metrics/:name` | Metric detail navigation, units/synonyms/expression |
| [14](../images/14-catalog-metrics.png) | `/catalog/metrics` | Metric table/filter taxonomy; dùng shell chính |

Result tabs chuẩn: Overview, Data, Visualization, SQL, Explanation, Technical (nhãn UI có thể Việt hóa đồng nhất). Catalog có Overview, Tables, Metrics, Dimensions, Relationships, Examples. Không tạo ba bộ tab khác nhau vì ảnh lặp.

## Shell và route active

Desktop sidebar fixed toàn chiều cao; content có offset đúng chiều rộng sidebar. Topbar liên tục chứa breadcrumb, Warehouse selector, Dataset selector/status, language, notifications, user. Sidebar cuối có Workspace/Dataset card. Thứ tự: Trang chủ `/`, Truy vấn `/query/*`, Lịch sử truy vấn `/history/*`, Data Catalog `/catalog/*`, Đánh giá `/evaluation/*`, Nạp dữ liệu `/ingestion/*`, Warehouses `/warehouses/*`, Giám sát `/monitoring/*`, Cài đặt `/settings/*`.

`/query/:id/...` luôn active Truy vấn. `/history/:id` active Lịch sử kể cả render result component dùng chung. `/catalog/metrics/:name` active Catalog. `/` exact match. Nút từ history “xem kết quả đầy đủ” có thể điều hướng `/query/:id/overview`, khi đó active Truy vấn theo URL.

Ảnh không có Warehouses/Monitoring/Settings đủ chi tiết: thiết kế cùng shell, tokens, form/table/card rhythm ngay từ lần đầu, dựa trên API feature của prompt; không giả rằng có ảnh chuẩn cho những màn này.

## Design baseline cần đo khi triển khai

Primary desktop viewport mục tiêu 1728×1280 CSS px để đối chiếu bộ ảnh 01–10; ảnh có kích thước khác phải chuẩn hóa content bounds trước khi so. Ước lượng ban đầu: sidebar khoảng 310–320px, topbar khoảng 88–96px, padding main 24–32px; phải đo và tinh chỉnh theo ảnh, không coi đây là số pixel đã kiểm chứng. Navy sidebar, electric blue active, nền gần trắng xanh nhạt, heading navy đậm, border xanh xám mỏng, radius card khoảng 12px, status pill, icon outline đồng nhất. Hero illustration phải phù hợp ảnh, không emoji thay thế. Chọn font có glyph Việt đầy đủ, kiểm tra weight/line-height thực tế.

Lần dựng đầu phải có đủ shell + typography + card/table states + assets mục tiêu. Ảnh mock quy định style UI, không quy định phải đổ dữ liệu giả lên màn hình. Runtime sản phẩm lấy dữ liệu API Java thật; chưa có dữ liệu thì empty state, lỗi thì error state đúng thiết kế. MSW/fixtures chỉ phục vụ test hoặc cô lập dependency tạm thời khi cần, không thay chức năng hoặc dữ liệu sản phẩm. Business metric và sample questions lấy API metadata; hình thức giống ảnh không cho phép hard-code commerce vào core.

Runtime content phải có data provenance: physical metadata/query rows lấy từ warehouse đang chọn; warehouse/dataset display fields lấy từ registry; semantic metrics/dimensions/examples lấy từ active semantic model. Static UI copy, labels, icons và layout tokens có thể cố định; identity/description/count/category/query/result của warehouse không được viết cứng trong component hoặc seed bootstrap rồi hiển thị như dữ liệu live. Dùng empty state nếu semantic metadata chưa có.

## Visual acceptance

- Chụp screenshot ở viewport cố định, cùng route/state, tắt animation và dùng fixture/time ổn định.
- So side-by-side và overlay với ảnh canonical; rà sidebar/topbar bounds, spacing, typography, border/radius, alignment, table density, icon/illustration và selected states. Báo khác biệt còn lại.
- Chốt visual thresholds/baselines trong FE task sau khi render đầu tiên; không tuyên bố pixel-perfect bằng một con số chưa đo. Không buộc pixel equality với chữ méo/artefact trong ảnh mock.
- Verify 1440px desktop, 1024px tablet, 390px mobile: sidebar collapse có thao tác mở, bảng scroll ngang, focus visible, không ép nội dung bảng thành chữ quá nhỏ. Skeleton/empty/error cũng phải cùng design language.
