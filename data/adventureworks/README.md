# AdventureWorksDW — projection phân tích có provenance

Đây là projection 12 bảng từ dữ liệu mẫu AdventureWorksDW chính thức của Microsoft. Bộ dữ liệu có fact/dimension và dùng để kiểm chứng analytical queries ngoài Chinook. Giữ đầy đủ các dòng của những bảng đã chọn, chỉ lấy các cột được liệt kê trong [source.json](source.json); không tạo giá trị giả và không gọi đây là bản sao đầy đủ của toàn bộ AdventureWorksDW.

## Nguồn đã pin

- Repository: [Microsoft SQL Server samples](https://github.com/microsoft/sql-server-samples).
- Commit tham chiếu của repository: `b47eadc85277f72843647223cde53aa1b85ffcb8`.
- Asset dữ liệu: [AdventureWorksDW data warehouse install script ZIP](https://github.com/microsoft/sql-server-samples/releases/download/adventureworks/AdventureWorksDW-data-warehouse-install-script.zip).
- SHA-256 asset: `73c27309d17cd30bf5351665401106abf649d9f9a9ecb0c770682f6be965aba8`.
- License: [Microsoft SQL Server Sample Code — MIT](LICENSE.md). Giữ notice và attribution khi tái phân phối phần nguồn.

Asset release được xác định bằng URL và checksum riêng; commit repository tham chiếu không thay thế checksum của ZIP. Manifest còn pin checksum từng CSV, vị trí/type/nullability của cột nguồn, PK/FK và số dòng. ZIP, file xuất, secrets và report thực tế nằm trong `.local/` bị Git ignore.

## Phạm vi projection và grain

| Bảng                  | Số dòng nguồn | Grain/khóa                              |
| --------------------- | ------------: | --------------------------------------- |
| DimDate               |         3.652 | DateKey                                 |
| DimSalesTerritory     |            11 | SalesTerritoryKey                       |
| DimGeography          |           655 | GeographyKey                            |
| DimCustomer           |        18.484 | CustomerKey                             |
| DimProductCategory    |             4 | ProductCategoryKey                      |
| DimProductSubcategory |            37 | ProductSubcategoryKey                   |
| DimProduct            |           606 | ProductKey                              |
| DimCurrency           |           105 | CurrencyKey                             |
| DimPromotion          |            16 | PromotionKey                            |
| DimReseller           |           701 | ResellerKey                             |
| FactInternetSales     |        60.398 | SalesOrderNumber + SalesOrderLineNumber |
| FactResellerSales     |        60.855 | SalesOrderNumber + SalesOrderLineNumber |
| **Tổng**              |   **145.524** | Hai fact có grain riêng                 |

Projection bỏ ảnh và các cột tên/liên lạc/địa chỉ của khách hàng; vẫn giữ các khóa và một số thuộc tính phân tích được ghi tường minh trong manifest. `EmployeeKey` là thuộc tính nguồn được giữ trong FactResellerSales, nhưng không project DimEmployee. Không tự gắn quan hệ tới một bảng chưa có.

`OrderDateKey`, `DueDateKey` và `ShipDateKey` đều trỏ DimDate. Chúng là ba vai trò ngày khác nhau; câu hỏi/semantic definitions phải xác định vai trò, compiler không được chọn đại một đường join. Không join hai fact rồi SUM trực tiếp nếu chưa có kế hoạch bảo toàn grain. Giá trị `SalesAmount`/`ListPrice` giữ nguyên số thập phân từ nguồn; chưa có cấu hình nghiệp vụ thì không tự gọi mọi tổng là một doanh thu đã quy đổi tiền tệ.

## Provisioning quản trị đã kiểm chứng

Script [adventureworks.py](../scripts/adventureworks.py) dựng database mới `nla_adventureworks_dw` trên PostgreSQL, MySQL và SQL Server của local Compose. PostgreSQL/SQL Server dùng schema `analytics`; MySQL dùng catalog/schema `nla_adventureworks_dw`. Script port kiểu/quote/DDL và dữ liệu theo engine, tạo PK/FK thật, tạo reader `nla_awdw_reader` chỉ đọc.

Từ repository root, khi database Compose và cấu hình local đã sẵn sàng:

```bash
python3 data/scripts/adventureworks.py download
python3 data/scripts/adventureworks.py provision
python3 data/scripts/adventureworks.py verify
```

Có thể chỉ định một engine bằng `--engine POSTGRESQL`, `--engine MYSQL` hoặc `--engine SQL_SERVER` cho `provision`/`verify`. Không chạy installer upstream bất kỳ qua application hoặc trên database người dùng. Database đã tồn tại nhưng không có marker sở hữu khớp checksum sẽ bị từ chối; không tự drop/reset đối tượng không thuộc script.

Mật khẩu reader được tạo trong `.local/sample-readers.env`, tham chiếu bởi `NLA_SAMPLE_AWDW_PG_PASSWORD`, `NLA_SAMPLE_AWDW_MYSQL_PASSWORD`, `NLA_SAMPLE_AWDW_MSSQL_PASSWORD`; không commit giá trị. Tham chiếu credential phục vụ registry không có nghĩa app được cấp quyền ghi. Reader sample này không có import/pipeline writer tự động.

Report local `.local/adventureworks/provision-report.json` đã ghi PASS trên cả ba engine cho toàn bộ số dòng từng bảng, tổng `SalesAmount`/`OrderQuantity` chính xác của hai fact, join/group theo năm đặt hàng và quốc gia, cùng thử ghi no-op bị reader từ chối. Nguồn được kiểm PK duy nhất/FK closure trước khi nạp, database được dựng PK/FK thật. Oracle độc lập `.local/adventureworks/oracle.json` tính bằng Decimal từ source records. Đây là kiểm chứng quản trị bằng reader thật, không tự là bằng chứng LLM trả lời đúng mọi câu hỏi trên warehouse.

Các tổng nguồn để đối chiếu:

| Phép tính                                   | Giá trị chính xác |
| ------------------------------------------- | ----------------: |
| SUM(FactInternetSales.SalesAmount)          |     29358677.2207 |
| SUM(FactInternetSales.OrderQuantity)        |             60398 |
| SUM(FactResellerSales.SalesAmount)          |     80450596.9823 |
| SUM(FactResellerSales.OrderQuantity)        |            214378 |
| SUM(DimProduct.ListPrice), bỏ NULL theo SQL |       295326.3961 |
| Số NULL của DimProduct.ListPrice            |               211 |

## Chuẩn bị file thật để nghiệm thu trên UI

Script [adventureworks-runtime.py](../../infra/local/adventureworks-runtime.py) chỉ xuất file/oracle offline từ ZIP đã pin. Nó không gọi API, không đăng ký warehouse/dataset, không ghi database và không tự thao tác browser.

```bash
file-service/.venv/bin/python infra/local/adventureworks-runtime.py prepare-files --binary
python3 infra/local/adventureworks-runtime.py prepare-sql
```

`prepare-files` xuất 12 CSV của projection. `--binary` thêm các định dạng để DimProduct có đủ 13 extension được parser hỗ trợ: CSV, TSV, TXT, JSON, JSONL, NDJSON, XLSX, Parquet, Feather, Arrow, IPC, ORC, Avro. Dùng môi trường `file-service/.venv` có dependency tương ứng. Mỗi file giữ đủ 606 dòng/11 cột sản phẩm; FactInternetSales CSV giữ 60.398 dòng/17 cột, khoảng6MiB. Các file đều trong quota file ingestion hiện tại, không phải file mẫu vài dòng được mô tả như toàn nguồn.

Đầu ra ở `.local/adventureworks/ui-files/`: `manifest.json` ghi provenance/hash/count/round-trip, `oracle.json` chứa giá trị độc lập theo khóa/nhóm và null counts. `prepare-sql` xuất ba script native `DimProduct-pg.sql`, `DimProduct-mysql.sql`, `DimProduct-mssql.sql`, mỗi script CREATE + INSERT 606 dòng với bốn cột `productkey`, `productname`, `color`, `listprice`, schema đích `nla_import`. Tên bảng có suffix riêng; `sql-import-manifest.json` ghi đúng tên/hash/oracle. Chạy lại lệnh này tạo suffix mới: không đổi fixture giữa lúc một lần quay UI đang dùng plan/file cũ.

Các script SQL bốn cột là projection dùng kiểm thử SQL Import trong giới hạn2MiB/10.000 INSERT rows; không phải toàn bộ installer Microsoft. File ingestion đầy đủ và SQL Import subset là hai flow khác nhau.

Chuẩn bị file/round-trip/parser offline đã PASS; các kết quả dưới đây là lượt kiểm riêng qua controls thật trên browser có ghi hình, rồi đọc database độc lập. Không dùng API mutation của script chuẩn bị fixture thay thao tác UI.

| Flow ghi hình                                     | Kết quả chức năng đã kiểm chứng                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DimProduct CSV → file ingestion trên cả ba engine | 606 dòng/11 cột ở mỗi lớp RAW/STAGING/WAREHOUSE/MART; toàn bộ cell theo canonical CSV, giá trị thập phân và 211 ô giá thiếu được so độc lập          |
| DimProduct JSON → PostgreSQL                      | 606 dòng/11 cột, cả bốn lớp giữ toàn bộ giá trị nguồn và NULL tường minh, bao gồm các cột STRING nullable                                            |
| FactInternetSales CSV → PostgreSQL                | 60.398 dòng/17 cột ở mỗi lớp, đối chiếu toàn bộ cell và khóa dòng đơn hàng; SUM(SalesAmount)=29358677.2207, SUM(OrderQuantity)=60398                 |
| SQL Import ba script native → ba engine           | Mỗi bảng 606 dòng/4 cột vật lý, toàn bộ khóa/tên/màu/giá khớp nguồn, 211 NULL ListPrice và SUM=295326.3961                                           |
| Transformation pipeline MySQL → PostgreSQL        | DimProduct 606 dòng/11 cột qua bốn lớp; toàn bộ cell nguồn, NULL chuỗi và decimal được giữ đúng                                                      |
| Preview 13 extension của DimProduct               | Mỗi extension được upload/parse bằng UI, nhận đủ 606 dòng/11 cột; preview được discard khi reset. Đây không phải xác nhận đã persist cả 13 định dạng |

CSV không có NULL marker riêng: ô trống xuất từ NULL nguồn trở thành chuỗi rỗng trong RAW; cột STRING typed tiếp tục giữ chuỗi rỗng, cột số/thời gian typed chuyển ô rỗng thành NULL. Vì vậy CSV không được dùng để khẳng định bảo toàn phân biệt NULL–empty string của mọi cột nguồn. Luồng JSON ghi hình và pipeline DB→DB kiểm riêng đã chứng minh giữ NULL chuỗi tường minh. Tổng giá và 211 NULL của cột số `ListPrice` được kiểm trên cả hai flow.

Manifest/run IDs nằm trong `.local/compose-app/readiness-ui-{ingestion,json-ingestion,bulk-ingestion,sql-import,pipeline}.json`; report đọc độc lập ở `.local/compose-app/readiness-browser/{file-ingestion,json-file,bulk-file,sql-import,pipeline}-independent-verification.json`. Video/report thao tác nằm trong các thư mục `file-ingestion`, `file-ingestion-complete`, `file-formats`, `json-ingestion`, `bulk-ingestion`, `sql-import`, `warehouse-pipeline-products` của cùng thư mục local. Kết quả chức năng/data không thay nghiệm thu accessibility, mọi màn hình hoặc pixel accuracy; xem kết quả cuối tại [project status](../../docs/project-status.md) và [work log](../../docs/work-log.md).

Một lượt preview QA cũ để lại bảy staged upload chưa có run và gây hết quota. Chúng được xác minh đúng owner/filename/thời gian, dọn bằng Java DELETE theo ID chính xác đã được cho phép; upload có SUCCESS run được giữ nguyên. Hồ sơ `.local/compose-app/readiness-browser/upload-cleanup.json` tách thao tác dọn QA khỏi bằng chứng nạp nguồn. Không sửa trực tiếp database để giả trạng thái UI thành công.

Provisioning sample không tự tạo registry/semantic model trong app. Database đã dựng đi qua registry/discovery/allowlist; file upload thành công tạo dataset mới với provenance và semantic rỗng, sau đó owner cấu hình definitions qua workbench. Thư mục này phân phối sample có provenance, không phải yêu cầu tạo folder riêng cho mỗi database khách hàng.
