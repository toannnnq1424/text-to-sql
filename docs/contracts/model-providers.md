# Cấu hình model và API key trong ứng dụng

Baseline `module/model-provider-settings`, theo yêu cầu người dùng2026-10-21. Supersede quy tắc cũ chỉ cho cấu hình LLM key qua deployment: ADMIN được nhập/thay/xóa key trong Settings, Java lưu mã hóa, không trả plaintext. Warehouse credentials vẫn theo secret references; React chỉ gọi Java. Không thay enum engine hoặc eight-field Candidate.

## Public API

GET `/settings/model-providers` → `{items:ProviderSummary[],defaultProviderId:string|null,configurationAvailable:boolean}`. Đọc cho người dùng đã xác thực (local development theo auth hiện có). Summary `{providerId,revision,name,kind:ONLINE|OLLAMA,baseUrl,model,hasApiKey,enabled,configured,source:APPLICATION|ENVIRONMENT,readOnly,updatedAt:string|null}`. Không key, ciphertext, key suffix hoặc token vào response. ENVIRONMENT dùng providerId `environment`, chỉ đọc; reflects cấu hình thật của Python, không giả model theo ảnh. Không sửa `.env` hiện có khi quản trị profile trong app.

POST `/settings/model-providers` ADMIN →201 Summary. Body `{name,kind,baseUrl,model,enabled,apiKey?:string}`. PUT `/settings/model-providers/{id}` ADMIN →Summary; cùng body +`revision` bắt buộc, optional `clearApiKey:boolean`. Không gửi key khi update→giữ key hiện tại; clear tường minh. Đổi destination baseUrl/kind không được tự chuyển key cũ: phải thay key hoặc clear; enabled ONLINE phải có key. Model/name có giới hạn, key tối đa8192ký tự không whitespace/control; tên/URL/model không dùng như chỗ giấu key. URL không userinfo/query/fragment; chỉ endpoint Chat Completions tương thích. Server kiểm host allowlist/egress, HTTPS cho online trừ loopback/private endpoint được deployment cho phép tường minh. Không redirect, TLS verify không bị tắt. OLLAMA chỉ dùng local/private host được phép, không public cloud host giả local; không đòi key; không dùng key online cho local ngầm.

PUT `/settings/model-providers/default` ADMIN body `{providerId:string|null}` →List response. Chỉ profile enabled/configured hoặc environment thật. null nghĩa không chọn APPLICATION override, fallback environment nếu có. DELETE `/settings/model-providers/{id}` ADMIN→204; không xóa environment; profile đang mặc định phải đổi mặc định trước (409). Mutation audit chỉ action/id/revision, không key/request body; stale revision409. Save không tự gọi model hoặc kiểm thử key. Key chỉ gửi trong body request một lần, không URL/browser storage/query cache/debug log; reset password input sau lưu/tháo component. Có lỗi rõ nếu server chưa provision master key, không lưu plaintext fallback.

## Query và ý nghĩa chế độ

Public Query request thêm optional `providerId:string` cho mode API; AUTO dùng default hiện hành (không nhận override); DETERMINISTIC từ chối providerId. Không nhận raw key/model/baseUrl từ query caller. Java chốt profile/config snapshot cho mỗi query, giải mã key server-side và chỉ gửi trusted private Python input; không lấy credentials từ metadata/prompt. Query detail thêm nullable `provider:{providerId,revision,name,kind,model,source}`; snapshots cũ default null. `model` hiện có vẫn là tên model thực response, không lấy nhãn UI làm bằng chứng đã gọi.

- AUTO: gọi LLM của profile mặc định, hiển thị chính xác ONLINE/Ollama +model; không fallback deterministic khi provider lỗi.
- API: người dùng chọn một profile đã cấu hình (hoặc environment) rồi gọi model đó. Label UI là “Chọn model/API”, không ghi “Tùy chỉnh” mà thiếu tên model.
- DETERMINISTIC: không gọi bất kỳ model/AI API nào; khớp câu hỏi với ví dụ semantic đã khai báo của dataset/dialect, không inference/training/Ollama. Label “Offline · khớp ví dụ (không AI)”.
- Structured semantic query: compiler theo metrics/dimensions, không LLM; label “Công thức ngữ nghĩa · không gọi AI”.

Result/history/technical display nguồn/kind/model snapshot và mode. Không retroactively gắn default mới vào history cũ. Semantic assist dùng default model có nhãn; embedding knowledge vẫn dùng cấu hình embedding riêng, không bị đổi theo profile sinh SQL.

## Private Java → Python

POST `/internal/v1/model-provider/status` service-auth + correlation body `{correlationId}` →`{provider:ProviderSummary|null}` cho ENVIRONMENT (chỉ safe metadata, không key). `AiClient.invoke` allowlist explicit.

Input text-to-sql và semantic-assist thêm optional `modelConfig:{kind,baseUrl,model,apiKey?,structuredOutput:boolean}` trusted configuration. Không thêm vào semanticContext, memory fingerprints, retrieval entries, provider user/system prompt hoặc Candidate response. Python validate independent URL/host/model/key bounds, request-scoped ContextVar (reset cả khi lỗi/concurrency), dùng key riêng làm Authorization header tới đúng endpoint. Không thay os.environ/global client credentials khi request. Default không modelConfig tiếp tục dùng env hiện có; deterministic không dùng config hoặc outbound provider. Provider payload model + structured output tuân config; profile ONLINE dùng JSON object cho endpoint tương thích tối thiểu, OLLAMA dùng JSON Schema grammar; environment giữ LLM_STRUCTURED_OUTPUT hiện có; timeout/body/security/correction budgets giữ nguyên. Failed endpoints chỉ sanitized errors, không raw upstream body/URL secrets. Test hai cấu hình đồng thời không trộn key/model.

## Persistence và acceptance

Java lưu profiles trong metadata PostgreSQL, AES-GCM với nonce ngẫu nhiên và AAD profileId; encryption master key độc lập DB (deployment-generated ignored local file/env, không Git). Khởi động lại giữ key/config; master key thiếu/sai không fallback plaintext, không làm mất dữ liệu ngầm. API summaries/profiles/queries không chứa key. Server-side encryption không thay HTTPS cho deployment.

Acceptance: auth401/role403, CRUD/rotate/preserve/clear/conflict/delete/default, ciphertext không plaintext trong DB, no-secrets response/log/prompt, per-request provider isolation; caller thật Java→Python→Ollama→DB3 và React Settings→query/result. Online config gốc giữ nguyên, không gọi online theo yêu cầu cũ; mô phỏng transport chỉ chứng minh protocol/error isolation, không chứng minh key online hợp lệ. Tài liệu/run scripts phải provision encryption key cho clone mới; không yêu cầu file secrets của maintainer.
