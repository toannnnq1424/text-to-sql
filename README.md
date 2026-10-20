# Natural Language Analytics Warehouse

Nền tảng Text-to-SQL đa warehouse, đa domain: đặt câu hỏi bằng tiếng Việt/Anh, nhận dữ liệu, biểu đồ, SQL, giải thích và thông tin thực thi.

Repository có frontend React, backend Spring Boot, Python AI service, SQL Import có validate/preview, registry ingestion bốn lớp và thực thi PostgreSQL, MySQL, SQL Server. Đăng nhập OIDC local dùng IdP thật; Docker Compose đóng gói frontend, Java, AI planner, native data executor và file parser. Các luồng đã kiểm chứng và phần còn thiếu nằm trong [đánh giá hiện tại](docs/project-status.md), [current review](docs/current-review.md) và [work log](docs/work-log.md). Chưa nghiệm thu toàn bộ target hoặc AI provider thật. Import chỉ xử lý subset SQL đã kiểm soát; app không chạy tùy ý file SQL.

```text
React → Java Spring Boot → Python AI Service / provider API
                ↓
   PostgreSQL / MySQL / SQL Server adapters
                ↓
     Registered read-only warehouses
```

React chỉ gọi Java. Java xác thực người dùng, kiểm tra SQL trước khi giao executor đọc warehouse. Python sinh candidate rồi gọi SDK semantic từ source đã đưa vào repo để lập kế hoạch/rewrite và trả lineage; Java kiểm tra lại SQL sau rewrite. Dịch vụ đọc file nhận upload riêng, không nhận credential hay truy cập warehouse.

## Nạp file từ giao diện

Mở **Nạp dữ liệu → Nạp file**, chọn CSV/TSV/TXT, XLSX, JSON/JSONL/NDJSON, Parquet, Arrow/Feather/IPC, ORC hoặc Avro. App đọc toàn bộ file, tự nhận diện header/cột/kiểu dữ liệu, cho xem trước20 dòng và chỉnh mapping. Chọn warehouse cùng namespace được tài khoản import cấp quyền CREATE, đặt tên bảng/dataset rồi **Kiểm tra và tạo kế hoạch → Xác nhận và nạp dữ liệu**. Không phải nhập từng cột hoặc từng INSERT; các bản ghi được nạp theo batch qua bốn lớp và mart được đăng ký thành Dataset trong Catalog.

Giới hạn mỗi file25MiB/100.000 dòng/200 cột; Excel chọn được sheet, công thức cần chuyển thành giá trị. `.sql` dùng màn **SQL Import** có parser/preview riêng. Cần role ADMIN/OPERATOR và import writer trên warehouse; namespace được API phát hiện từ quyền thật, không mặc định một database mẫu. Dữ liệu query/metadata đến từ database; ngữ nghĩa nghiệp vụ và provider vẫn phải được cấu hình phù hợp. Chi tiết [file ingestion](docs/contracts/file-ingestion.md).

Cách chạy đầy đủ các dịch vụ riêng tư cùng database/đăng nhập là `python3 infra/local/compose.py up`, rồi mở [ứng dụng local](http://127.0.0.1:4173). Clone mới tự tạo secret local; không cần file token của maintainer. [Các thành phần thực sự tái sử dụng](docs/platform-reuse.md) có source hashes và license đi kèm.

Hai bộ source trong Downloads đã được đưa vào [vendor/upstream](vendor/upstream/README.md), tổng 417.117 dòng code theo inventory. SDK semantic được fork với planner theo dataset, kiểm tra lineage sau rewrite và chế độ chỉ lập kế hoạch; app cài trực tiếp source fork này; native executor gọi trực tiếp source factories của ba engine. Bảng caller, phần chưa kích hoạt và kiểm chứng ở [full source adoption](docs/integrations/full-source-adoption.md). Số dòng đã nhập không phải số tính năng đã nghiệm thu.

Hướng dẫn chọn file/nguồn database và đăng ký nguồn trong ba bước: [Nạp dữ liệu](docs/ingestion-guide.md).

## Hướng dẫn khởi chạy (Quick Start)

### Yêu cầu

- Docker Desktop hoặc Docker Engine + Compose plugin.
- Java 21, Maven 3.9+, Python 3.11+, Node.js 22.12+ và npm.
- Khoảng 5 GB RAM còn trống cho ba database; SQL Server container hiện dùng image `linux/amd64`.

### 1. Tạo và khởi động database Chinook

Từ thư mục gốc repository:

```bash
python3 data/scripts/docker_chinook.py init
python3 data/scripts/docker_chinook.py up
python3 data/scripts/docker_chinook.py status
python3 data/scripts/docker_chinook.py provision
```

Mỗi bản clone tự tạo credential ngẫu nhiên, riêng tư khi chạy `init`; không cần xin hoặc lấy token từ maintainer. `.local/compose.env` chứa credential Compose và local API token; sau `provision`, `.local/docker.env` chứa cấu hình runtime cho backend/frontend. Cả thư mục `.local/` đã được Git ignore. Admin token chỉ dùng cho thao tác quản trị trong môi trường local; người dùng có thể đăng nhập bằng token vừa tạo từ banner đăng nhập hoặc Settings.

Compose file nằm tại [`infra/compose.databases.yml`](infra/compose.databases.yml), không phải ở thư mục gốc. Dùng script ở trên là cách khởi chạy khuyến nghị vì script tự truyền file env riêng tư. Nếu cần gọi Compose trực tiếp sau `init`, lệnh tương đương là:

```bash
docker compose --env-file .local/compose.env -f infra/compose.databases.yml up -d
```

`provision` tải đúng release Chinook đã pin, xác minh SHA-256 rồi mới nạp script native vào ba database cô lập. Database tên `nla_chinook`; thông tin quản trị và runtime được tạo riêng trong `.local/`, không commit lên Git. Các port chỉ bind loopback: PostgreSQL `127.0.0.1:55432`, MySQL `127.0.0.1:53306`, SQL Server `127.0.0.1:51433`. Dữ liệu Chinook có 11 bảng; provisioning xác minh số dòng và tài khoản đọc không thể ghi.

Provisioning đồng thời tạo metadata store PostgreSQL `nla_metadata` cùng vai trò runtime; pipeline staging/mart được quản trị trong từng engine. Các giá trị đăng nhập không dùng giá trị mẫu cố định như `postgrespassword`; xem file runtime cục bộ nếu cần tích hợp công cụ ngoài repo và không chia sẻ file đó.

Sau khi các database hiện có đã provision, chạy `python3 data/scripts/docker_chinook.py provision-import` để tạo namespace `nla_import` và tài khoản riêng cho SQL Import. Lệnh này không đọc hoặc thực thi file SQL; nó kiểm tra quyền tạo/ghi trong namespace import và từ chối quyền tạo object trong schema/database nguồn Chinook.

Lệnh `up` có thể dùng lại để khởi động lại các container đã provision. Để dừng container mà giữ dữ liệu:

```bash
docker compose --env-file .local/compose.env -f infra/compose.databases.yml stop
```

Không dùng `down -v` nếu muốn giữ database volumes.

### 2. Khởi chạy Python AI service

```bash
python3 -m venv ai-service/.venv
python3 infra/upstream/install_ai.py
python3 infra/local/run.py ai
```

AI service chạy tại `http://127.0.0.1:8000`. Deterministic mode dùng được ngay cho ví dụ semantic đã đăng ký; muốn dùng model API cần cấu hình provider URL/model/key trong môi trường local. Key không đưa vào Git hoặc log.

File cấu hình provider riêng là `.local/compose-app/provider.env`, dùng chung cho Docker và lệnh `infra/local/run.py`. Khi đã có key, sao chép mẫu [infra/provider.env.example](infra/provider.env.example) vào đường dẫn đó nếu chưa có file, rồi điền `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. Có thể để cả ba trống trong lúc chưa dùng provider. Để chạy model local qua Ollama, xem [cấu hình model local/API](docs/llm-provider.md); source Engine không chứa toàn bộ Wren AI Service. Không đặt key vào `VITE_*`, source code hoặc chat.

Với Docker, chạy lại `python3 infra/local/compose.py up` sau khi đổi file; xem [hướng dẫn Compose](docs/docker-local.md). Với cách chạy trực tiếp, khởi động lại AI và backend bằng các lệnh Quick Start. Launcher chỉ chuyển provider key cho Python; backend nhận tên model để hiển thị, frontend không nhận key. Chưa cấu hình provider thì chọn `DETERMINISTIC` tường minh; chế độ này chỉ khớp semantic examples đã đăng ký, không phải model đã train local.

### 3. Khởi chạy Backend (Spring Boot)

Trong terminal riêng:

```bash
python3 infra/local/run.py backend
```

Lệnh này chạy Maven/Spring Boot với Java 21 và nạp cấu hình `.local/docker.env` vào tiến trình mà không in secrets. Backend chạy ở `http://localhost:8080`; API chính là `POST http://localhost:8080/api/v1/query`. Local profile cung cấp quyền đọc ẩn danh cho demo; thao tác quản trị cần local API token được tạo riêng trên máy đó ở bước `init`, có thể nhập trong banner đăng nhập hoặc Settings của UI.

### 4. Khởi chạy Frontend

```bash
cd frontend
npm ci
cd ..
python3 infra/local/run.py frontend
```

Frontend chạy tại `http://localhost:5173`. Chọn một trong ba warehouse đã đăng ký; ví dụ câu hỏi `How many tracks are in the catalog?` trả về 3.503 track từ Chinook.

### 5. Chạy với đăng nhập OIDC thật

Chế độ local ở các bước trên dùng token quản trị riêng cho máy. Để kiểm thử luồng đăng nhập/đăng xuất qua IdP, tạo Keycloak trên Docker rồi chạy lại backend/frontend với cấu hình OIDC:

```bash
python3 infra/local/oidc.py init
python3 infra/local/oidc.py up
python3 infra/local/oidc.py check
```

Trong hai terminal riêng, sau khi dừng backend/frontend đang chiếm port tương ứng:

```bash
python3 infra/local/run.py backend --auth oidc
python3 infra/local/run.py frontend --auth oidc
```

Mở `http://127.0.0.1:5173` và chọn **Đăng nhập**. Tài khoản và mật khẩu được sinh ngẫu nhiên theo bản clone trong `.local/oidc/accounts.json` (chỉ đọc file trên máy của bạn, không commit/chia sẻ). Tài khoản `nla-admin` có quyền quản trị; `nla-viewer`, `nla-analyst`, `nla-operator` cần resource grant phù hợp trước khi truy cập dataset. Ứng dụng không lưu mật khẩu; đăng nhập dùng authorization code + PKCE qua public client của Keycloak tại `http://127.0.0.1:8180`.

Hướng dẫn cấu hình, giới hạn deployment và kiểm thử thật có trong [OIDC local](docs/oidc-local.md). Kiểm thử không làm gián đoạn app đang chạy có thể dùng backend `8083`, frontend `5175`:

```bash
python3 infra/local/run.py backend --auth oidc --port 8083
python3 infra/local/run.py frontend --auth oidc --port 5175 --api-url http://127.0.0.1:8083
node infra/local/oidc-browser.mjs
```

Mỗi lệnh chạy service ở terminal riêng; lệnh browser chạy sau khi cả hai đã sẵn sàng. Test dùng Keycloak, React và Java thật; report an toàn ở `.local/oidc-browser-report.json`, không lưu password/token hoặc trace đăng nhập.

### Chạy cả ứng dụng bằng Docker Compose

Lệnh dưới đây thực hiện provisioning Chinook đã pin, khởi động IdP, sinh secret riêng cho app, build ba app images và đăng ký kết nối qua Java API:

```bash
python3 infra/local/compose.py up
python3 infra/local/compose.py status
```

Mở `http://127.0.0.1:4173`, đăng nhập `nla-admin` với mật khẩu riêng trong `.local/oidc/accounts.json`. API Java được bind loopback `http://127.0.0.1:8085/api/v1`; Python chỉ có trong mạng container. Compose dùng metadata database riêng `nla_metadata_compose`, giữ nguyên registry của app host. Các endpoint warehouse được đăng ký bằng hostname/service port Compose, không sửa `localhost` trong code truy vấn.

Build đầu cần tải base images và dependencies. Cần Docker Compose có hỗ trợ `env_file.format: raw` (v2.30+), Python 3.11+ cho script provisioning, cùng tài nguyên cho ba database và bốn app/IdP services. Hướng dẫn provider API, mạng, credential isolation, kiểm thử và dừng service ở [Docker deployment local](docs/docker-local.md). Nếu chưa cấu hình provider, app dùng `DETERMINISTIC` với semantic examples đã đăng ký; đây không phải bằng chứng model AI API thật.

## Dữ liệu và nguồn

Chinook là bộ dữ liệu kiểm chứng tích hợp đầu tiên, không được mô tả như star-schema warehouse. Nguồn, release, commit, license, checksum, schema counts và quy trình tái tạo được ghi tại [data/chinook](data/chinook/README.md) và [data-sources](docs/data-sources.md). Các nguồn còn lại do người dùng cung cấp (AdventureWorksDW, TPC-DS, Pagila, Northwind PostgreSQL, Olist) vẫn được ghi trong danh mục; chúng chưa được nạp vào runtime này.

## Quy tắc làm việc và conversation mới

Đọc [AGENTS.md](AGENTS.md), [implementation rules](docs/implementation-rules.md), [scope](docs/scope.md), [architecture](docs/architecture.md), contract liên quan và hướng dẫn role tương ứng trước khi nhận task. FE đọc [fe.md](docs/roles/fe.md), backend đọc [be.md](docs/roles/be.md), Python/data đọc [ai-data.md](docs/roles/ai-data.md). Các prompt nguồn được lưu trong [docs/prompts](docs/prompts/README.md).

Các quy tắc chính: chốt chung `Warehouse`, `Dataset`, `Query` và Java ↔ Python contract; cả ba engine là target bắt buộc; code hoàn chỉnh trong phần đã nhận, gồm validation, lỗi, security và tests; không chia version, để placeholder hoặc gọi mock/stub là tính năng hoàn thành. UI theo style 14 ảnh tham chiếu, còn dữ liệu hiển thị phải lấy từ API thật và có empty/error states.

Sau mỗi commit/push, cập nhật [work log](docs/work-log.md) để người tiếp nối biết conversation/role, phạm vi, trạng thái, checks và việc còn lại. Không commit `.local/`, credentials, key, hay database dump.

## Kiểm tra

```bash
cd frontend && npm test && npm run build
cd ../backend && mvn test
cd .. && ai-service/.venv/bin/python -m pytest ai-service
```

Test adapter bằng database Docker thật đã cấu hình local:

```bash
python3 infra/local/test_backend.py
python3 infra/local/smoke.py
npm exec --prefix frontend -- playwright test --config frontend/playwright.live.config.ts
```

Các test tích hợp cần Docker và database provisioned; test browser live cần cả ba app services đang chạy.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Scope](docs/scope.md) | Yêu cầu hiệu lực và xử lý mâu thuẫn prompt |
| [Implementation rules](docs/implementation-rules.md) | Không chia version, skeleton hoặc trì hoãn phần bắt buộc |
| [Architecture](docs/architecture.md) | Ranh giới, module, ownership |
| [Contracts](docs/contracts/README.md) | Domain, API, errors, Java ↔ Python, semantic model |
| [UI reference](docs/ui-reference.md) | 14 ảnh, routes và tiêu chí thị giác |
| [Data sources](docs/data-sources.md) | Nguồn do người dùng cung cấp và cách sử dụng |
| [Platform reuse](docs/platform-reuse.md) | Khảo sát hai bộ nguồn, phần ưu tiên tái sử dụng, ranh giới bảo mật và provenance |
| [Future connectors](docs/future-connectors.md) | SQL engines, cloud/object storage và file sources theo định hướng mở rộng |
| [Security](docs/security.md) | SQL, credential, auth, giới hạn thực thi |
| [OIDC local](docs/oidc-local.md) | Keycloak, login/logout thật, roles/audience và kiểm thử browser |
| [Acceptance](docs/acceptance.md) | Bằng chứng kiểm chứng |
| [Current review gaps](docs/current-review.md) | Login, import, UI, source dữ liệu và acceptance đang mở |
| [Future extensions](docs/future-extensions.md) | Local AI/training và nâng quy mô ngoài scope hiện tại |
| [Work log](docs/work-log.md) | Nhật ký commit/push và handoff |

Ảnh gốc được phép đưa lên GitHub lưu tại [images](images/README.md). Mã nguồn tự viết của repository chưa chọn giấy phép phát hành; license của dataset và thành phần bên thứ ba được quản lý riêng. Hai bộ nguồn mới đã khảo sát chưa được tích hợp vào runtime; không lấy danh sách connector của chúng làm claim hỗ trợ hiện tại.
