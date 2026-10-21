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

## Ngữ nghĩa, Tri thức AI và Pipelines

Ba route `/semantic`, `/knowledge`, `/pipelines` dùng cùng shell cố định và design tokens. Sidebar đặt chúng sau Data Catalog; phần điều hướng cuộn riêng khi chiều cao không đủ, giữ thẻ Workspace/Dataset ở cuối.

- `/semantic` lấy cách trình bày bảng/metric của ảnh04/14: card cấu hình có phiên bản, các tab chỉ số/chiều/quan hệ/quy tắc/ví dụ, field có nhãn và SQL nhiều dòng. Chỉ ADMIN được chỉnh sửa. Kiểm tra cấu hình trước khi kích hoạt; sửa draft làm mất kết quả validation. Khối phân tích chỉ dùng định nghĩa đã lưu, đưa kết quả vào các result tabs hiện có.
- `/knowledge` có trạng thái chỉ mục/counts/model từ API, thao tác lập lại chỉ mục, tìm ngữ cảnh và ví dụ có provenance. EMPTY/STALE/ERROR hiển thị riêng; không chèn ví dụ hay kết quả tìm kiếm giả. Chỉ ADMIN được duyệt/xóa ví dụ và xóa chỉ mục.
- `/pipelines` theo nhịp card và bốn lớp của ảnh10. Trình tạo hướng dẫn chọn nguồn/đích → mapping từng lớp → preview/lưu. Biểu thức mặc định lấy tên cột nguồn thật và quote theo dialect đích; tên output được chuẩn hóa thành identifier duy nhất, người dùng chỉnh được. Preview cho thấy schema/dòng/SQL thực mỗi lớp và cảnh báo giới hạn mẫu. Lần chạy lấy trạng thái, số dòng, bảng đã tạo, partial failure và dataset từ server. ADMIN quản lý cấu hình, ADMIN/OPERATOR chạy, người có quyền đọc xem lịch sử.

Các ảnh trên là nguồn style; ba màn mới không có ảnh mock riêng để claim pixel-perfect. Visual review phải dùng screenshot đúng viewport và kiểm tra thêm mobile/keyboard, không lấy test mock API làm evidence backend hoạt động.

## Kết quả analytics và ngữ nghĩa theo dataset — kiểm chứng 2026-10-21

Theo review ảnh người dùng ngày 21/10, mật độ của result UI phải dựa vào hình dạng dữ liệu thật:

- Một dòng, một cột số dùng KPI gọn; tab Dữ liệu vẫn có bảng nhỏ để xem/sao chép chính xác. Không kéo một bảng một ô thành vùng trắng toàn màn hình, không hiển thị bảy nút loại biểu đồ vô hiệu.
- Tab Biểu đồ có canvas giới hạn chiều cao và inspector chọn trục/chuỗi bên phải như ảnh06. Chỉ ghép nhiều chuỗi khi mọi đơn vị đã biết và trùng nhau. Biểu đồ đường/diện tích sắp xếp bản sao các giá trị DATE/TIMESTAMP chuẩn theo thời gian; bảng/CSV giữ thứ tự và chuỗi giá trị gốc.
- Một đề xuất bảng rõ ràng cho danh sách dòng vẫn giữ bảng; người dùng có thể chọn trục và số đo để vẽ. Không tự biến khóa số trong dữ liệu thô thành số đo nghiệp vụ. Scalar vẫn ưu tiên KPI; đề xuất không hợp lệ có lý do hiển thị.
- Tổng quan theo bố cục ảnh03: biểu đồ và tóm tắt hai cột, preview dữ liệu tách card; các card có khoảng cách ổn định. SQL được xuống dòng, có số dòng và màu cú pháp; sao chép giữ chuỗi gốc. Phân biệt SQL logic cuối Java chuyển executor với proposal trước planning; adapter có thể thêm envelope SELECT/LIMIT hoặc cursor bounds.
- Gợi ý trên Trang chủ/Truy vấn lấy `question-suggestions` của dataset hiện tại. Nhãn nguồn phân biệt schema thực, cấu hình ngữ nghĩa và ví dụ đã duyệt. Đổi warehouse/dataset xóa câu hỏi nháp cũ; không giữ ví dụ Chinook trên nguồn khác.
- Catalog metrics có tạo/chỉnh sửa theo ADMIN và mở phân tích với chỉ số đã chọn. Trợ lý AI trả bản nháp có model/cảnh báo; áp dụng vào editor chưa kích hoạt. Thay semanticVersion, validate và lưu vẫn là bước riêng có kiểm tra quyền.
- Bộ đánh giá lấy danh sách tương thích dataset hiện tại; giải thích nguồn oracle. Các câu đếm từ schema là kiểm chứng tích hợp cơ bản, không đại diện độ chính xác AI tổng quát.

Đã chạy [analytics-browser.mjs](../infra/local/analytics-browser.mjs) qua OIDC thật, React → Java → Ollama `qwen3:4b` và ba warehouse PostgreSQL/MySQL/SQL Server với dữ liệu thời tiết QA được nạp bằng module chung; không chặn/thay response API. Kiểm tra KPI, cột, cột nhóm hai chuỗi cùng đơn vị, tròn, đường, diện tích, chuyển dataset, Catalog→compiler→query và bộ đánh giá theo dataset đều PASS. Thao tác gửi câu hỏi AUTO và đề xuất ngữ nghĩa từ UI đều gọi model thật, PASS; bản nháp không được kích hoạt trong bài kiểm này. Lỗi optional `category:null` phát hiện khi thử response thật đã được sửa ở dịch vụ; consumer test giữ schema chặt và chấp nhận trường optional được bỏ đúng contract.

Bằng chứng local, không commit dữ liệu hoặc phiên đăng nhập: `.local/compose-app/analytics-browser/report.json` và các ảnh `POSTGRESQL-{bar,grouped,line,scalar,scalar-table,overview,sql-proposal}-1728.png`, ảnh tương ứng MYSQL/SQL_SERVER, `semantic-assist-review-1728.png`. Đã mở ảnh để rà bố cục; không chỉ suy luận từ unit test. Ba độ rộng 1440/1024/390 × bốn hình dạng kết quả đều không tràn ngang document; menu mobile mở/đóng và trả focus đúng. Bảng/tab vẫn cuộn trong vùng riêng. Browser báo 0 lỗi không được xử lý.

Khác biệt thị giác còn lại với mock: minh họa hero là asset vẽ lại; font/icon và typography không bằng pixel với chữ raster trong ảnh; inspector dùng checkbox/đơn vị và nguồn thực thay các trường minh họa. Tên kỹ thuật dài trong selector được rút gọn ở khung hẹp, vẫn có nhãn/title đầy đủ. Đây là kiểm tra bố cục/chức năng và ảnh thực, không phải tuyên bố pixel-perfect. Các warehouse/table QA là tài nguyên kiểm thử tạm thời, có thể được dọn sau nghiệm thu; Chinook không phụ thuộc chúng.

## Cài đặt model và chế độ truy vấn

Mục **Model và API key** trong `/settings` dùng cùng card/form tokens của shell. Danh sách chỉ nhận metadata an toàn từ Java: tên cấu hình, loại ONLINE/Ollama, model chính xác, địa chỉ, trạng thái, nguồn và revision. Không hiển thị lại key hoặc phần đuôi key. Cấu hình từ deployment có nhãn chỉ đọc; profile tạo trong app quản trị riêng, không sửa file môi trường.

ADMIN có form thêm/chỉnh sửa, lựa chọn mặc định và xóa profile. Ô key là password, không đi vào query cache, mutation variables, localStorage hoặc sessionStorage; reset khi lưu thành công/thất bại và khi đóng form. Để trống khi sửa nghĩa là giữ key; xóa phải chọn tường minh. Đổi địa chỉ hoặc loại provider cần key mới hoặc clear rõ ràng. Revision conflict giữ lỗi từ server và có thao tác đóng/tải lại cấu hình. Non-admin chỉ xem metadata. Lưu profile không tự gọi model hay kiểm thử key; UI giải thích chi phí nhà cung cấp và yêu cầu Ollama phải đang chạy/model đã tải.

Màn Truy vấn phân biệt ba cơ chế:

- **Tự động** hiển thị đúng loại và model mặc định hiện tại, không ngầm fallback Offline.
- **Chọn model/API** có selector tên profile + loại ONLINE/Ollama + model. Không cho gửi khi chưa chọn cấu hình khả dụng. Dataset/ngữ cảnh không phải lựa chọn model.
- **Offline · khớp ví dụ (không AI)** giải thích chỉ khớp ví dụ semantic của dataset/dialect, không gọi AI/API/Ollama hay tự suy luận câu hỏi mới.

Phân tích theo metrics/dimensions có nhãn **Công thức ngữ nghĩa · không gọi AI**. Kết quả/lịch sử hiển thị provenance snapshot của chính truy vấn; snapshot cũ không được gán model mặc định mới. Nếu model trả về khác model được cấu hình yêu cầu, hiển thị riêng cả hai. Chạy lại truy vấn API giữ provider identity đã ghi nhận; profile bị xóa được server từ chối có kiểm soát.

Nghiệm thu thật đợt `module/model-provider-settings` qua [model-provider-browser.mjs](../infra/local/model-provider-browser.mjs): OIDC ADMIN → Settings → Java lưu profile online bị tắt với key test riêng, giữ/thay/xóa key bằng form, tạo profile Ollama và chọn mặc định đều PASS. Lưu và chỉnh profile không gửi truy vấn model. Sau đó UI chọn profile local → `qwen3:4b` → PostgreSQL trả SUCCESS; màn kỹ thuật giữ đúng tên/source/revision/model snapshot. VIEWER thấy metadata an toàn, không có thao tác thêm/sửa key; lời giải thích Offline không AI được kiểm riêng. Không gọi inference online hoặc sửa file provider online.

Report local `.local/compose-app/model-provider-browser/report.json` ghi PASS, browser errors0, cleanup PASS. Đã mở/rà ảnh `settings-admin-1728.png`, `query-selected-local-390.png`, `result-provider-snapshot-1728.png`; bộ ảnh còn có Settings1728/1024/390, Query1728/1024/390, Offline và VIEWER. Tám state/viewport được đo document width không vượt viewport; selector tên dài rút gọn trong khung nhưng đoạn mô tả bên dưới vẫn ghi đầy đủ loại/model. Giữ navy fixed sidebar/blue active/card rhythm theo ảnh canonical02/03; Settings không có mock chi tiết nên không claim pixel-perfect. Profile kiểm thử được xóa theo đúng ID và mặc định gốc được phục hồi; query/audit snapshot bình thường được giữ lại.

Runner ban đầu gặp locator quá chính xác cho wrapping-label select và một lỗi đọc response sau thời điểm UI cập nhật; đã sửa test đọc body ngay và match label-prefix. Không nới validation hoặc đổi dữ liệu runtime để cho bài kiểm PASS.
