# Chọn model và cấu hình API key

## Ba chế độ trên màn Truy vấn

| Chế độ | Có gọi AI không? | Model được dùng |
|---|---|---|
| Tự động / AUTO | Có | Profile mặc định hiện tại, ghi rõ tên và API online hay Ollama local ngay trên form |
| Chọn model/API | Có | Profile người dùng chọn trong danh sách đã cấu hình; có thể là API online hoặc Ollama local |
| Offline · khớp ví dụ / DETERMINISTIC | Không | Không có model. Khớp câu hỏi với semantic examples đã khai báo của đúng dataset/dialect; câu không khớp sẽ bị từ chối |
| Phân tích theo metric trong Ngữ nghĩa | Không | Compiler tạo SQL từ công thức/dimensions đã lưu; vẫn qua native planner/Java guard trước thực thi |

“API” là cách gọi model, không tự đồng nghĩa dịch vụ online. Ollama cũng cung cấp API nhưng chạy model trên máy/local server. Deterministic không gọi Ollama, không tải model, không training và không hiểu mọi câu hỏi tự do. Ngữ cảnh tùy chỉnh/xem ngữ cảnh không phải một model riêng.

Kết quả ghi mode, profile/requested model và tên model provider thực sự trả về nếu có. Snapshot lịch sử giữ model lúc chạy; đổi default sau này không đổi danh tính của truy vấn cũ. Snapshot cũ không có provider thì hiển thị chưa ghi nhận, không tự gán model hiện tại.

## Admin cấu hình trong application

Đăng nhập ADMIN, mở **Cài đặt → Model và API key**:

1. Tạo profile, đặt tên dễ hiểu và chọn **API online** hoặc **Ollama local**.
2. Nhập base URL Chat Completions tương thích và model ID chính xác. API online cần key; Ollama local không đòi key. App không tự tải model Ollama khi lưu.
3. Lưu. Key đã lưu không được trả về UI; trạng thái chỉ cho biết đã có key. Khi sửa, để trống key để giữ nguyên; nhập key mới để thay; dùng thao tác xóa key tường minh nếu cần. Đổi endpoint/kind phải thay hoặc xóa key, không mang key cũ sang đích mới.
4. Chọn profile mặc định để AUTO và trợ lý ngữ nghĩa dùng nó. Trong Truy vấn chọn **Chọn model/API** nếu muốn chỉ định một profile khác cho lần chạy.

Lưu chỉ kiểm tra cấu trúc/quyền/cấu hình, không tự gọi model hoặc xác nhận key còn hạn. Một profile đã lưu có thể báo lỗi thật khi model không tồn tại, key sai, hết quota hoặc endpoint không tương thích. Không có fallback sang deterministic/model khác khi lỗi.

Chỉ ADMIN tạo/sửa/xóa/default. Người dùng khác xem metadata an toàn và dùng profile có sẵn theo quyền truy vấn. Xóa hoặc tắt profile mặc định cần đổi default trước. Revision conflict báo cấu hình đã được người khác sửa, cần tải lại thay vì ghi đè ngầm.

Key mới chỉ ở password input và request HTTPS/loopback tới Java; không được lưu browser storage hay query cache, không đọc lại key cũ. Java lưu ciphertext AES-GCM trong metadata DB, master key nằm ngoài DB. Python chỉ nhận key trong private config để tạo Authorization header, không đưa vào prompt, memory hoặc warehouse credentials.

## URL và model tương thích

Hiện dùng giao thức Chat Completions: profile API online dùng JSON object, profile Ollama dùng JSON Schema grammar; cả hai đều phải qua Candidate validation. Environment vẫn theo LLM_STRUCTURED_OUTPUT đã cấu hình. Đây không phải generic client cho mọi vendor protocol; endpoint có giao thức khác cần adaptation và acceptance riêng. Model ID do admin nhập, không lấy tên minh họa từ mock images.

Deployment local cho phép exact hosts của các API tương thích phổ biến và localhost/gateway Ollama; danh sách nằm trong `infra/local/model_admin.py`, có thể cấu hình bằng `NLA_MODEL_PROVIDER_HOSTS`. Không có wildcard/redirect hoặc tắt TLS để né validation. API online dùng HTTPS; endpoint private HTTP phải được deployment cho phép tường minh. URL không chứa user/password/query/fragment. Host không được cấp phép sẽ có lỗi rõ; admin máy chủ thêm exact host vào allowlist nếu cần.

Ollama trong Docker Desktop thường dùng `http://host.docker.internal:11434/v1`; Python chạy trên host dùng `http://127.0.0.1:11434/v1`. Dùng đúng model đã tải từ `ollama list`. Key online không tự chuyển sang Ollama; embeddings Tri thức AI vẫn có cấu hình riêng, không thay theo profile sinh SQL.

Profile local được tạo bằng launcher đặt `LLM_REASONING_EFFORT=none` cho Qwen3 để tránh sinh phần suy luận dài không cần cho JSON candidate. Có thể đổi mức effort tường minh; giới hạn thời gian và kiểm tra candidate vẫn giữ nguyên. Tắt reasoning có thể giảm độ trễ nhưng không làm model nhỏ trả lời đúng mọi câu hỏi.

## Environment fallback và sao lưu

Profile **Environment** phản ánh cấu hình Python đang chạy, chỉ đọc trong UI. Vẫn có thể dùng `.local/compose-app/provider.env` (online) và profile Ollama riêng theo [Ollama local](ollama-local.md). Tạo/sửa profile application không sửa các file này. Profile application mặc định ưu tiên; xóa lựa chọn override dùng environment nếu đã cấu hình.

Launcher tự tạo `.local/model-admin.env` mode0600 với `NLA_MODEL_MASTER_KEY` mã hóa32 random bytes base64, chỉ chuyển cho Java. Clone mới sinh key riêng, không cần secrets của maintainer. **Khi khôi phục metadata DB hoặc chuyển máy, phải khôi phục đúng master key**, giữ bản sao an toàn tách database backup. Không xóa/tạo lại key để chữa lỗi decrypt; app không có plaintext fallback. Deployment ngoài launcher có thể cung cấp cùng biến qua secret manager. `.local/` luôn ignored, không commit API key/master key hoặc đặt vào `VITE_*`.

## Bộ kit, inference và kiểm chứng

SDK semantic là engine/compiler/planner từ source fork, không phải model AI và không chứa toàn bộ AI Service của sản phẩm upstream. App có model client riêng; native semantic planning và Java validation vẫn chạy sau candidate. Không cần tự training để dùng model đã train sẵn qua Ollama/API. [Bản đồ source/caller](integrations/full-source-adoption.md).

Ollama local đã có inference/embeddings và caller Java/browser/database thật. Online cấu hình gốc vẫn được giữ nguyên, **không kiểm thử online** theo yêu cầu người dùng. Mock transport chỉ chứng minh HTTP/auth/output/error isolation; không chứng minh key online hợp lệ. Bằng chứng từng đợt ở [work log](work-log.md); không suy accuracy câu hỏi mới từ deterministic regression.

## Giới hạn gọi đồng thời

Generation và trợ lý ngữ nghĩa dùng chung giới hạn inference mỗi Python process: `LLM_MAX_CONCURRENT_REQUESTS=2` mặc định, chấp nhận1..32; tối đa cùng số lượng request chờ. `LLM_ADMISSION_TIMEOUT_MS=250`, cho phép0..5000. Slot giữ qua cả một correction được phép; thời gian chờ nằm trong tổng ngân sách30s, cancellation/lỗi giải phóng slot. Khi đầy, private API trả503 PROVIDER_UNAVAILABLE có kiểm soát, không tự đổi model hoặc retry. Offline, planning và metric compiler không chiếm inference slot. Đây là giới hạn mỗi process, không phải quota phân tán của tài khoản/provider. Các biến được launcher forward riêng cho Python; thay deployment env cần khởi động lại, không thay file key online khi kiểm thử local.
