# FE — React / TypeScript / UI UX

Bắt buộc đọc và áp dụng [implementation-rules.md](../implementation-rules.md): module được giao phải có implementation thật, validation, error handling, security liên quan và test cần thiết ngay trong cùng phạm vi; không chia version, không placeholder hoặc hoãn tích hợp sang lần sau.

Đọc root AGENTS, scope, toàn bộ contracts, UI reference; prompt nguồn: `docs/prompts/01-frontend.txt`. Prompt yêu cầu import UI được supersede bởi scope; không tạo screen SQL upload trong app chính.

## Ownership và stack

Sửa `frontend/`; React, TypeScript strict, Vite, React Router, fetch/Axios qua API modules, Recharts hoặc tương đương, Vitest + React Testing Library. MSW chỉ dùng dev/test; fixtures từ contract chung. Không chọn thư viện gây execute chart code từ LLM. Dependency version pin/lock tại task triển khai, không tự coi tài liệu là package manifest.

API modules: warehouseApi,datasetApi,queryApi,catalogApi,historyApi,evaluationApi,ingestionApi,monitoringApi và settingsApi/platformApi theo endpoint có thật trong contract. Component không tự gọi fetch rải rác. React không gọi Python/LLM/DB, không tự sinh SQL hay đảm nhiệm security validation.

## Thứ tự làm ngay sau C0

1. Mở ảnh 01/02/04/08/10, dựng design tokens, shell/sidebar/topbar và một màn query đạt visual target ngay. Tuân theo style ảnh mock; không dùng dữ liệu giả để làm như sản phẩm đã hoạt động. Không có dữ liệu/API lỗi phải hiển thị empty/error state đúng thiết kế.
2. Implement API client thật theo contract; mock/fixtures chỉ dùng test hoặc cô lập dependency tạm thời khi cần, không làm nguồn dữ liệu sản phẩm. Triển khai route, global Warehouse/Dataset context, dataset switch reset sample/catalog/query context và hủy hoặc bỏ stale response theo request ID/context key.
3. Triển khai đủ màn home, query và result tabs, history, catalog, warehouses, ingestion, evaluation, monitoring, settings. Không thêm screen theo từng engine.
4. Tích hợp Java thật trong cùng lần triển khai, giữ cùng DTO/client; không rewrite business logic theo response tự bịa. Màn hình chỉ có UI hoặc mock chưa được báo hoàn thành.

Result tabs Overview/Data/Visualization/SQL/Explanation/Technical nằm dưới `/query/*`; history detail vẫn giữ history active khi route `/history/*`. Data table pagination/sorting/horizontal scroll/sticky header; xử lý null, boolean, Unicode, date/timestamp, decimal string, bigint string, long text và 1000+ rows bằng bounded page/virtualization phù hợp. Copy cell/row, CSV, truncated warning; export không tuyên bố lấy toàn warehouse. Chart fallback table khi spec sai.

Mọi màn xử lý loading, empty, success, error, partial, timeout, dataset disabled, warehouse unavailable, schema mismatch, large data theo ngữ cảnh; mutation có pending/disabled chống click lặp. Clear không làm đổi dataset. Dataset dropdown không giữ lựa chọn ngoài warehouse hiện tại. Render text an toàn, không dangerouslySetInnerHTML từ LLM/metadata.

## Hoàn thành task

Chạy tests theo acceptance, npm build, route/state tests, visual comparison đúng viewport với ảnh và ghi kết quả. Không claim pixel-perfect khi mới nhìn bằng mắt. Desktop primary, tablet/mobile usable sidebar collapse và table scroll; keyboard/focus/labels/contrast phải dùng được. Core không hard-code commerce metric hoặc câu hỏi mẫu. Final report nêu màn/route đã xong và phần chưa được nghiệm thu với backend thật.
