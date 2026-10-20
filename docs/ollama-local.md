# Model local bằng Ollama

Profile local dùng `qwen3:4b` sinh candidate SQL và `embeddinggemma:300m` tạo embeddings đa ngôn ngữ. Đây là inference bằng model đã tải, không phải train model trên database. Python chỉ gửi metadata được Java cấp phép; kết quả candidate vẫn do Java kiểm tra và thực thi.

## Cài và kích hoạt

Trên macOS có Homebrew:

```sh
python3 infra/local/ollama.py setup
python3 infra/local/compose.py configure
python3 infra/local/compose.py up
```

`setup` cài Ollama nếu cần, khởi động service và tải hai model, sau đó ghi profile local vào `.local/compose-app/ollama.env`. Tổng model download khoảng 3,1 GB với hai model nêu trên; cần thêm RAM và dung lượng cho runtime. Nếu đã cài Ollama bằng ứng dụng, bật daemon rồi chạy `ollama pull qwen3:4b` và `ollama pull embeddinggemma:300m`; `python3 infra/local/ollama.py activate` chỉ ghi profile, không cài hoặc gọi model.

Daemon mặc định ở `http://127.0.0.1:11434`. Compose chuyển địa chỉ này thành `host.docker.internal` để container gọi được host. Không cần mở daemon ra Internet hoặc bỏ token giữa Java và Python. Host launcher dùng loopback; browser vẫn chỉ gọi Java.

## Cấu hình tách biệt

- `.local/compose-app/provider.env`: cấu hình model online, giữ nguyên khi kiểm thử local.
- `.local/compose-app/ollama.env`: endpoint/model local, structured output và tắt reasoning cho model đã kiểm thử.
- `.local/compose-app/llm-profile`: `ollama` hoặc `online`.
- Named volume `app-knowledge`: LanceDB persistence riêng cho Python container; host launcher dùng `.local/knowledge`.

Các file này không đưa vào Git. Chuỗi key `ollama` là giá trị tương thích HTTP API local, không phải online API key. `activate`/`online` không gửi request tới provider. Đổi profile cần chạy lại `configure` và recreate services để môi trường có hiệu lực.

Để quay về cấu hình online đã có:

```sh
python3 infra/local/ollama.py online
python3 infra/local/compose.py configure
python3 infra/local/compose.py up
```

Lệnh đổi profile không kiểm thử model online. Có thể giữ retrieval/embeddings local khi chọn model online bằng `KNOWLEDGE_ENABLED=true python3 infra/local/compose.py configure`, rồi recreate Python container; cấu hình này không gửi request online khi khởi động. Không bật retrieval nếu chưa có daemon/embedding model local sẵn sàng. Không dùng online key trong smoke test local.

## Kiểm tra

```sh
ollama list
curl http://127.0.0.1:11434/api/tags
```

Sau khi app chạy, vào **Tri thức AI** để tạo chỉ mục của dataset đang chọn. Trong **Truy vấn**, chọn mode API, hỏi về bảng/cột có thật và kiểm tra model, SQL, bảng nguồn và kết quả. Model local có thể từ chối hoặc sinh SQL không hợp lệ; lỗi phải hiển thị đúng, không chuyển âm thầm sang câu trả lời giả hoặc deterministic. Một model nhỏ không bảo đảm mọi câu hỏi đều chính xác.

Tài liệu nguồn: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [qwen3](https://ollama.com/library/qwen3), [embeddinggemma](https://ollama.com/library/embeddinggemma). Bằng chứng kiểm thử dự án nằm trong [work log](work-log.md).
