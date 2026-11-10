# Plan 03 — Task 3: Model, quyền, nhật ký, hạng thành viên và ví

Ngày: 2026-11-10. Workspace `D:\vietnam-travel`, nhánh `feature/smartcard`.
BASE: `99168d67e439692018ceb52158fd56e7efa2ce24`.

## Phạm vi

- Sáu model `Customer`, `Card`, `CardTransaction`, `CardLog`, `CardNonce`, `CardOperation` theo spec 5.2; timestamps, mặc định, enum, validation, unique/partial unique index và TTL.
- `AccountAdmin.cardRequired` mặc định false; `Order.customerId`, `cardTxRef` và trường vé trong `items[]`. Sub-schema item `strict:false`, `_id:false` bảo toàn trường cũ; không ép enum của trạng thái/thanh toán cũ và không migration dữ liệu thật.
- Chín quyền thẻ với nhãn tiếng Việt trong `config/permission.js`; không thay đổi route hoặc middleware phân quyền hiện có.
- Ba helper: ghi log không ném lỗi, hạng/chiết khấu và hạn mức nạp online/tiền mặt.
- Test bằng `node:test`, Mongoose và dependencies có sẵn. Không thêm dependency hoặc sửa `.env`.
- Chỉ Task 3; không triển khai Task 4 hoặc engine nghiệp vụ của Task 5.

## Bảo vệ database test

Chỉ cho phép MongoDB loopback và tên **`vietnam-travel-smartcard-test`**. URI chạy thật: `mongodb://127.0.0.1:27017/vietnam-travel-smartcard-test`.

`test/helpers/db.js` từ chối trước I/O khi thiếu cấu hình, URI không hợp lệ, tên khác, host ngoài loopback, credentials/query/fragment hoặc trùng database trong `DATABASE` (kể cả alias localhost/IPv6 và `dbName`). Không nạp `.env` và không kết nối tới `DATABASE` để kiểm tra.

Trước reset và trước từng `deleteMany`, helper kiểm lại cấu hình và kết nối thực tế: tên, host, port, client options và trạng thái kết nối phải khớp đích đã xác minh. Không nhận quyền reset một kết nối có sẵn chưa do helper xác minh. Reset dùng danh sách collection từ native DB, kể cả collection không đăng ký model; xóa document, giữ index.

- Unit guard chứng minh URI thiếu/không an toàn không chạm connect; đổi cấu hình hoặc đích kết nối bị chặn trước delete.
- Integration thật tạo fixture trong DB test, đổi `TEST_DATABASE` sang tên dev rồi gọi reset: reset bị từ chối và fixture test vẫn còn. Không tạo fixture hoặc xóa dữ liệu trong DB dev để thử guard.
- Sau khi khôi phục đúng cấu hình, reset xóa được fixture native trong DB test.
- Chưa và không chạy reset/drop/delete collection trong `vietnam-travel-smartcard-dev` hoặc production.

## Kiểm thử

| Nhóm / chế độ | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Baseline trước Task 3 | 46 | 0 | 5 E2E thiếu AGENT_URL |
| Unit Task 1–3 (gồm guard) | 65 | 0 | 0 |
| E2E Task 2 qua agent jCardSim thật | 5 | 0 | 0 |
| Toàn suite có AGENT_URL — coordinator chạy lại | 70 | 0 | 0 |
| Mongo integration thật — coordinator chạy lại | 8 | 0 | 0 |
| Integration thiếu TEST_DATABASE | 0 | 0 | 8 |

Integration chạy thật gồm: E11000 cardId/current owner+type/txRef; trường/default và Order legacy lưu/đọc lại; log thành công và lỗi validation không thoát helper; TTL index với expireAfterSeconds=0 và Mongo thật xóa nonce/op quá hạn (lần coordinator khoảng 4,6 giây); reset native collection và từ chối env đổi sang dev; dữ liệu model sai bị từ chối. Không thay cấu hình TTL monitor của MongoDB.

TDD: viết test trước source, quan sát thiếu module RED trong unit/integration mà chưa mở DB. Sau đó có assertion RED riêng cho reset bỏ sót collection native, null vô hiệu hóa TTL/status/used, và hex không cùng chuẩn chữ hoa với Task 1; mỗi lỗi đã sửa và test chuyển GREEN. Lỗi cú pháp test được sửa trước live không tính là RED nghiệp vụ.

Các nhóm kiểm: giá trị biên hạng/chiết khấu; số nguyên và hạn mức ví; schema/default/enum/hex/null/TTL; legacy Order; guard; Mongo unique indexes/TTL thật; log thành công/lỗi và dữ liệu nhạy cảm; E2E giao thức Task 2 khi agent sẵn.

## File tạo/sửa

- Tạo sáu model: `models/customer.model.js`, `card.model.js`, `card-transaction.model.js`, `card-log.model.js`, `card-nonce.model.js`, `card-operation.model.js`.
- Tạo ba helper: `helpers/card-log.helper.js`, `tier.helper.js`, `wallet-rule.helper.js`.
- Sửa: `models/account-admin.model.js`, `models/order.model.js`, `config/permission.js`.
- Tạo test: `test/tier.test.js`, `wallet-rule.test.js`, `card-model-schema.test.js`, `db-guard.test.js`, `helpers/db.js`, `integration/card-model.test.js`.
- Cập nhật Plan 03, HANDOFF và báo cáo này. Không thay package hoặc lockfile.

## Trang tạo nhóm quyền

Đã kiểm **HTTP 200** tại `/admin/setting/role/create` trên server cô lập sử dụng route, middleware JWT, controller và template Pug thật. Role/AccountAdmin fixture chỉ nằm trong DB test; không dùng tài khoản/khóa JWT của website phát triển. HTML có đúng một checkbox cho mỗi quyền thẻ và đủ chín nhãn tiếng Việt:

`card-view`, `card-issue`, `card-edit`, `card-lock`, `card-revoke`, `card-reset-pin`, `card-topup`, `card-checkin`, `card-log-view`.

Đây là kiểm HTTP/render có xác thực thật với dữ liệu test; chưa kiểm trực quan bằng trình duyệt hoặc đăng nhập bằng tài khoản dev. HTML và proof được lưu dưới `.superpowers/sdd/2026-11-04-smartcard-03-web/` (Git bỏ qua).

## Review

Review độc lập bằng Superpowers `requesting-code-review` trong quy trình `subagent-driven-development`: **Spec PASS / Task quality Approved**; không có Critical, Important hoặc Minor cần sửa. Reviewer kiểm diff, guard, index, TTL, helper và các caller/view hiện tại có đọc Order.items; probe trong bộ nhớ xác nhận direct access các trường cũ vẫn hoạt động. Reviewer không chạy lại suite hoặc kết nối DB.

Các phát hiện đã sửa trong quá trình triển khai gồm reset bỏ sót collection native, null có thể vô hiệu TTL/status/used và chuẩn hóa hex không cùng chữ hoa với Task 1. Mỗi lỗi có test RED trước sửa và GREEN sau sửa. Không có lỗi mở sau review.

## Bảo toàn và giới hạn

- Hai thay đổi Gradle UTF-8 được giữ nguyên hash và loại khỏi commit: agent `C399240D30E8C759EE0AD6994B83405168D31BFE94911D12385EEC1309297F7D`; applet `9236B4E4ED6B30E821D80A3AEE6915DC56ADD523970C852BA31BAF0C1B6FEB04`.
- Không tự tạo quyền cho tài khoản thật, không migration/backfill DB dev, không thay đổi website/payment hoặc giao thức APDU.
- Runtime thực tế Node 25.9.0; Node 26 runtime **NOT_RUN**. Các API core đang dùng đã chạy trên 25.9.0; cần chạy lại suite trên Node 26 trước khi tuyên bố tương thích phiên bản đó. Xem [đối chiếu Node trong Task 2](2026-11-10-smartcard-03-task-2.md).
- Enum `CardOperation.status` hiện bám spec: draft/prepared/done/failed. Task 5 có bước confirming trong plan khác enum spec; ghi nhận cho lần triển khai sau, chưa tự mở rộng trong Task 3.
- Quan hệ `Card.status/isCurrent` được validate khi create/validate/save document. Query updates/updateMany/bulkWrite/raw collection chưa tự bảo đảm bất biến chéo trường; caller tương lai phải cập nhật cả hai đúng quan hệ hoặc dùng document save. `runValidators` trên query không thay thế validation theo ngữ cảnh document.
- TTL là dọn dữ liệu bất đồng bộ; các endpoint tương lai vẫn phải kiểm tra `expireAt`/`used` và chiếm nonce/op nguyên tử. Sanitizer log không thay trách nhiệm chỉ truyền metadata, không truyền raw request/PIN/key/APDU. Test đường lỗi log đã dùng lỗi validation thật; chưa ép lỗi mất mạng MongoDB.
- Lần triển khai tiếp theo chỉ khi được giao: Task 4 — tách helper thanh toán và `markOrderPaid`.
