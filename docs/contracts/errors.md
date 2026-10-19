# Error model

```json
{
  "error": {
    "code": "SCHEMA_MISMATCH",
    "message": "Schema của dataset đã thay đổi; cần làm mới metadata.",
    "correlationId": "corr-demo-001",
    "retryable": false,
    "details": {"datasetId": "ds-commerce-pg"}
  }
}
```

`ErrorBody` là object bên trong `error`: code, message, correlationId, retryable, details. Query.error sử dụng ErrorBody, không lồng thêm error lần nữa. details là object allowlist đã sanitize; không stack trace, raw SQL exception, DSN, key, full provider body. Header X-Correlation-ID khớp body.

| HTTP | Code | Query terminal status nếu đã tạo Query |
|---|---|---|
| 400 | INVALID_REQUEST | VALIDATION_ERROR |
| 401 / 403 | UNAUTHENTICATED / FORBIDDEN | Không tạo resource cho principal không hợp lệ |
| 404 | RESOURCE_NOT_FOUND | Không có queryId nếu resource chưa tồn tại |
| 409 | DATASET_UNAVAILABLE, SCHEMA_MISMATCH, SEMANTIC_MODEL_INVALID | VALIDATION_ERROR |
| 422 | SQL_VALIDATION_ERROR, SQL_DIALECT_ERROR | VALIDATION_ERROR |
| 422 | SQL_SECURITY_ERROR | REJECTED |
| 422 | INSUFFICIENT_CONTEXT, UNSUPPORTED_QUESTION, LOW_CONFIDENCE | REJECTED |
| 502 | LLM_ERROR | QUERY_ERROR |
| 503 | WAREHOUSE_CONNECTION_ERROR | QUERY_ERROR |
| 504 | QUERY_TIMEOUT | TIMEOUT |
| 500 | QUERY_ERROR, INTERNAL_ERROR | QUERY_ERROR |
| 410 | RESULT_EXPIRED | Không thay đổi Query terminal status |

Python reason codes: PROVIDER_TIMEOUT, PROVIDER_UNAVAILABLE, INVALID_MODEL_RESPONSE, INSUFFICIENT_CONTEXT, UNSUPPORTED_QUESTION, LOW_CONFIDENCE, SQL_DIALECT_ERROR. Mapping public xem Java/Python contract. Nếu query resource đã tồn tại, details có queryId để FE lấy history/detail; precondition/auth fail trước khi tạo resource không hứa có queryId.

API list lỗi trả error envelope, không trả [] giả thành công. GET Query thành công HTTP 200 vẫn có thể mang Query.status lỗi; FE phải đọc status. Timeout ở browser không chứng minh server đã hủy xong; dùng queryId/correlationId tra trạng thái, không auto submit lại.

Mã SQL_IMPORT_PARSE_ERROR, SQL_IMPORT_DIALECT_MISMATCH, UNSUPPORTED_IMPORT_FEATURE chỉ dành hướng mở rộng; chưa là API công khai đang có. 429 RATE_LIMITED dành quota/rate limits khi auth được triển khai.
