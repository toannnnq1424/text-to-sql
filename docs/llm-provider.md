# Model API và Ollama local

## Bộ kit và model là hai thành phần

Wren AI có UI, AI Service (retrieval/prompting/generation) và semantic core; [tài liệu chính thức](https://docs.getwren.ai/oss/overview/introduction) phân biệt các phần này. Snapshot người dùng cung cấp ở `vendor/upstream/semantic-engine` là Engine/Core, không có toàn bộ AI Service đó. App gọi local Engine SDK đã fork: `plan_for_dataset` xử lý SQL vật lý trong manifest được cấp quyền, rồi kiểm tra lineage sau rewrite. LLM client hiện là `ai-service/app.py::OpenAICompatibleModelClient`; không được báo như pipeline Wren AI Service đã tích hợp.

Một model đã train sẵn có thể chạy ở máy local qua Ollama hoặc tại provider từ xa. Không cần tự training chỉ để bắt đầu inference. Theo [Ollama API compatibility](https://docs.ollama.com/api/openai-compatibility), local server hỗ trợ `/v1/chat/completions`; client dùng base URL `/v1`, API key placeholder được Ollama local bỏ qua. Khả năng SQL, JSON và tiếng Việt tùy model; cài Ollama không tự bảo đảm trả lời đúng.

## File cấu hình của app

Dùng `.local/compose-app/provider.env`, không commit file đã cấu hình. Mẫu [infra/provider.env.example](../infra/provider.env.example) dùng chung cho host launcher và Compose:

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_MODEL=your-model-name
LLM_API_KEY=your-private-key
LLM_TIMEOUT_MS=30000
```

Endpoint phải hỗ trợ Chat Completions với JSON object output theo contract app. UI không nhận key; Java nhận tên model và gọi Python qua private token. Python chọn context theo dataset/allowlist rồi sinh candidate; native semantic SDK lập kế hoạch; Java kiểm tra SQL/lineage trước native executor.

## Dùng Ollama local

Cài/chạy Ollama theo [hướng dẫn chính thức](https://docs.ollama.com/quickstart), tải model bạn chọn bằng `ollama pull <model-name>`. Dùng đúng tên model đã có trong `ollama list`. Dự án không tự tải model nhiều GB hoặc dùng model cloud mặc định.

Khi AI service chạy trực tiếp trên host:

```dotenv
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=your-installed-local-model
LLM_API_KEY=ollama
LLM_TIMEOUT_MS=30000
```

Khi AI service chạy trong Docker Desktop và Ollama ở máy Mac/Windows host, dùng `http://host.docker.internal:11434/v1` thay URL loopback. Ollama cần chấp nhận kết nối từ mạng container theo cấu hình host/firewall của bạn; `127.0.0.1` bên trong container trỏ vào chính container. Linux Docker cần hostname/gateway được cấu hình riêng. Không bind Ollama công khai chỉ để thử cấu hình.

Giá trị `ollama` là placeholder local, không phải secret provider thật. Không dùng nó thay key cho dịch vụ remote có xác thực. Timeout app cho phép100–120000ms; cold inference có thể vượt budget và sẽ trả lỗi timeout thật, không đổi sang câu trả lời giả. Nếu tăng timeout Python cần đồng bộ budget của Java/proxy; không coi tăng một biến là đủ nghiệm thu.

Sau khi sửa cấu hình, chạy lại `python3 infra/local/compose.py up` cho Docker, hoặc restart cả AI/backend bằng `infra/local/run.py` nếu chạy host. Chọn `AUTO`/`API` theo chế độ API hiện hành. Khi chưa có provider, chỉ `DETERMINISTIC` là semantic example matching, không phải model local.

## Kiểm chứng và trạng thái

Thử một câu hỏi ngoài semantic example, đọc trường `model` và query metadata để biết provider thực sự được gọi; kết quả phải qua planner/Java guard/DB thật. Test provider smoke cần đủ ba biến môi trường ở trên:

```bash
ai-service/.venv/bin/python -m pytest ai-service/test_app.py -k real_provider
```

Bài test phải chạy với biến được nạp an toàn vào tiến trình (launcher không tự nạp chúng cho một shell pytest riêng). Không in key hoặc raw prompt vào log. Hiện real provider và Ollama inference đều **NOT RUN**, vì người dùng đã hoãn cung cấp model/key; không mô tả deterministic corpus PASS như AI thật PASS. Đổi model không đòi hỏi huấn luyện lại schema nhưng metadata/semantic definitions đúng vẫn bắt buộc.
