# Kế hoạch audit cuối ví thẻ

> Thực hiện bằng Superpowers systematic-debugging, test-driven-development và executing-plans; review độc lập cuối bằng requesting-code-review.

**Mục tiêu:** xác nhận và sửa ba lỗi tồn kho, ghi nhận thanh toán thẻ và callback nạp muộn.
**Đặc tả:** `../specs/2026-11-04-travel-smartcard-design.md`, mục 5.4, 6.3, 7.
**Kiến trúc:** dùng MongoDB transaction và cập nhật có điều kiện; receipt vẫn là căn cứ duy nhất để settlement ví thẻ. Tiền cổng đã nhận nhưng không thể ghi ví phải có trạng thái đối soát bền vững, idempotent.

## Ràng buộc

- Làm ngay trên nhánh người dùng đã tạo `fix/smartcard-final-review`; không tạo worktree/nhánh khác, không merge/push.
- Không sửa `.env`, khóa, dữ liệu website, dependency hoặc Gradle. Chỉ dùng Mongo loopback với database `vietnam-travel-smartcard-test`, trong dbpath mới dành riêng lượt này.
- Không thêm npm dependency; dùng `node:test`. PIN/bí mật không xuất hiện trong log.
- Ví tối đa 50 000 000; credit pending-card/sent cùng chiếm hạn mức. Receipt cần chữ ký, cardId, txRef, amount, counter và balance khớp.
- Một commit riêng sau khi hoàn tất và review; đây là chỉ dẫn người dùng thay cho commit theo từng bước của skill.

## Task 1: Tồn kho

- [x] Thêm regression integration: đặt đồng thời chỗ cuối; item trùng tour; tour sau hết chỗ; lưu Order lỗi phải hoàn toàn rollback.
- [x] Chạy RED với code cũ, ghi bằng chứng.
- [x] Sửa `controllers/client/order.controller.js:createPost`: transaction bao trùm reserve có điều kiện `$gte` + `$inc` và save order; xác thực toàn bộ trước ghi.
- [x] Chạy GREEN; thêm giá trị tổng số lượng/trị giá an toàn nếu phát hiện cần thiết.

## Task 2: Settlement thẻ

- [x] Thêm regression admin đánh paid khi chưa debit, đổi phương thức sang card, và gọi helper trực tiếp thiếu receipt.
- [x] Chạy RED.
- [x] Sửa `controllers/admin/order.controller.js`, `helpers/order-payment.helper.js` và caller engine nếu cần: admin không được xác nhận ví; helper card chỉ settlement trong transaction với debit done/receipt liên kết chính xác.
- [x] Chạy GREEN, giữ đường receipt hợp lệ và thanh toán tiền mặt/chuyển khoản hoạt động.

## Task 3: Callback muộn

- [x] Xác nhận race/cap/lifecycle từ code và test: callback hết hạn sau khoản nạp khác; nhiều callback cạnh tranh; thẻ locked/revoked/replaced; cổng báo fail rồi success.
- [x] Chạy RED.
- [x] Sửa helper/model/controller: lock Card chung trong transaction, kiểm lại tổng nghĩa vụ; khoản không thể ghi ví lưu bền vững chờ đối soát, không tự credit hoặc mất dấu tiền; callback lặp idempotent.
- [x] Chạy GREEN.

## Task 4: Kiểm chứng và bàn giao

- [x] Chạy toàn bộ unit, Mongo integration, E2E jCardSim và Java applet/agent nếu môi trường cho phép, ghi rõ skip/failure.
- [x] Review độc lập Spec/Quality/Security, xác minh từng finding, sửa lỗi có bằng chứng và kiểm tra lại.
- [x] Cập nhật HANDOFF/báo cáo tiếng Việt, kiểm diff bảo vệ file cấm, commit riêng và dừng.

## Nhật ký quyết định

- Baseline: `ae0230b0aaa7fba7f744af17321d2e16a4b6aefb`, đúng nhánh, working tree ban đầu sạch.
- Không dừng chờ duyệt kế hoạch: người dùng đã yêu cầu thực hiện toàn bộ, regression RED → GREEN và review cuối.
- Review focus: request đồng thời, rollback đa tour, receipt thiếu/sai liên kết, callback sau expiry/lifecycle, idempotency tiền cần đối soát.
