# AI / Data — Python / Prompt / Evaluation / ELT

Bắt buộc đọc và áp dụng [implementation-rules.md](../implementation-rules.md): module được giao phải có implementation thật, validation, error handling, security liên quan và test cần thiết ngay trong cùng phạm vi; không chia version, không placeholder hoặc hoãn tích hợp sang lần sau.

Đọc AGENTS, scope, contracts, security, data-sources, acceptance và `docs/prompts/03-ai-data.txt`. Không tự tạo schema độc lập với BE. Đọc future-extensions cho local inference/training; API provider là ưu tiên triển khai.

## Ownership và stack

`ai-service/` và `data/` (phối hợp BE). Python 3.11+, FastAPI, Pydantic strict, httpx, pytest. Internal route duy nhất cho generation là POST /internal/v1/text-to-sql. Không expose cho FE, không credential warehouse, không execute production SQL. Evaluation có thể gọi Java trong môi trường test bằng tài khoản được cấp quyền; không bypass executor Java.

## Bắt đầu ngay sau C0

1. Pydantic models đúng fixture shared và mock Java input; validate enum/required fields/unknown fields/errors. Không tự đổi snake_case trên wire.
2. TextToSqlModelClient abstraction; ưu tiên OpenAICompatibleModelClient thực gọi API với LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS. Structured JSON parse/validate, controlled errors, timeout và response redaction.
3. DeterministicModelClient offline support ba dialect, nhiều domain qua templates khai báo trong fixtures; không if revenue/customer trong core. Mode rõ ràng, không giả production AI hoặc fallback im lặng khi provider down.
4. Pipeline normalize → relevant context + join paths selection → few-shot cùng dialect → prompt dialect-aware → provider → strict response → candidate checks. Context/token budget có ranh giới; candidate metrics/dimensions/chart references phải kiểm tra theo chính context đã gửi cho model, không theo toàn bộ request ban đầu. Deterministic chỉ tìm trong examples đã được selector chọn. Input là data không là chỉ thị override prompt.
5. Không bịa schema khi thiếu context; trả INSUFFICIENT_CONTEXT/UNSUPPORTED_QUESTION/LOW_CONFIDENCE đúng contract. Confidence có policy dựa trên match/ambiguity, không random; Java vẫn validate độc lập.
6. Chart recommend allowlist, reference column/metric đúng; không code executable. AI không quyết định final SQL được chạy.

## Data engineering phối hợp BE

Đọc đủ nguồn được lưu trong data-sources.md. Thiết kế canonical demo schema + datatype/grain/PK/FK + metric/dimension definitions với BE trước seed. Generator deterministic cùng seed, fixed reference time, mappings rõ cả ba engine. Dùng ít nhất hai domain (ví dụ commerce và market-price) để chứng minh core không hard-code. Synthetic market-price không được trình bày như giá thị trường thật.

Dữ liệu ngoài repo chỉ tải khi task triển khai được giao, ghi nguồn/version/license/checksum và không commit bulk data hoặc PII mặc định. SQL Import trong ứng dụng là mandatory nhưng chỉ hỗ trợ subset parse/validate/preview đã chốt; không execute SQL tùy ý. Pipeline in-app raw→staging→warehouse→mart là mandatory với source registry, idempotency, rejected rows, schema/data-quality checks và run metrics Java nhận. Phối hợp BE cho parser/canonical schema/type mapping, writer isolation và API contracts. Phân biệt physical metadata đọc từ warehouse với semantic metadata do admin/model cấu hình; không mô tả curated semantic examples như tự sinh từ database.

## Evaluation và hoàn thành

Tối thiểu 40 logical cases, nhiều domain, Việt/Anh, aggregation/group/time/top/bottom/filters, ambiguous/unsupported/injection. Mỗi case có expectation cho cả ba dialect (tối thiểu 120 case-engine combinations), semantics và expected result hoặc rejection; train/dev/test tách biệt. Không đo bằng raw SQL string equality. Chạy pytest, deterministic fixtures, provider mock failure, ít nhất smoke provider thật khi có config và evaluation qua executor Java cả ba engines. Báo rõ mode/provider và những check chưa chạy.
