# Plan 03 — Task 13: Thanh toán bằng ví thẻ, giảm giá theo hạng, tự điền từ thẻ

Ngày 2026-11-10. Branch `feature/smartcard`, BASE `de8c548b924e734958ed36ed34e9fbadc25f9d6f`.

## Chức năng

- **Tạo đơn (`createPost`)**: chỉ nhận `tourId`, `locationFrom`, số lượng từ client; tên/giá/ảnh/ngày đi lấy từ Tour. `subTotal`, `discount`, `total` do backend tính; `customerId` lấy từ phiên `customerToken`; Order dựng từ whitelist (không còn `new Order(req.body)`). Giảm theo `Customer.totalSpent`: 0/3/5/8% (Silver ≥ 10tr, Gold ≥ 30tr, Platinum ≥ 80tr). Mỗi item `ticketStatus:'none'`. Giữ chỗ tour nguyên tử (`$gte` + `$inc`), hoàn chỗ khi lỗi. Từ chối số lượng/giá/tổng không hợp lệ, tour trùng/không tồn tại, phương thức lạ, `card` khi chưa đăng nhập, đơn `card` > 50.000.000đ.
- **`POST /card-api/pay/prepare {orderId}` → `{opId, amount}`**: một transaction kiểm đơn thuộc `req.customer`/unpaid/không cancel/method card/chưa xóa, thẻ active hiện hành, `balance ≥ total` (nếu không: "Số dư ví không đủ"). Khóa đơn bằng CAS `cardTxRef:{$exists:false}` rồi tạo CardTransaction debit `source:'order'`; hai prepare song song chỉ tạo một debit. Debit `pending-card` chưa ký được dùng lại (tạo op mới, không tạo tx mới); tx `sent`/`failed`/đã có `signedOpId` bị chặn với "Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ". Không đổi balance khi prepare. Settlement dùng lại `receiptInSession` của Task 4–5 (paid + vé `pending` + `totalSpent` trong một transaction).
- **`GET /order/payment-card`** + `order-payment-card.pug`: mã đơn, tour, tạm tính, giảm giá, tổng, số dư server, nút thanh toán, trạng thái, hướng dẫn khôi phục, nút "Đồng bộ thẻ". Đơn paid → chuyển sang `/order/success`.
- **Giao diện (`card-customer.js`)**: `payFlow` = openSession (sync, khôi phục receipt) → PIN → kiểm số dư chip → prepare → ký/DEBIT/confirm. Mất kết nối sau DEBIT → "Chờ đồng bộ", không prepare lại, tự sync/kiểm paid. Trang tự đồng bộ khi còn giao dịch chưa đối soát. Lỗi SW hiển thị bằng `swMessage` (6F10, 6982…). Bấm nhiều lần bị chặn bằng cờ busy.
- **Tự điền**: giỏ hàng điền sẵn tên/SĐT từ Customer (server); nút "Điền từ thẻ" = openSession(sync:false) → PIN → readProfile, chỉ điền hai ô, không gửi gì lên server.
- **Giỏ hàng** hiển thị hạng và giảm giá (chỉ để xem; server tính lại).
- **Admin `editPatch`** (finding Important của review bảo mật): bỏ các trường tiền/liên kết/giao dịch; đơn `card` không đổi phương thức/trạng thái thanh toán thủ công và không hủy khi còn tx `sent`/đã ký chưa `done`.

## File

Sửa: `config/variable.js`, `controllers/client/order.controller.js`, `routes/client/order.route.js`, `controllers/client/card-api.controller.js`, `routes/client/card-api.route.js`, `validates/client/card.validate.js`, `controllers/client/cart.controller.js`, `controllers/admin/order.controller.js`, `public/assets/js/script.js`, `public/assets/js/card-customer.js`, `public/assets/css/card-customer.css`, `views/client/pages/cart.pug`.
Tạo: `views/client/pages/order-payment-card.pug`, `test/integration/card-pay.test.js` (31 test), `test/card-pay-ui.test.js` (14 test).
Không đổi: `.env`, `package.json`/dependency, hai Gradle UTF-8, `.gitignore` (thay đổi sẵn có của người dùng không đưa vào commit).

## Kết quả kiểm thử (chạy lại sau khi sửa review)

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit + E2E jCardSim (AGENT_URL) | 188 | 0 | 0 |
| Unit không agent | 183 | 0 | 5 |
| Mongo integration (replica set test) | 233 | 0 | 0 |
| Edge headless + Agent sim + Mongo test | 44 | 0 | 0 |

TDD: `card-pay.test.js` chạy RED 28/28 FAIL trước khi cài; sau cài GREEN. Test của finding review (admin edit, hoàn chỗ) viết sau finding.

## Edge + jCardSim thật (44 mục)

Harness tạm (scratchpad, không commit) chạy web thật trên DB test, Agent `--sim`, Edge headless qua CDP: phát hành thẻ thử + ghi hồ sơ; nạp tiền mặt 2.000.000 qua `/admin/card/topup-cash` (Task 10) rồi sync ghi vào chip khi đăng nhập; "Điền từ thẻ" điền đúng tên/SĐT từ chip, không có POST nào; đơn 1.500.000 thanh toán từ trang web (bấm đúp → một modal PIN) → paid, vé `pending`, `totalSpent` 1.500.000, **server = chip = 500.000**, một debit `done`; Gold 5%: 2.000.000 → giảm 100.000, tổng 1.900.000, số dư không đủ bị từ chối, chip không đổi; đơn khách khác: prepare 403, trang về `/`; sửa `amount` → 400; nạp thêm 1.500.000; **mất mạng sau DEBIT**: chip 100.000, server chưa paid, tx `sent`, prepare lại bị chặn, tải lại → tự GET_RECEIPT → paid một lần, `totalSpent` 31.900.000, **server = chip = 100.000**, vé sau đó được sync ghi `written`; thẻ locked → 401. Không lỗi JS.

## Hồi quy ZaloPay/VNPay

Integration xác nhận tạo đơn zalopay/vnpay/bank/momo/money cho khách đăng nhập và vãng lai, và 15 test settlement Task 4 vẫn PASS. Cổng sandbox thật: NOT_RUN.

## Review

- Spec: **PASS** (lần 1).
- Security: **Approved**; 1 Important (admin sửa đơn thẻ đang chờ receipt) đã sửa + test.
- Quality: **Approved**; 1 Important (thiếu test hoàn chỗ) đã sửa; Minor khóa nút khi `unresolved`/`PAY_PENDING_SYNC` đã sửa.
- Không còn Critical/Important mở.

## Giới hạn / tồn đọng

- Đơn có `customerId` (kể cả ZaloPay/VNPay của khách đăng nhập) chỉ settle được trên MongoDB replica set (Task 4); standalone fail-closed, khách có thể đã trả tiền ở cổng nhưng đơn chưa paid. Production phải chạy replica set.
- Tx `sent`/`failed` có `signedOpId` mà không có receipt (APDU chưa tới chip, thẻ trả 6F10/6982…) khóa ký thẻ đến khi đối soát thủ công (quy tắc Task 5); Task 13 giảm khả năng bằng việc kiểm số dư chip trước prepare. Chưa có công cụ admin void.
- Đơn unpaid giữ chỗ tour vô thời hạn (có từ trước); chưa có TTL/hoàn kho.
- Trang success vẫn xác thực bằng orderId + phone trong URL (cơ chế cũ).
- Prepare cho đơn B khi thẻ đang có tx `sent` của đơn A chỉ bị chặn ở bước ký.
- Integration dùng chung một DB test: không chạy song song hai tiến trình.
- jCardSim không chứng minh an toàn phần cứng; thẻ thật, Cloudinary, SMTP, gateway sandbox: NOT_RUN. Node chạy 24.21.0; Node 26 chưa kiểm.
- Môi trường dựng lại trong phiên này: `npm install --legacy-peer-deps` (không đổi package.json), MongoDB replica set bằng Docker `mongo:7` (cổng 27018), build agent `installDist`.
