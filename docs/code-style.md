# Quy tắc định dạng code

Code trong repository phải trình bày rõ ràng để người khác có thể đọc, review và sửa tiếp. Mỗi lệnh, khai báo hoặc import đặt trên dòng riêng; tránh viết nhiều lệnh Java/Python cạnh nhau bằng dấu chấm phẩy hoặc nén cả file/module vào một dòng. Không dùng minified source trong application, tests hay data scripts.

## Java

Dùng Google Java Format cho `backend/src`:

```sh
google-java-format --replace $(find backend/src -name '*.java' -type f)
```

## Python

Dùng Black và isort với giới hạn 100 ký tự. Các formatter là công cụ phát triển, không phải runtime dependency:

```sh
python -m isort --profile black --line-length 100 ai-service data/scripts
python -m black --line-length 100 ai-service data/scripts
```

## TypeScript, React và CSS

Dùng Prettier trong `frontend`:

```sh
cd frontend
npm run format
npm run format:check
```

Sau khi format, chạy test/build liên quan và `git diff --check`. Không để thay đổi formatter làm che khuất thay đổi hành vi trong cùng một diff nếu có thể tách commit.
