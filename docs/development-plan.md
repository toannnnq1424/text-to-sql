# Kế hoạch phối hợp: contract trước, ba luồng cùng bắt đầu

**Hiện tại: C0 đang chuẩn bị tài liệu; chưa role review/schema validation runtime.** Không đánh dấu các gate sau hoàn thành trong phiên này. Gate là mốc kiểm chứng của một target cuối đầy đủ, không là phiên bản rút gọn. Áp dụng [implementation-rules.md](implementation-rules.md) cho mọi task: mỗi chức năng được triển khai cùng validation, error handling, security và test cần thiết; C4 tổng hợp bằng chứng, không phải lúc mới bắt đầu làm các phần đó. Không chuyển integration sang version sau.

```text
C0: CHỐT CONTRACT + semantic/demo schema + UI reference
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
        React        Java        Python/Data
      MSW Java     mock AI      mock Java input
          │           │            │
          └───────────┼────────────┘
                      ▼
C1:              Java ↔ Python
                      ▼
C2:              React ↔ Java
                      ▼
C3:     PostgreSQL / MySQL / SQL Server thật
                      ▼
C4:           E2E + security + visual
```

Trong C1/C2, adapter/tests cả ba engine đã phát triển song song, không đợi C3 mới làm MySQL/SQL Server. Java registry/API/security/adapter làm từ ngày đầu sau C0, không chờ Python hoặc FE.

## C0 — baseline dùng chung trước khi tách code

- Cùng commit Warehouse/Dataset/Query, Java→Python request/response, semantic context, error/status/pagination/precision/chart conventions và API inventory.
- Convert đặc tả contract thành OpenAPI/JSON Schema; validate shared fixtures và nested DTO cho catalog/ingestion/evaluation/monitoring/settings. Các API bổ sung cần cho UI không tự phát sinh trong một service.
- Kiểm tra auth dev/prod identity config, resource scopes, limits/deadlines, safe credential response.
- BE + AI/Data chốt canonical demo schema ít nhất hai domain, field/grain/type/PK/FK, mappings ba engine; FE xác nhận metadata đủ render generic.
- FE xác nhận shell/reference map, viewport và route active; không yêu cầu mockup mới để trì hoãn target UI đã rõ.
- Mỗi vai trò ghi review bằng task/PR checklist; resolve drift trước khi phụ thuộc. Baseline tài liệu này chưa là biên bản ba người đã review.

## Giao việc song song sau C0

| Luồng | Task đầu tiên | Phụ thuộc đầu vào | Bằng chứng đầu ra |
|---|---|---|---|
| FE | UI tuân style ảnh + query/result/catalog/history nối API client thật; MSW chỉ cho test/cô lập dependency nếu cần | C0 contract + images | UI chạy/build, route/state tests, screenshot |
| BE | DTO/API, metadata store, registry, auth, 3 adapters/dialects, query với mock AI | C0 + agreed schema | API contract tests, parser/security tests, adapter matrix |
| AI/Data | Internal API, provider client ưu tiên, deterministic, context selection, canonical generators/eval corpus | C0 + agreed schema | strict response, pytest, fixtures ≥40 logical cases |
| Infra phối hợp BE | Compose + CI chạy cả 3 DB | runtime choices của các luồng | reproducible services + secrets-safe env example |

## C1 — Java ↔ Python

Dùng fixture và deterministic trước để test wire/error/timeout; sau đó provider API smoke khi có key hợp lệ. Verify correlationId, dialect, semantic versions, unknown references, malformed JSON, provider failure. Không dùng raw SQL string equality làm semantic assertion.

## C2 — React ↔ Java

Tắt MSW cho integration; test selectors/context changes, query success/failure, result metadata/chart/precision, catalog/history filters, ingestion/evaluation status, auth boundaries. FE không gọi Python. Không chữa API drift bằng hard-coded mapping rải component.

## C3 — Database matrix thật

Cùng logical datasets và questions trên PostgreSQL/MySQL/SQL Server, compare result canonicalization (order, null, decimal, timezone), validate discovery/allowlist/limits/read-only privileges/timeout. Seed/provisioning riêng, app chỉ register/test/discover/validate. Không lấy một Postgres screenshot làm evidence ba engine.

## C4 — nghiệm thu tích hợp

E2E ba paths, security corpus, evaluation report, UI visual comparison, table large/null/long value, pipeline idempotency/failure, monitoring counts thực và no placeholder. Ghi evidence theo acceptance. Không bỏ yêu cầu mandatory vì khó; ghi blocked cụ thể và giải quyết trước khi claim done.

## Quản lý task/nhánh

Một conversation một scope theo `task-template.md`, ví dụ `module/fe-query`, `module/be-adapters`, `module/ai-provider`. Shared contracts/schema do task phối hợp, không sửa độc lập ba bản. Khi một luồng chờ integration, tiếp tục test/mock/client trên baseline thay vì thay endpoint riêng. Không tự mở chat hoặc spawn agents trong phiên chuẩn bị này.
