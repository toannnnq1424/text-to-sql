# Ngữ nghĩa nghiệp vụ, tri thức AI và pipelines

Ba màn `/semantic`, `/knowledge` và `/pipelines` dùng chung warehouse/dataset đang được cấp quyền. Nội dung lấy từ API Java, cấu hình active và database; không lấy tên bảng, công thức hay số liệu từ ảnh mẫu. Contract chi tiết ở [semantic-workbench](contracts/semantic-workbench.md). Kết quả kiểm chứng phải xem [work log](work-log.md), không suy ra từ việc có mã nguồn.

## Định nghĩa và sử dụng ngữ nghĩa

Trong **Ngữ nghĩa**, chọn dataset, đọc metadata vật lý, cấu hình metrics, dimensions, synonyms, quan hệ và quy tắc nghiệp vụ. Metric dùng biểu thức tổng hợp trên cột có thật, với danh sách bảng và dimensions tương thích. Dimension trỏ tới một cột vật lý. Chức năng kiểm tra không kích hoạt cấu hình; lưu mới thay active definition. `schemaVersion` thuộc dataset, `semanticVersion` phải đổi khi thay nội dung để lịch sử truy vấn giữ đúng snapshot.

Compiler từ source fork parse biểu thức bằng AST, resolve tên cột và dựng join đã khai báo. Phía quan hệ được khai báo duy nhất phải có khóa vật lý hoặc được kiểm chứng bằng dữ liệu trong thời hạn an toàn. Join làm nhân mức hạt, tên không rõ nghĩa, cột ngoài allowlist, nested query và hàm không an toàn bị từ chối. Metrics ở các bảng fact khác nhau không được tổng hợp chung nếu không có kế hoạch giữ mức hạt tương ứng; giao diện phải báo lỗi thay vì trả số sai.

Bộ chọn metrics/dimensions/bộ lọc gọi structured semantic query, không gọi LLM. Candidate vẫn qua native planner, kiểm tra AST/lineage Java và credential chỉ đọc. Kết quả được lưu cùng history, SQL, phiên bản ngữ nghĩa, bảng nguồn và export như truy vấn tự nhiên.

Trong **Data Catalog → Metrics**, thao tác **Khám phá** mở bộ chọn với metric đang xem; **Sửa** và **Tạo metric** mở đúng mục trong editor. Mô tả, đơn vị và synonyms là cấu hình nghiệp vụ có thể chỉnh sửa, không phải dữ liệu được suy ra chắc chắn từ tên cột. Những nội dung này chỉ áp dụng khi định nghĩa được validate và activate thành version mới.

Admin có thể dùng **Đề xuất bằng AI**: mô tả yêu cầu nghiệp vụ, model đã cấu hình đọc metadata được cấp quyền rồi đề xuất metrics/dimensions/rules có mô tả. Python kiểm tra proposal bằng compiler từ source fork; Java kiểm lại bản nháp hợp nhất với định nghĩa hiện hành. Hệ thống giữ các định nghĩa không được đề xuất thay thế và không activate tự động. Xem bản nháp/cảnh báo, sửa nội dung và semanticVersion, validate rồi lưu. Provider lỗi hoặc đề xuất không hợp lệ được báo lỗi, không trả bản nháp giả. Mô tả AI vẫn cần data owner duyệt ý nghĩa, grain và units.

Trang chủ/Truy vấn có gợi ý theo dataset đang chọn, với nguồn **Schema**, **Ngữ nghĩa** hoặc **Ví dụ đã duyệt**. Schema tạo câu hỏi từ bảng/cột thật ngay cả khi chưa cấu hình metric; Ngữ nghĩa dùng định nghĩa active; Ví dụ là cấu hình được duyệt. Chọn một gợi ý mới thực sự gọi query/model, không đọc kết quả trả lời có sẵn. Đổi warehouse/dataset sẽ lấy tập gợi ý mới và xóa bản nháp cũ.

## Tri thức AI

Trong **Tri thức AI**, tạo chỉ mục từ schema thật, định nghĩa nghiệp vụ và cặp câu hỏi/SQL đã cấu hình. LanceDB và schema indexer được gọi trực tiếp từ bộ source đã nhập. Embeddings chạy bằng `embeddinggemma:300m` qua Ollama local. Chỉ mục được phân vùng theo warehouse, dataset, dialect, metadata và embedding model; không chứa credentials hoặc các hàng kết quả query.

Chỉ mục cũ được đánh dấu STALE khi metadata/định nghĩa đổi. Khi gọi model, retrieval chỉ đọc chỉ mục READY để chọn schema, ngữ nghĩa và ví dụ liên quan trong giới hạn context; query không tự xây index đồng bộ. Với trạng thái EMPTY/STALE hoặc lỗi retrieval, model vẫn nhận physical/semantic context đã được Java cấp quyền và truy vấn tiếp tục dùng đúng model đã chọn; không chuyển sang deterministic. Log chỉ ghi correlation ID, không ghi câu hỏi hay schema. Admin có thể phê duyệt một truy vấn thực đã SUCCESS của đúng dataset làm ví dụ, xóa ví dụ hoặc xóa chỉ mục. Rebuild tạo thế hệ mới rồi thay atomically; rebuild thất bại giữ thế hệ trước. Ví dụ phê duyệt trong thế hệ cũ không được tự đưa qua schema mới: cần phê duyệt lại để giữ kiểm tra quyền và tính hợp lệ.

`DETERMINISTIC` vẫn là chế độ offline, không gọi model/embeddings. Việc có kết quả deterministic không chứng minh model AI đã được gọi. Structured semantic query cũng không dùng model. Các phép kiểm thử local phải dùng mode `API` và kiểm tra model trả về, SQL thực thi và kết quả database.

## Pipeline chuyển đổi

Trong **Pipelines**, chọn bảng nguồn có thật trong dataset và namespace đích mà import writer được phép tạo bảng. Preview cho biết bốn bảng sẽ tạo, schema và sample của từng lớp. Tên bảng đã tồn tại bị từ chối; không ghi đè dữ liệu của người dùng.

RAW giữ dữ liệu nguồn; STAGING, WAREHOUSE và MART có phép chiếu/đổi tên/cast, filter và group-by độc lập. Biểu thức được source fork parse, còn Java kiểm tra và chạy trên database đích. Python chỉ nhận tên/kiểu cột, không nhận các hàng dữ liệu hoặc credential warehouse. Preview giới hạn sample và nêu rõ điều đó; số liệu preview tổng hợp không được trình bày như kết quả toàn nguồn. Khi run, nguồn được đọc đầy đủ trong quota; vượt quota phải lỗi thay vì âm thầm cắt dữ liệu.

Run lưu definition snapshot, idempotency key theo người chạy, tiến độ và số hàng thực từng lớp. PostgreSQL/SQL Server dùng transaction khi có thể; MySQL DDL có thể commit trước và phải báo partial failure cùng các bảng đã tạo. Dataset mới đăng ký từ MART có provenance vật lý và ngữ nghĩa rỗng; app không tự đoán ý nghĩa nghiệp vụ từ tên file/cột.

## SDK đang được dùng như thế nào

SDK là thư viện cài từ source local vào Python service của dự án này. App gọi các class/hàm cụ thể, thay vì chạy nguyên giao diện và mọi server của dự án gốc:

- React gọi Java để quản lý quyền, cấu hình, truy vấn và pipeline.
- Java gọi Python private API để biên dịch business selection, chọn context/tri thức hoặc lập kế hoạch SQL; Python import trực tiếp source fork của semantic SDK.
- Fork dùng SQLGlot AST, native core để planning/rewrite và LanceDB MemoryStore cho retrieval. Các phần thêm/sửa có hash và provenance trong patch manifest.
- Java kiểm tra candidate rồi gọi private data executor. Executor Go dùng trực tiếp native source factories PostgreSQL/MySQL/SQL Server từ source kit thứ hai, giữ cơ chế cấp quyền, giới hạn, typed result và cancellation của app.

Có toàn bộ source trong `vendor/upstream` không có nghĩa mọi module đang chạy. Các connector cloud thiếu tài khoản/cấu hình và các server/CLI chưa có caller không được tính là runtime support. Native Rust core hiện là wheel đã pin; không tuyên bố đã build Rust từ toàn bộ source local. Bộ source semantic này cũng không chứa toàn bộ sản phẩm AI Service riêng của tác giả gốc.
