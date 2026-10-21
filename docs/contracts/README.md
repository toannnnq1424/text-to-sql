# Shared contract baseline 1.0.0

Đọc cùng nhau, không chọn riêng một DTO:

1. [Domain](domain.md): Warehouse, Dataset, Query, result, chart, pagination.
2. [Semantic model](semantic-model.md): context Java cung cấp Python.
3. [Java ↔ Python](java-python.md): internal request/response, timeout và error.
   [Java ↔ native semantic planner](semantic-planner.md): private Wren manifest, rewrite, lineage and post-rewrite Java guard.
4. [Public API](public-api.md): React ↔ Java.
5. [Errors](errors.md): HTTP, mã lỗi, trạng thái query.
6. [File ingestion](file-ingestion.md): bulk upload, inferred mapping, private parser and asynchronous four-layer loads.
7. [Private data executor](data-tool-runtime.md): approved query transport, native pools and typed results.
8. [Semantic workbench / knowledge / pipelines](semantic-workbench.md): source-fork business compiler, dataset memory and independent layer transformations.
9. [Analytics experience](analytics-experience.md): dataset-derived suggestions, reviewed semantic assistance, compact executed SQL and result-driven charts.
10. [Examples](examples/): fixture JSON đủ để FE mock API, BE mock AI, AI mock Java input.

`contractVersion=1.0.0` là version tài liệu/fixture, không bắt thêm field vào response Python. `semanticVersion` và `schemaVersion` độc lập, lưu snapshot vào Query. `/api/v1` và `/internal/v1` là namespace API.

Baseline này đã có consumers TypeScript/Zod, Java và Pydantic, cùng [OpenAPI của frontend](frontend-openapi.json) được sinh từ schemas tiêu thụ tại runtime. Đây không phải client được generate từ một OpenAPI server duy nhất; các kiểm thử consumer/provider và kiểm tra tích hợp vẫn cần đi kèm mọi thay đổi. OpenAPI không tự chứng minh endpoint hoạt động hoặc security đã nghiệm thu.

Thay đổi breaking phải chỉ ra request/response/fixture nào đổi, bên nào bị ảnh hưởng, sửa mọi role/consumer liên quan và ghi decision. Không ngầm đổi camelCase thành snake_case. Không tạo bản copy contract riêng trong từng service.
