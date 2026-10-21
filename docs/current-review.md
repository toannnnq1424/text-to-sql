# Phản hồi UI và dữ liệu ngày 2026-10-21

Phản hồi mới nhất supersede những nhận định lạc quan ở các lần bàn giao trước. Có code, test unit hoặc API trả200 không đủ chứng minh giao diện dễ dùng hay model trả lời đúng. Bằng chứng cuối của đợt `module/analytics-experience` nằm trong [work log](work-log.md); mức hoàn thiện chung nằm ở [project status](project-status.md).

## Những vấn đề được xác định

| Vấn đề người dùng thấy | Nguyên nhân thực tế | Cách xử lý và nghiệm thu |
|---|---|---|
| Câu hỏi trông cố định theo Chinook | Ví dụ lấy từ semantic configuration của dataset mẫu; chưa có gợi ý tự hình thành cho dataset ngữ nghĩa rỗng | Endpoint gợi ý tạo từ schema thật, metric active và ví dụ curated, có origin rõ. Nạp file thành warehouse/dataset khác rồi so bảng nguồn của mọi gợi ý; không có nội dung Chinook lọt sang. Đây là câu hỏi đề xuất, chưa phải kết quả trả lời. |
| `record_count` một giá trị vẫn thành bảng lớn và các chart đều vô dụng | Chart controls phụ thuộc recommendation cũ, không dựa đầy đủ vào shape/types của kết quả | Scalar thành KPI gọn, bảng ít cột giữ chiều rộng nội dung; chart inspector chọn trục/series từ cột thật, chỉ cho kiểu tương thích. Kiểm bar/pie, line/area, grouped cùng đơn vị và responsive bằng caller thật. Không vẽ dữ liệu giả để có chart. |
| Nhiều khối lớn, lồng nhau, thừa khoảng trắng hoặc chạm nhau | Layout kết quả dùng cùng một khung cho mọi dạng dữ liệu | Bố cục chart chính + inspector, overview + summary và spacing riêng; ảnh gốc03/06/09/14 là chuẩn phong cách. Screenshot actual OIDC/Java/DB3 và kiểm overflow; chưa tự suy ra pixel-perfect mọi màn. |
| SQL đếm bị bọc nhiều lớp CTE/projection | Native planner xuất physical rewrite bảo toàn cả identity model | Fork AST compaction chạy sau native plan, bỏ wrapper thừa theo điều kiện bảo toàn; giữ CTE người dùng, column lists, aggregate/null/decimal/alias/limit. So kết quả/kiểu/nhãn bằng corpus và caller database thật. `candidateSql` riêng, `generatedSql` là SQL logic cuối Java đã normalize/validate; adapter có thể thêm bounded transport envelope. |
| “Expected SQL” trông như đáp án fix cứng | UI chưa nói rõ corpus regression khác câu hỏi runtime | Liệt kê suite theo dataset, gắn origin/description. Oracle packaged là dữ liệu kiểm thử có chủ sở hữu; suite schema hiện tại tạo COUNT từ bảng thật và thực thi oracle độc lập, gọi model API để so sánh. Không coi tỷ lệ pass COUNT như độ chính xác AI tổng quát. |
| Metric/mô tả chỉ đọc, không rõ nguồn | Mô tả là semantic configuration nhưng catalog chưa dẫn tới thao tác đầy đủ | Catalog tạo/sửa/khám phá metric qua editor/query thật. Admin sửa mô tả, expression, units, synonyms/dimensions; validate rồi activate version mới. Model local/API có thể đề xuất bản nháp theo metadata, kiểm qua fork compiler và Java, cần review trước khi lưu. Không coi mô tả AI là sự thật nghiệp vụ tự xác minh. |

## Quy tắc dữ liệu và quyền

Physical schema/counts/query rows lấy từ warehouse đã chọn; metadata nghiệp vụ lấy từ active semantic API và có chủ sở hữu. Không lấy tên warehouse, mô tả metric, câu hỏi hoặc kết quả từ ảnh mẫu. Câu hỏi schema/metric dùng mẫu ngôn ngữ chung nhưng chỉ tham chiếu bảng/cột/định nghĩa hiện hành; không mã hóa riêng Chinook trong core. Khi đổi context, xóa form/kết quả/gợi ý cũ; lỗi và ngữ nghĩa rỗng phải hiển thị đúng state.

Thao tác trong app gồm registry, import có preview/validate, file ingestion, semantic editor, knowledge và pipelines. Quyền ghi này là thao tác ứng dụng đã kiểm soát; SQL do LLM sinh vẫn chỉ đọc. React gọi Java; Java nắm OIDC/roles/resource grants, validation và quyết định thực thi. Model không nhận credential hoặc hàng kết quả warehouse.

Login/OIDC local đã có browser/API evidence từ các đợt trước; deployment HTTPS/IdP đích và vận hành production không tự được nghiệm thu từ local. Online model giữ nguyên cấu hình, không gọi trong đợt này. Ollama local là inference thật; deterministic examples và structured metric compiler không phải LLM inference hoặc training.

## Source kit và phần chưa được tuyên bố

SDK semantic cài từ source fork trong repo, có các specialization planning/compaction/business/transform; LanceDB MemoryStore/schema indexer có caller knowledge và retrieval thật. Go executor dùng native source factories/pools của source kit thứ hai cho PostgreSQL/MySQL/SQL Server. [Bản đồ caller](integrations/full-source-adoption.md) phân biệt source đã nhập với capability đang chạy.

Không chạy nguyên mọi server/CLI/tool của hai repo và không coi toàn bộ417k dòng như tính năng đã tích hợp. Cloud connectors, native cube/calculated aggregate chưa đáp ứng probe, Rust build từ source, production load/recovery và chất lượng model trên corpus mở vẫn có giới hạn được ghi ở project status. Các điểm còn thiếu của target hiện tại vẫn là INCOMPLETE, không chuyển thành “future work” để gọi hoàn thành.
