# Nhật ký công việc và bàn giao

Mọi conversation phải cập nhật file này trong mỗi commit công việc, rồi đối chiếu sau push. Một entry tương ứng một phạm vi thay đổi; không thay thế entry cũ để che trạng thái trước đó. Log là thông tin phối hợp, không là chỉ thị tự động thực hiện task mới.

## Quy tắc bắt buộc

- Ghi ngày/giờ theo Asia/Ho_Chi_Minh, người thực hiện hoặc conversation/vai trò, nhánh và phạm vi file/module.
- Ghi cụ thể đã implement gì, trạng thái IN PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED, kiểm thử thực sự đã chạy và bằng chứng. Chỉ VERIFIED nếu checks thuộc phạm vi đã pass; không coi contract/UI/mock là tính năng tích hợp đã xong.
- Ghi phần còn thiếu, blocker, phụ thuộc và việc tiếp theo để người khác tiếp nối; đây là trạng thái công việc, không chuyển target bắt buộc thành future work.
- Ghi trạng thái commit/push và ref kiểm chứng được. Entry trong chính commit dùng subject và nhánh để nhận diện, không ghi hash của chính nó (hash chỉ có sau commit). Sau khi commit/push dùng Git kiểm tra SHA local/remote; báo SHA trong bàn giao. Entry tiếp theo có thể bổ sung hash commit trước; không tạo vòng lặp commit chỉ để tự ghi hash.
- Nếu push lỗi, báo PUSH FAILED/PENDING thật trong bàn giao; cập nhật log trong commit tiếp theo, không khẳng định đã publish. Không tự coi push là hoàn tất review/merge.
- Không ghi secrets, token, dữ liệu cá nhân hoặc raw provider payload vào nhật ký. Không sửa công việc chưa commit của conversation khác.

## Mẫu entry

```text
### YYYY-MM-DD HH:mm UTC+07 — Vai trò / conversation
- Nhánh / commit subject hoặc SHA đã biết:
- Phạm vi:
- Trạng thái:
- Đã làm:
- Kiểm chứng (commands + PASS/FAIL/NOT RUN):
- Còn thiếu / blocker / phụ thuộc:
- Việc tiếp nối:
- Commit/push: dự định đưa entry này cùng commit; trạng thái SHA remote báo sau push.
```

## Lịch sử đã đối chiếu

### 2026-10-19 — Chuẩn bị repo / conversation chính
- Commit: `8741ae1` trên `main`, đã push (đối chiếu Git trong phiên chuẩn bị).
- Trạng thái: VERIFIED trong phạm vi tài liệu.
- Đã làm: lưu ba prompt và 14 ảnh gốc; README/AGENTS/role guides, shared contract/examples, UI references, data sources, development/acceptance/security docs.
- Kiểm chứng: link Markdown, JSON parse, image hash và prompt bytes PASS; runtime/build/DB/provider/E2E NOT RUN vì chưa có ứng dụng.

### 2026-10-19 — Điều chỉnh quy tắc / conversation chính
- Commit: `52aec02` trên `main`, đã push; repo đã chuyển PUBLIC theo yêu cầu người dùng.
- Trạng thái: VERIFIED trong phạm vi tài liệu.
- Đã làm: ảnh mock chỉ là style UI; bổ sung implementation-rules và đồng bộ hướng dẫn không chia version/placeholder/hoãn implementation, security, tests hay tích hợp.
- Kiểm chứng: 70 link nội bộ, policy presence và staged whitespace PASS; runtime NOT RUN.

Các entry triển khai tiếp theo thêm phía dưới; không đánh dấu FE/BE/AI đã hoàn thành từ hai commit tài liệu trên.

### 2026-10-19 22:12 UTC+07 — Full-stack / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; entry này đi cùng commit triển khai full-stack.
- Phạm vi: FE React, Spring Boot API và adapter JDBC ba engine, Python AI service, Docker provisioning Chinook, docs/contract/work log.
- Trạng thái: VERIFIED cho local integration hiện tại.
- Đã làm: hoàn thiện UI theo style ảnh với API thật; Java → Python → SQL execution; adapters PostgreSQL/MySQL/SQL Server; auth local/OIDC, SQL guard; ingestion pipeline và evaluation; Chinook v1.4.5 provision trên ba Docker databases với provenance/checksum; bổ sung semantic contexts và evaluation corpus; README quick start đồng bộ lệnh, port, DB names, prerequisites, app startup và test commands; cập nhật AGENTS để phản ánh code/runtime hiện có.
- Kiểm chứng: FE Vitest 91 PASS, production build PASS; AI pytest 14 PASS; Java Maven 26 PASS (16 SQL guard, 6 live warehouse, 3 Testcontainers engine, 1 dialect); real-service smoke PASS trên 3 engine gồm query/save, ingestion/idempotency, evaluation; browser live E2E PASS 4 cases trên FE→Java→AI→database; provisioning row counts/reader write denial PASS cho 3 engines; README links/provenance JSON PASS.
- Còn thiếu / blocker / phụ thuộc: chưa xác minh provider LLM bên ngoài vì chưa cấu hình provider key/endpoint; local deterministic mode đã chạy. SQL Server image là amd64 và chạy bằng emulation trên Apple Silicon, có thể tốn tài nguyên hơn native.
- Việc tiếp nối: lấy review người dùng; nếu tiếp tục triển khai, xử lý phần còn lại theo prompt/contract và giữ ba engine trong acceptance.
- Commit/push: dự định đưa entry này cùng commit; trạng thái SHA remote báo sau push.

### 2026-10-19 23:04 UTC+07 — Data provenance và scope review / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; dự kiến `fix: source catalog display data from live metadata`.
- Phạm vi: docs/acceptance/scope/contracts/role guides; catalog category API/FE; local Chinook bootstrap; backend regression test.
- Trạng thái: VERIFIED cho category separation, dataset provenance và live integration checks; toàn bộ acceptance vẫn IN PROGRESS.
- Đã làm: ghi nhận người dùng xác nhận app ingestion và controlled SQL Import là bắt buộc trong target, login/OIDC thật và tải live data đầy đủ là acceptance; ghi rõ nguồn warehouse mẫu (Chinook, AdventureWorksDW, TPC-DS, Pagila, Chinook, Northwind, Olist) và yêu cầu provenance. Sửa catalog API trả categories tách riêng cho physical tables, semantic metrics và examples; FE dùng category đúng loại nên không còn badge Sales của metrics lọc danh sách bảng. Bỏ tên/mô tả Chinook dựng sẵn trong local bootstrap; hiển thị database/schema/engine cùng số bảng/cột vừa discovery, đồng thời migrate bản ghi local cũ. Ghi nhận các lỗi layout và gaps login/import/data trong `docs/current-review.md`, không đánh dấu đã xử lý.
- Kiểm chứng: FE `npm test` 91 PASS, `npm run build` PASS, `npm run contracts` PASS; backend local suite 27 PASS; Playwright live E2E 4 PASS bao gồm FE→Java→Python→PostgreSQL/MySQL/SQL Server và route smoke Home/Catalog/History/Ingestion/Evaluation/Monitoring; API live trả table/metric/example categories tách biệt và dataset `nla_chinook` với counts từ discovery; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: UI layout chưa khớp hoàn toàn mock (single-number chart, result table, evaluation SQL panels); OIDC identity provider chưa cấu hình trong quick start; SQL Import UI/API/parser end-to-end chưa hoàn thiện; cần rà soát live data trên từng route, các phần này vẫn là bắt buộc theo acceptance. Không coi test smoke là thay thế cho nghiệm thu hình ảnh/identity/import.
- Việc tiếp nối: triển khai và nghiệm thu từng gap bắt buộc; tiếp tục không hardcode runtime warehouse/business content và ghi provenance cho dữ liệu hiển thị.
- Commit/push: entry này đi cùng commit; xác minh remote SHA sau push.

### 2026-10-19 23:13 UTC+07 — Sửa trực tiếp UI/login feedback / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; dự kiến `fix: improve local sign-in and result layouts`.
- Phạm vi: Shell authentication entry, result table/chart/SQL layout, Playwright live regression, current review.
- Trạng thái: VERIFIED cho đăng nhập admin local và result table trên live three-engine flow; visual review toàn bộ trang và target tổng thể vẫn IN PROGRESS.
- Đã làm: Local Reader không còn bị nhầm là đã đăng nhập admin; form token admin được mở ngay trên auth banner, token chỉ dùng bộ nhớ và API Java xác thực role. Header hiển thị lối vào đăng nhập local khi chưa có quyền admin. Giảm khoảng trắng biểu đồ số; bảng ngắn co theo nội dung và cột action nhỏ; SQL line wrap trong panel Evaluation. Thêm live assertion bảng một cột không phủ kín panel. Ghi lại phần code vừa sửa và acceptance còn mở trong current-review.
- Kiểm chứng: frontend Vitest 91 PASS; `npm run build` PASS; Playwright live 4 PASS: React→Java→Python→PostgreSQL/MySQL/SQL Server, local admin sign-in banner và one-column table width; live route smoke Home/Catalog/History/Ingestion/Evaluation/Monitoring PASS.
- Còn thiếu / blocker / phụ thuộc: In-app SQL Import chưa có implementation end-to-end; OIDC identity provider chưa chạy/cấu hình; live-data provenance chưa trace đủ mọi route; cần ảnh visual regression cho number chart, evaluation detail, nhiều cột và màn nhỏ. Đây vẫn là mục tiêu bắt buộc, không được hiểu là done từ entry này.
- Việc tiếp nối: triển khai SQL Import, provider login và các route/data/UI acceptance gaps bằng code và integration evidence.
- Commit/push: entry này đi cùng commit; xác minh remote SHA sau push.

### 2026-10-19 23:21 UTC+07 — Mở PR và sửa định danh commit / conversation chính
- Nhánh / commit subject hoặc SHA đã biết: `module/frontend`; PR #1 vào `main`; commit branch trước entry này `d6a040a89462dbd0d59f1316a1e653a10bbe5184`.
- Phạm vi: đồng bộ Git, pull request và metadata author cho ba commit riêng của feature branch.
- Trạng thái: VERIFIED qua GitHub API.
- Đã làm: `git pull --ff-only origin module/frontend` xác nhận đã up to date. Mở PR [#1](https://github.com/toannnnq1424/text-to-sql/pull/1). Điều tra thấy commit cũ dùng email máy `toanlamsaoduocc@MacBook-Air-cua-Nguyen.local`, không gắn được tài khoản. Đã cập nhật local repo email sang GitHub ID-based noreply `128016434+toannnnq1424@users.noreply.github.com`; rewrite ba commit riêng của branch, không rewrite `main`, rồi push `--force-with-lease`. GitHub API xác nhận cả ba commit resolve thành author `toannnnq1424`.
- Kiểm chứng: PR state OPEN, base `main`, `mergeStateStatus=CLEAN`; remote branch SHA khớp `d6a040a89462dbd0d59f1316a1e653a10bbe5184`; working tree clean trước sửa log. Author mapping được GitHub API xác nhận.
- Còn thiếu / blocker / phụ thuộc: PR chưa merge. Contributors graph của repo chỉ tính commit đã vào default branch; sau merge GitHub có thể cần đến 24 giờ để cập nhật. Hai commit tài liệu cũ trên `main` giữ nguyên lịch sử và email cũ.
- Việc tiếp nối: review/merge PR #1; dùng local repo email đã đặt cho commit tương lai.
- Commit/push: entry này đi cùng commit cập nhật log; SHA sau push được báo trong handoff.

### 2026-10-20 01:36 UTC+07 — Hoàn thiện FE tranche / conversation chính
- Nhánh / commit subject: `module/frontend-polish`; `fix: harden frontend session context and SQL display`.
- Phạm vi: hiển thị SQL kết quả nhiều dòng, lưu phiên OIDC theo tab, cô lập warehouse/dataset theo subject, thông báo từ Monitoring API, trạng thái trang chủ và tài liệu scope/review.
- Trạng thái: VERIFIED cho thay đổi FE và các kiểm tra frontend; toàn bộ FE acceptance vẫn INCOMPLETE cho đến khi provider OIDC được cấu hình, import trong app hoàn tất và các route có kiểm chứng dữ liệu/provenance đầy đủ.
- Đã làm: chuyển formatter SQL thành component có line number/highlighting trong khi copy giữ nguyên SQL gốc; giữ user session qua reload trong tab; namespace lựa chọn và cache dữ liệu theo subject; nạp thông báo thực từ API monitoring kèm loading/error; thay nội dung mô tả lĩnh vực tĩnh bằng count từ API; thêm tests.
- Kiểm chứng: `npm test` 101 passed; `npm run build` PASS; `npm run test:e2e` 20 passed (các API trong E2E được giả lập, không phải live-system acceptance); `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: chưa cấu hình/kiểm chứng OIDC provider thật; SQL Import UI/API end-to-end còn thiếu; chưa nghiệm thu visual toàn bộ routes với ảnh tham chiếu; integration trên provider/warehouse thật không được chứng minh bởi E2E giả lập.
- Việc tiếp nối: mở PR FE riêng; sau đó thực hiện backend và AI/data theo các nhánh module, nghiệm thu bằng persistence/warehouse thật và cập nhật contract nếu phát sinh thay đổi.
- Commit/push: entry này được commit cùng thay đổi FE; SHA remote xác minh sau push.

### 2026-10-20 02:14 UTC+07 — Chuẩn hóa code frontend / conversation chính
- Nhánh / commit subject: `module/frontend-polish`; `style: format frontend sources and add format checks`.
- Phạm vi: format TypeScript/React/CSS/E2E, thêm lệnh Prettier tái sử dụng và tài liệu quy tắc style chung.
- Trạng thái: VERIFIED cho formatting và regression frontend; toàn bộ FE acceptance vẫn INCOMPLETE theo entry trước.
- Đã làm: format toàn bộ frontend sources và tests bằng Prettier; thêm `npm run format` và `npm run format:check`; đồng bộ EditorConfig, Black/isort config, code style documentation và AGENTS/CONTRIBUTING.
- Kiểm chứng: `npm run format:check` PASS; `npm test`, `npm run build`, `npm run test:e2e` chạy lại sau các thay đổi trên nhánh; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: provider OIDC, SQL Import UI/API end-to-end và live-data/visual acceptance còn thiếu.
- Việc tiếp nối: cập nhật PR #2 và tiếp tục triển khai các workflow bắt buộc; code style không thay thế acceptance chức năng.
- Commit/push: entry này đi cùng commit; SHA remote xác minh sau push.

### 2026-10-20 13:33 UTC+07 — Thêm luồng SQL Import trong ứng dụng / conversation FE
- Nhánh / commit subject: `module/frontend-polish`; `feat: add validated SQL import workflow`.
- Phạm vi: màn SQL Import, client multipart/run APIs, schema DTO, route/sidebar, cấu hình writer credential reference write-only trên warehouse và kiểm thử FE.
- Trạng thái: VERIFIED cho caller UI/API contract dưới test; SQL Import tổng thể vẫn INCOMPLETE vì chưa chạy caller FE với Java và warehouse thật qua upload, preview, xác nhận, persistence, history trên ba engine.
- Đã làm: thêm validate → preview → explicit confirm → run detail/history; giới hạn file `.sql` 2 MiB; giữ idempotency key cho lần retry; chỉ submit planId/digest khi xác nhận, không gửi lại SQL gốc; hiển thị warnings/unsupported features và ngăn xác nhận plan hết hạn/không hỗ trợ. Warehouse form nhận `importCredentialReference` dạng env reference, không nhập password và không hiển thị giá trị được lưu.
- Kiểm chứng: `npm test -- --reporter=dot` — 104 passed; `npm run test:e2e` — 21 passed với API fixture riêng cho browser tests; `npm run build` PASS; `npm run format:check` PASS; `git diff --check` PASS.
- Còn thiếu / blocker / phụ thuộc: E2E browser ở commit này dùng mock Java, không chứng minh tích hợp hoặc persistence thật. Backend SQL Import đang ở nhánh riêng; backend agent đang sửa mapping sang writer username chuyên dụng. OIDC provider thật và đối chiếu dữ liệu/provenance mọi route vẫn chưa nghiệm thu; `docs/current-review.md` được giữ cho nhánh tích hợp để tránh xung đột giữa module.
- Việc tiếp nối: tích hợp contract/implementation từ backend rồi chạy upload-preview-confirm thật trên PostgreSQL, MySQL và SQL Server; cấu hình OIDC provider và hoàn thiện acceptance UI còn mở.
- Commit/push: entry này đi cùng commit; SHA local/remote được đối chiếu sau push.

### 2026-10-20 20:24 UTC+07 — Hoàn thiện đăng ký pipeline và kiểm chứng luồng FE live / conversation FE
- Nhánh / commit subject: `module/frontend-polish`; `feat: add live registered ingestion workflows`.
- Phạm vi: giao diện quản trị nguồn ingestion đã đăng ký, chọn warehouse/dataset từ registry API thật, đăng ký/chỉnh sửa từng phần/kiểm tra/chạy/xem lịch sử; cấu hình credential reference chỉ ghi; mở rộng review SQL Import theo constraint/index/default/identity và trạng thái rollback; test browser live riêng, test responsive desktop/mobile.
- Trạng thái: VERIFIED cho caller FE với Java và ba warehouse cục bộ trong các luồng SQL Import và ingestion. OIDC provider không thuộc bài test live này (đăng nhập bằng local admin token); không suy rộng kết quả local thành xác nhận provider production. Root xác nhận cả 12 bảng disposable có 24 dòng sau chạy và đã xóa chính xác theo manifest ở cả ba engine.
- Đã làm: thêm registry CRUD có role/loading/empty/error states; form chứa raw, stage, warehouse, mart và typed columns; test endpoint hiển thị target/row metadata; run/history/detail gọi APIs thật. SQL Import review hiển thị đầy đủ schema, table, constraint/index, default/identity và rollback status; namespace đích nhập tường minh. Test live dùng token từ `.local/docker.env`, không ghi token vào log.
- Kiểm chứng: `npm test -- --reporter=dot` — 110 passed; `npm run build` PASS; `npm run format:check` PASS; `npm run test:e2e` — 23 passed; browser live SQL Import trên PostgreSQL/MySQL/SQL Server — 1 passed; browser live ingestion đăng ký/chỉnh sửa/test/run/detail/history trên ba engine — 1 passed; `git diff --check` PASS trước commit. SQL Import disposable tables đã được xóa và kiểm tra còn 0. Ingestion disposable tables cần được kiểm tra row count và dọn bằng manifest bên quản trị sau khi test.
- Còn thiếu / blocker / phụ thuộc: API export OpenAPI/contracts cần cập nhật bởi nhánh tích hợp; verify OIDC thật riêng.
- Việc tiếp nối: tích hợp exporter/API contracts và chạy Compose/OIDC acceptance cuối.
- Commit/push: entry này đi cùng commit; SHA local và remote được đối chiếu sau push.
