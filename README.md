# VIP License Portal V4

Bộ source này là một **license / trial portal hợp pháp** gồm:

- App giao diện chính: `public/index.html`
- Portal nhận key riêng: `public/free-key.html`
- Admin console riêng: `public/admin.html`
- API backend: `server.js`
- Telegram bot admin: `/login`, `/taokey`, `/quanlithietbi`, `/xemkey`, `/khoakey`, `/mokey`, `/thongbao`

## Luồng hoạt động

1. App gọi `POST /api/free-link/create` để tạo short-link cho thiết bị hiện tại.
2. Người dùng hoàn tất trang trung gian.
3. Link trung gian redirect về `GET /verify`.
4. Server đánh dấu phiên đã xác thực và chuyển sang `free-key.html`.
5. `free-key.html` gọi `POST /api/free-key/claim` để nhận key random có hạn 5 giờ.
6. App đăng nhập qua `POST /api/auth/login`.
7. Admin quản lý key, thiết bị và thông báo ở `admin.html`.
8. Telegram bot dùng các lệnh quản trị sau khi đã `/login`.

## Chạy local

```bash
npm install
npm start
```

Mở:
- App: `http://localhost:3000/index.html`
- Free key portal: `http://localhost:3000/free-key.html`
- Admin: `http://localhost:3000/admin.html`

## Render

1. Push repo lên GitHub
2. Tạo Web Service trên Render
3. Dùng `npm install` và `npm start`
4. Thêm biến môi trường theo `.env.example`

## Lưu ý

- Nếu không cấu hình `LINK4M_API_TOKEN`, hệ thống vẫn chạy được bằng link verify trực tiếp để test.
- Đổi toàn bộ thông tin admin mặc định trước khi deploy thật.
- Dữ liệu được lưu tại `data/db.json`.
