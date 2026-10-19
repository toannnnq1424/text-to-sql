# Shared contract baseline 1.0.0

Đọc cùng nhau, không chọn riêng một DTO:

1. [Domain](domain.md): Warehouse, Dataset, Query, result, chart, pagination.
2. [Semantic model](semantic-model.md): context Java cung cấp Python.
3. [Java ↔ Python](java-python.md): internal request/response, timeout và error.
4. [Public API](public-api.md): React ↔ Java.
5. [Errors](errors.md): HTTP, mã lỗi, trạng thái query.
6. [Examples](examples/): fixture JSON đủ để FE mock API, BE mock AI, AI mock Java input.

`contractVersion=1.0.0` là version tài liệu/fixture, không bắt thêm field vào response Python. `semanticVersion` và `schemaVersion` độc lập, lưu snapshot vào Query. `/api/v1` và `/internal/v1` là namespace API.

Đây là baseline thiết kế, chưa có generated clients hoặc OpenAPI đã chạy. Task C0 cần chuyển các bảng đã chốt thành OpenAPI + JSON Schema strict, validate fixtures, thống nhất auth/limits và cross-check giữa DTO TypeScript/Java/Pydantic trước khi phát triển độc lập. Không chờ code từng service hoàn thành để mới làm contract.

Thay đổi breaking phải chỉ ra request/response/fixture nào đổi, bên nào bị ảnh hưởng, sửa mọi role/consumer liên quan và ghi decision. Không ngầm đổi camelCase thành snake_case. Không tạo bản copy contract riêng trong từng service.
