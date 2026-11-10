# Plan 03 — Task 4: Tách helper thanh toán và markOrderPaid

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`.
BASE `e269d28ecb839ca819b62e08c561240ac881c7d5`.

## Phạm vi và giao thức

Tạo `helpers/zalopay.helper.js`, `helpers/vnpay.helper.js`, `helpers/order-payment.helper.js`, `test/payment-helper.test.js`, `test/integration/order-payment.test.js`. Chỉ refactor bốn hàm thanh toán và imports trong `controllers/client/order.controller.js`; không thay createPost/success hay các hình thức thanh toán khác.

Giữ các interface của Task 4. ZaloPay dùng HMAC-SHA256 với key1 cho request và key2 trên nguyên văn callback `data`; app_trans_id và app_user giữ hình dạng cũ. VNPay giữ sort/percent encoding/space-plus, HMAC-SHA512, số tiền nhân 100 và TxnRef orderId-timestamp. Thành công VNPay cần cả ResponseCode và TransactionStatus bằng `00`, theo yêu cầu người dùng cao hơn mô tả rút gọn trong plan.

Callback được kiểm chữ ký trước khi tin dữ liệu và đối chiếu app/merchant, mã giao dịch/định danh, số tiền, phương thức, đơn chưa xóa/chưa hủy. Không lấy tham số query chưa ký để chuyển thanh toán sang đơn khác. Không log MAC, khóa hoặc payload nhạy cảm.

Theo [tài liệu callback ZaloPay](https://docs.zalopay.vn/docs/developer-tools/knowledge-base/callback/), callback order được gửi khi giao dịch thành công; payload order chuẩn không có trường status bắt buộc. Không tự thêm điều kiện giả làm hỏng callback chuẩn.

## Atomic và idempotent

- Đơn cũ không có customerId: CAS single-document từ unpaid sang paid, hoạt động trên MongoDB standalone hiện tại; giữ nguyên trạng thái item cũ.
- Đơn có customerId: chuyển paid, cộng Customer.totalSpent và đổi ticketStatus none/thiếu sang pending trong cùng transaction. Callback lặp hoặc cạnh tranh không cộng chi tiêu hai lần.
- Hạng được tính từ totalSpent bằng helper Task 3; không thêm cột hạng hoặc schema mới.
- MongoDB standalone **không hỗ trợ** transaction nhiều document; nhánh customer-linked phải fail closed, không để Order paid riêng rồi bỏ dở Customer. Trước khi bật luồng khách liên kết trên môi trường thật cần MongoDB replica set/sharded cluster. Đây là điều kiện vận hành mới được ghi rõ, không tự thay cấu hình DB website. [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/).

## Database test và môi trường

- MongoDB đang có ở 27017 giữ nguyên, database test `vietnam-travel-smartcard-test`; không sửa/reset database dev hoặc production.
- Khởi chạy MongoDB binary có sẵn thành replica set test một node `travelTask4`, bind loopback cổng 27018, dbpath trong `.superpowers/sdd/2026-11-04-smartcard-03-web/task-4-mongo-rs/`. Không cài dependency hoặc đổi service MongoDB.
- URI integration transaction: `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, vẫn qua guard Task 3. Không thêm query/override để né guard.
- Sau kiểm thử đã dừng riêng tiến trình replica set test 27018 do phiên này khởi chạy, giữ nguyên dữ liệu test trong workspace ignored. Không dừng service MongoDB website ở 27017.
- Đổi duy nhất script `test:integration` thêm `--test-concurrency=1`: hai file integration cùng reset DB test nên phải chạy tuần tự. Không đổi dependencies/lockfile.
- Node thực tế 25.9.0; Node 26 runtime NOT_RUN, xem giới hạn trong báo cáo Task 2–3.

## Kiểm thử

TDD đã quan sát RED trước implementation: 10 unit và 5 integration thất bại vì thiếu helper; ba test controller thất bại ở kiểm amount/method/cancel. Khi phát hiện interface appUser bị bó hẹp và mô tả tiếng Việt bị mất dấu, mỗi lỗi có một test RED riêng trước khi sửa. Sau sửa, 12 unit mới PASS.

| Nhóm kiểm thử | PASS | FAIL | SKIP | Phạm vi bằng chứng |
|---|---:|---:|---:|---|
| Unit Task 1–4 | 77 | 0 | 0 | `npm.cmd test`, gồm 12 unit Task 4 |
| E2E Task 2 | 5 | 0 | 0 | Card Agent/jCardSim thật tại 31999, reset slot từng bài |
| Full integration Mongo replica set | 23 | 0 | 0 | 8 Task 3 + 15 Task 4, gồm TTL thật; chạy tuần tự |
| Integration thanh toán, snapshot cuối trên replica set | 15 | 0 | 0 | Chạy lại sau sửa Unicode/interface, commit/rollback/concurrency thật |
| Integration thanh toán trên standalone | 15 | 0 | 0 | Legacy hoạt động; linked assert fail closed và dữ liệu không đổi |
| Integration khi thiếu TEST_DATABASE | 0 | 0 | 23 | Không kết nối/xóa DB |

Hai lần integration tập trung là kiểm lại cùng 15 bài, không cộng thành số test duy nhất. Full integration chạy trước hai sửa cuối về Unicode/interface; bộ thanh toán đã được chạy lại ở snapshot cuối, phần Task 3 không thay đổi. Lệnh full suite có agent đạt **82 PASS / 0 FAIL / 0 SKIP**. Log RED/GREEN nằm trong workspace ignored của Superpowers.

Integration thanh toán kiểm CAS lặp/đồng thời, callback lặp, sai phone/amount/merchant/reference/method/status, đơn hủy/xóa, legacy không customerId, khách thiếu/xóa, overflow, hai đơn cùng khách và rollback sau khi Order đã được cập nhật trong transaction. Vé none/thiếu sang pending chỉ cho đơn liên kết; giữ written/used và trường item cũ. Hạng được kiểm theo totalSpent sau settlement.

MongoDB test đi qua guard Task 3: chỉ loopback và tên `vietnam-travel-smartcard-test`; thiếu cấu hình thì SKIP, cấu hình không an toàn bị từ chối. Suite Task 3 kiểm cả thay env sau connect và collection native trước reset. Không sửa guard hoặc dùng override. Không kết nối/reset DB phát triển/production.

Callback fixture và mock HTTP transport chỉ kiểm logic/giao thức cục bộ, không chứng minh gateway đã thu tiền. Chữ ký kỳ vọng trong test được tính độc lập với helper dưới test. Không tải `.env` vào test hoặc log khóa thật.

## Review

Reviewer độc lập `/root/task4_review`: **Spec PASS / Quality Approved**; không có Critical, Important hoặc Minor còn mở. Reviewer kiểm các chữ ký, callback binding, CAS, session transaction, overflow/rollback, test đồng thời và tương thích legacy. Kiểm ngoài diff có mục tiêu xác nhận kiểu customerId/totalSpent và thuật toán sort cũ phù hợp; không chạy lại hoặc reset database.

Coordinator kiểm chứng lại suite bằng các lệnh ở trên, kiểm `.env`, hash hai Gradle UTF-8 và phần `createPost`/`success` không đổi. Chỉ các file Task 4 và tài liệu được đưa vào commit; không push/merge. Commit dùng message `refactor(payment): extract ZaloPay/VNPay helpers and idempotent markOrderPaid`; lấy hash bằng `git log -1 --format=%H -- helpers/order-payment.helper.js`.

## Các lỗi đã phát hiện và sửa

- Callback/return cũ cập nhật paid trực tiếp, thiếu đối chiếu amount/method và chống cộng chi tiêu lặp: chuyển sang helper xác minh và CAS/transaction; thêm test âm và đồng thời.
- Hai file integration reset cùng database có thể tranh chấp khi runner chạy song song: script chạy `--test-concurrency=1`.
- Helper ban đầu chỉ nhận appUser dạng order, không đúng interface dùng chung: mở appUser chuỗi an toàn ở helper, giữ kiểm phone-orderId chặt tại Order controller; chưa triển khai topup.
- Pipeline ghi file ban đầu làm mất dấu mô tả ZaloPay: khôi phục nguyên văn UTF-8 và thêm test hồi quy qua controller/helper.
- Return lỗi trước đây render view `success` không tồn tại: chuyển về `/`; redirect thanh toán thành công giữ nguyên.

## Manual sandbox

**NOT_RUN**: chưa có bộ thông tin merchant/thẻ sandbox hợp lệ được xác minh cho phiên này. Không gửi giao dịch hoặc dùng callback giả để tuyên bố cổng thanh toán thật đã PASS. Step 5 manual trong checklist giữ chưa tick; người dùng đã cho phép báo rõ giới hạn này khi không có thông tin sandbox.

## Bảo toàn và dừng

Hai file Gradle UTF-8 giữ nguyên hash và nằm ngoài commit. `.env` không sửa, không dùng khóa server Java Card thật. Không triển khai Task 5; không push/merge.
