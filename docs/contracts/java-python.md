# Java → Python internal API

The private native planning/rewrite call is defined separately in [semantic-planner.md](semantic-planner.md); Java invokes it on the AI SQL candidate before the mandatory Java AST guard.

`POST /internal/v1/text-to-sql`, Content-Type application/json. Private network + service token qua `Authorization: Bearer …` từ secret manager/env; không nhận credential warehouse. `X-Correlation-ID` trùng `correlationId` trong body; Java tạo ID khi public request chưa có. Không log service token.

## Request bắt buộc

```json
{
  "correlationId": "corr-demo-001",
  "warehouseId": "wh-demo-pg",
  "datasetId": "ds-commerce-pg",
  "sqlDialect": "POSTGRESQL",
  "question": "Tổng doanh thu theo khu vực?",
  "semanticContext": {
    "tables": [],
    "metrics": [],
    "dimensions": [],
    "relationships": [],
    "examples": [],
    "businessRules": [],
    "semanticVersion": "1.0.0",
    "schemaVersion": "1.0.0",
    "timezone": "Asia/Ho_Chi_Minh",
    "referenceTime": "2026-10-19T00:00:00Z"
  }
}
```

Ví dụ trên chỉ mô tả envelope: context rỗng phải bị từ chối, không là success fixture. [Fixture đầy đủ](examples/ai-request.json). Enum sqlDialect là một giá trị cụ thể, không chuỗi `POSTGRESQL | MYSQL | SQL_SERVER`. warehouseId/datasetId chỉ định danh; Python không dùng chúng để tìm credentials hay tự query.

## Response 200

```json
{
  "sql": "SELECT region, SUM(net_amount) AS total_revenue FROM analytics.fact_sales GROUP BY region",
  "explanation": "Tổng doanh thu thuần theo từng khu vực.",
  "assumptions": [],
  "selectedMetrics": ["total_revenue"],
  "selectedDimensions": ["region"],
  "chartRecommendation": {
    "type": "bar",
    "title": "Doanh thu theo khu vực",
    "x": "region",
    "series": [{"column": "total_revenue", "label": "Doanh thu"}]
  },
  "confidence": 0.9,
  "model": "configured-provider-model"
}
```

Tất cả tám field response bắt buộc. Arrays có thể rỗng. SQL nonempty, một read-only SELECT/CTE SELECT; không markdown fence. confidence [0,1] có cơ sở, không random, không thay thế security validation. Java kiểm tra cả unknown metric/dimension references và chart references. Response là candidate, không là giấy phép execute.

## Lỗi, timeout, limits baseline

Error envelope thống nhất [errors.md](errors.md). Python: 422 cho INSUFFICIENT_CONTEXT, UNSUPPORTED_QUESTION, LOW_CONFIDENCE; 502 cho INVALID_MODEL_RESPONSE, SQL_DIALECT_ERROR; 503 PROVIDER_UNAVAILABLE; 504 PROVIDER_TIMEOUT; 401/403 cho service auth. Java map provider errors thành public LLM_ERROR hoặc QUERY_TIMEOUT, giữ reasonCode an toàn trong details. Không traceback/provider payload/secret tới Java/browser.

Baseline vận hành để C0 kiểm tra: question max 1000 ký tự; internal request max 1 MiB; context budget 12k tokens (cấu hình theo provider và dành chỗ output); LLM timeout 30s; Java internal call 35s; warehouse statement timeout 15s; query HTTP deadline 60s; FE request timeout 65s. Java áp tổng deadline để mọi stage không vượt 60s. Không retry query hoặc LLM POST tự động vì có thể double bill/duplicate history; chỉ retry provider theo policy có giới hạn và remaining deadline nếu được quyết định rõ sau này. Giới hạn không là cam kết latency.

Implementation context hiện giới hạn **toàn bộ request body UTF-8** bằng `LLM_REQUEST_MAX_BYTES` (mặc định 48.000 bytes), gồm system prompt, response schema và user/context JSON. Đây không phải phép đếm chính xác 12k tokens của một model. `LLM_CONTEXT_CHARS` cũ không còn điều khiển selector; khi nâng checkout cần chuyển cấu hình sang tên mới. Model-specific token accounting và phần dự trữ output cần đối chiếu với provider khi cấu hình model thật; chưa có bằng chứng nghiệm thu token budget chỉ từ giới hạn bytes. Selector dùng tối đa năm few-shot cùng dialect, giữ context cần thiết và trả lỗi nếu phần đó không vừa, không cắt object hoặc silently fallback.

OpenAICompatibleModelClient ưu tiên thực hiện trước; model/base URL/key/timeout cấu hình server. DeterministicModelClient offline nhận cùng request/response, support đủ ba dialect và nhiều domain qua templates/fixtures semantic, chỉ chấp nhận pattern được khai báo; unsupported phải báo lỗi, không bịa SQL. Không fallback deterministic khi API lỗi. Local inference có thể dùng cùng abstraction, training xem hướng mở rộng.
