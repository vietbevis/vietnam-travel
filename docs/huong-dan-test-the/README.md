# Hướng dẫn test tay thẻ thông minh (Vietnam Travel)

Web test: `http://localhost:3002`. Bắt đầu từ [00-tong-quan.md](00-tong-quan.md). Slot: 0 NV, 1 khách A, 2 thẻ cấp lại, 3 khách B.

| File | Chức năng | Ai thực hiện | Phụ thuộc |
|---|---|---|---|
| [00-tong-quan.md](00-tong-quan.md) | Kiến trúc, trạng thái, môi trường | Tất cả | Không |
| [01](01-phat-hanh-the-nhan-vien.md) | Phát hành thẻ nhân viên | Admin | 00 |
| [02](02-dang-nhap-admin-bang-the.md) | Đăng nhập admin bằng thẻ, đổi PIN lần đầu (kiểm ngày sinh) | Nhân viên | 01 |
| [03](03-phat-hanh-the-khach-hang.md) | Phát hành thẻ khách (có sẵn/mới) | Admin | 00 (nên 01, 02) |
| [04](04-khach-dang-nhap-bang-the.md) | Khách đăng nhập bằng thẻ | Khách | 03 |
| [05](05-trang-the-cua-toi.md) | Thẻ của tôi: đọc, đổi PIN, ghi thông tin | Khách | 04 |
| [06](06-nap-tien-mat-tai-quay.md) | Nạp tiền mặt (step-up) | Nhân viên | 02, 03 |
| [07](07-nap-online-vnpay-zalopay.md) | Nạp online | Khách | 04, 05 (cần cổng) |
| [08](08-dat-tour-thanh-toan-vi-the.md) | Đặt tour, trả ví, hạng | Khách | 04, 06 |
| [09](09-ghi-ve-len-the-dong-bo.md) | Ghi vé, đồng bộ | Khách/Admin | 08 |
| [10](10-check-in-tour.md) | Check-in | Nhân viên | 09 |
| [11](11-huy-don-xoa-ve.md) | Hủy đơn ví thẻ, hoàn tiền, xóa vé | Admin/Khách | 08, 09 |
| [12](12-khach-bao-mat-the-otp.md) | Báo mất, khóa qua OTP | Khách | 03 |
| [13](13-khoa-mo-khoa-thu-hoi-the.md) | Khóa, mở khóa, thu hồi | Admin | 03 (thu hồi: 02) |
| [14](14-cap-lai-the.md) | Cấp lại thẻ | Admin | 06, 09, 13 |
| [15](15-sai-pin-khoa-pin-reset-pin.md) | Sai PIN, khóa PIN, reset PIN | Khách/Admin | 03 |
| [16](16-dong-bo-doi-soat-bien-nhan.md) | Đối soát, biên nhận | Tất cả | 06, 08 |
| [17](17-danh-sach-chi-tiet-the.md) | Danh sách, chi tiết thẻ | Admin | 03 |
| [18](18-nhat-ky-the.md) | Nhật ký thẻ | Admin | các thao tác trước |
| [19](19-thong-ke-dashboard.md) | Thống kê dashboard | Admin | 03 |
| [20](20-quan-ly-khach-hang.md) | Quản lý khách hàng | Admin | 03 |
| [21](21-sua-ho-so-anh-tren-the.md) | Sửa hồ sơ/ảnh trên thẻ | Admin | 03 |
| [22](22-dang-xuat-phien-the.md) | Đăng xuất | Khách/Admin | 02, 04 |
| [90](90-kich-ban-end-to-end.md) | Kịch bản end-to-end | Tất cả | 01 đến 22 |
| [91](91-bang-ma-loi.md) | Bảng mã lỗi (admin nay hiển thị tiếng Việt) | Tra cứu | Không |
| [92](92-han-che-va-xu-ly-su-co.md) | Hạn chế, sự cố, script khôi phục admin | Tra cứu | Không |
