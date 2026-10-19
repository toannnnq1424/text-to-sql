# Shared protocol fixtures

Các JSON là synthetic examples, không phải database/provider output đã chạy. FE dùng public query/registry/error fixtures cho MSW, BE dùng ai-response làm mock AI, Python dùng ai-request làm mock Java input. Không copy sửa riêng trong ba service.

- `ai-request.json` / `ai-response.json`: PostgreSQL.
- Suffix `-mysql`, `-mssql`: cùng logical context và câu hỏi, syntax khác dialect.
- `query-request.json`, `query-success.json`, `query-empty.json`, `query-rejected.json`: public query examples.
- `warehouses.json`, `datasets.json`: selectors/list.
- `error-schema-mismatch.json`: error envelope.

`confidence=1.0` trong deterministic fixture có nghĩa exact declared template/context match; không biểu thị độ tin cậy đã đo của LLM thật. Policy confidence thực cần triển khai/test theo AI role. Schema `analytics` của MySQL là database/catalog; đây là mapping protocol, chưa provisioning. Các engine fixtures không phải adapter SQL syntax test đã pass. Các fixtures chỉ minh họa protocol một domain, không thay yêu cầu ≥2 domains/40 logical evaluation cases của triển khai.

C0 bổ sung machine-readable schema + validators và các state/collection fixtures còn lại theo public API trước khi consumers tự thiết kế.
