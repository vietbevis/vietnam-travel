# Plan 03 — Task 7: Phát hành thẻ và danh sách khách hàng

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`.
BASE `42a51ba8c0c7daa691f7053ea11cd14388fb7b47`. Chỉ Task 7, không triển khai Task 8.

## Phạm vi

Phát hành thẻ khách mới, khách cũ và nhân viên, API có quyền `card-issue`, giao diện và xử lý ảnh, danh sách khách hàng và menu theo quyền. Tái sử dụng CardClient Task 6 và operation engine Task 5. Không thay giao thức APDU, dependency hoặc `.env`.

## Quyết định tích hợp

- Prepare phải tạo draft trước INIT trả modulus. Chỉ cho phép tạo draft commit-write cho thẻ issuing của đúng issuedBy khi chưa có modulus; sign/confirm vẫn kiểm modulus và policy.
- Lưu metadata phát hành riêng trong Card, ẩn khỏi truy vấn mặc định, giữ hai opId và PIN được mã hóa có xác thực để finish có thể gửi email sau khi server restart. Không lưu PIN rõ hoặc INIT APDU; xóa ciphertext khi kết thúc/hủy.
- Cấp lại với chuyển tiền/vé thuộc Task 11. Task 7 kiểm đúng thẻ cũ, người sở hữu và trạng thái revoked; từ chối trường hợp còn số dư hoặc vé cần chuyển, không làm mất dữ liệu.
- Cloudinary thiếu cấu hình ở thời điểm preflight. SMTP có cấu hình nhưng không có địa chỉ nhận thử được chỉ định. Automation chỉ giả lập upload/email; không gửi PIN tới người dùng DB phát triển và không tuyên bố dịch vụ ngoài đã PASS thật.

## Chức năng và file

Tạo năm file theo plan: `controllers/admin/card.controller.js`, `routes/admin/card.route.js`, `validates/admin/card.validate.js`, `views/admin/pages/card-issue.pug`, `public/admin/assets/js/card-admin.js`.

Sửa bốn file theo plan: `routes/admin/index.route.js`, `controllers/admin/user.controller.js`, `views/admin/pages/user-list.pug`, `views/admin/partials/sider.pug`.

Điều chỉnh tích hợp tối thiểu: `models/card.model.js` (metadata private), `helpers/card-op.helper.js` (draft trước INIT và ràng buộc phiên ở engine), `helpers/cloudinary.helper.js` (upload ảnh dùng cấu hình chung), `helpers/mail.helper.js` (outcome Promise, bỏ log lỗi SMTP thô), `index.js` (error boundary JSON chỉ cho API thẻ admin).

Tạo `models/card-issuance-request.model.js`, `test/card-admin.test.js`, `test/integration/card-issue.test.js`; cập nhật fixture issuance trong `test/integration/card-op.test.js` để giữ test quyền Task 5 theo metadata mới. Cập nhật HANDOFF, checklist Task 7 và báo cáo này. Hai Gradle UTF-8 có sẵn giữ ngoài commit.

Đủ sáu POST prepare/init-confirm/finish/cancel/op-sign/op-confirm và GET form phát hành. Backend kiểm admin JWT, account/role hiện tại, quyền, Origin/JSON/input và binding issuer; không tin kiểm tra quyền trên menu. Khách phải có email; nhân viên active. INIT kiểm SW, độ dài và cấu trúc modulus. Finish transaction kiểm đúng hai operation mục tiêu đã done rồi active, staff.cardRequired và log; retry không gửi lại PIN/mail. Cancel không rollback thẻ đã active, xóa secret và giải phóng current của issuing thất bại.

Ảnh cắt giữa 160×200, JPEG chất lượng 0.8 xuống 0.3 tới ≤10.080 byte, báo lỗi khi không đạt. Backend kiểm cấu trúc JPEG và kích thước trước upload. PIN sinh mạnh theo DOB, chỉ trả prepare được phép và hiển thị một lần trong dialog, xóa khi đóng/navigation; không storage/log/URL. Danh sách Customer thật tìm theo tên/email/SĐT, trạng thái thẻ current; giới hạn 200 dòng và tối đa 500 lựa chọn owner. Menu theo đúng quyền, các trang Task 9/15 chưa triển khai.

## TDD, review và sửa lỗi

RED ban đầu 14/14 FAIL do thiếu chức năng, sau đó GREEN. Bổ sung RED cho menu/list/reset và alternate API expiry; engine issuing luôn kiểm metadata, expiry và bound operation IDs kể cả `/card-api/op/*`, không giữ bypass cho fixture cũ.

Hai review độc lập ban đầu: Spec FAIL / Quality Changes Requested; Security ChangesRequested, không Critical. Hai Important chung: mất prepare response làm treo current issuance và bỏ replaceOf vượt kiểm tra tài sản thẻ cũ. Vòng sửa có RED 22 PASS/7 FAIL, thêm RED UI 7 PASS/1 FAIL; focused cuối 88 PASS (8 unit, 25 issuance integration, 55 Task 5 regression).

Mã requestId được tạo trước prepare và chỉ giữ RAM trên trình duyệt. Claim bền bind actor, digest, owner và trạng thái; replay còn hạn trước INIT phục hồi đúng Customer/Card/hai op, không phát lại PIN sau INIT/active/cancelled. Cancel tạo tombstone ngay cả trước khi biết cardId; prepare và cancel ghi cùng claim trong transaction để chặn job đến muộn. Retry mơ hồ dùng cùng requestId; khi cần hủy, backend trả owner của đúng actor để lần thử sau chọn lại Customer đã tồn tại. Prepare theo owner dọn issuance hết hạn trước kiểm current. Kiểm tiền/vé/giao dịch chưa đối soát theo owner và các thẻ bị thu hồi kể cả bỏ replaceOf; không chuyển hoặc xóa tài sản trong Task 7.

Review lại fix round 1: **Spec PASS / Quality Approved / SecurityApproved**, cả hai Important ADDRESSED, không Critical/Important mới. Hai Minor để review tổng thể sau này: auth lặp theo mount contract; nhánh đối chiếu hủy pending request trên UI chưa có timeout/AbortSignal riêng nên khi mạng treo có thể giữ busy tới khi fetch kết thúc. Không dùng việc test PASS để che hai giới hạn này. Artifact `task-7-spec-review.md`, `task-7-security-review.md`, `task-7-spec-rereview.md`, `task-7-security-rereview.md`.

## Kết quả kiểm thử cuối

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–7 (128 hồi quy + 8 mới) | 136 | 0 | 0 |
| E2E giao thức jCardSim thật Task 2 | 5 | 0 | 0 |
| MongoDB/HTTP integration thật (78 hồi quy + 25 mới) | 103 | 0 | 0 |
| Edge thật: luồng UI/API/jCardSim | 18 | 0 | 0 |
| Edge thật: Agent status không kết nối khi mở trang | 1 | 0 | 0 |
| Kiểm riêng thiếu TEST_DATABASE | 0 | 0 | 103 |

Coordinator chạy sau source stable: `AGENT_URL=http://127.0.0.1:31999 npm test` đạt 141/141; `npm run test:integration` với DB test replica set đạt 103/103, có TTL thật và guard DB. Các test không cấu hình TEST_DATABASE skip rõ ràng, không dùng làm bằng chứng integration PASS. Có warning Moment bad-date từ fixture Task 5 cũ, không có test FAIL hoặc skip bất ngờ khi cấu hình đầy đủ.

Node 25.9.0, Node:test; không thêm dependency. DB riêng `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test` trên replica set `travelTask4`, đi qua guard Task 3 kiểm tên DB/loopback/DATABASE/kết nối thực trước mỗi delete. Không tải `.env` vào server fixture hoặc test, không reset/drop DB dev/production. Sau test đã cleanup bằng guard, shutdown đúng RS do phiên này chạy (cổng 27018 ECONNREFUSED), MongoDB 27017 read-only hello vẫn OK và Agent 31999 HTTP 200 được giữ chạy; đóng Edge profile test riêng. `.env`, package/dependency và hash hai Gradle UTF-8 được bảo toàn.

Log trong `.superpowers/sdd/2026-11-04-smartcard-03-web/` (Git ignore): `task-7-root-unit-e2e-final.log`, `task-7-root-integration-final.log`, `task-7-root-integration-skip.log`, `task-7-browser-proof-final.log`, `task-7-browser-down-final.log`, report/review/RED/GREEN tương ứng. Commit message `feat(card): admin card issuance and customer list`; tra hash bằng `git log -1 --format=%H -- controllers/admin/card.controller.js`.

## Kiểm chứng Edge, jCardSim và dịch vụ ngoài

**REAL:** Edge 157 headless với profile riêng, route/auth/controller/Pug thật, CardClient thật, MongoDB test và Agent/jCardSim slot 0 thật. Fixture bỏ script/CDN nghiệp vụ không liên quan, không chạy website bằng DB dev. Đã kiểm:

- Khách mới hoàn tất từ form đến INIT, ghi/commit hồ sơ và ảnh; DB active có modulus và đúng hai operation done, secret đã xóa.
- Chọn khách cũ; trùng thẻ bị từ chối; khách đã hủy phát hành có thể phát hành lại sau reset sim được xác nhận rõ trên UI.
- Phát hành nhân viên fixture thành công và cardRequired chuyển true; không phát hành cho admin chính trên DB dev.
- Canvas thật cắt ảnh PNG hơn 5 MB thành JPEG 160×200 ≤10.080 byte; PIN hiển thị một lần rồi xóa, không browser storage.
- CDP làm lỗi kết nối tại BEGIN_WRITE sau INIT thật: server cancel thành failed/noncurrent; INFO thẻ vẫn ACTIVE với cardId cũ, chứng minh không giả định đã reset vật lý.
- CDP bỏ phản hồi HTTP prepare tại response stage sau server commit: retry cùng requestId phục hồi và hoàn thành trên jCardSim, chỉ một Customer và một thẻ current; không mock APDU.
- Danh sách/search/trạng thái thẻ và menu; trang vẫn dùng được khi Agent status không kết nối, không uncaught JavaScript exception.

**Cloudinary: MOCK trong kiểm thử; REAL NOT_RUN** vì thiếu cấu hình. **SMTP: MOCK trong kiểm thử; REAL NOT_RUN** dù cấu hình hiện có, vì không có địa chỉ nhận thử được chỉ định. Mock chỉ ở upload/mail ngoài hệ thống, không dùng để tuyên bố external upload hoặc delivery đã thành công. UI/API/DB/Agent là thật trong môi trường fixture test; chưa phải bằng chứng hồi quy toàn website hoặc chấp nhận production.

## Giới hạn còn lại

- Node 26 runtime chưa chạy; chưa kiểm trình duyệt khác, PC/SC hoặc thẻ vật lý. Các lệnh reset chỉ dùng sim slot 0 trong ngữ cảnh test.
- Gửi mail sau claim trong transaction vẫn có crash window trước SMTP; finish retry không phát lại PIN/mail. Nếu SMTP thất bại thẻ đã active vẫn giữ trạng thái và báo outcome, không rollback giả.
- Upload ngoài transaction có thể để lại asset Cloudinary không được gắn khi request đua/hủy; chưa kiểm dịch vụ thật hoặc cleanup asset ngoài hệ thống.
- Request/tombstone không TTL để chặn delayed replay; collection tăng theo yêu cầu phát hành, chưa có retention/compaction. RequestId chỉ RAM: reload mất correlation, có thể chọn Customer đã lưu và retry sau expiry cleanup; không có background sweeper mới.
- Hai Minor review đã nêu; danh sách/lựa chọn có giới hạn, chưa phân trang server. Menu quản lý thẻ/check-in/nhật ký dẫn tới các task sau chưa triển khai.
- Task 7 hoàn thành source, kiểm thử nội bộ và review trong phạm vi trên; manual Cloudinary/SMTP thật còn NOT_RUN. Dừng trước Task 8, không push/merge hoặc tự bắt đầu task tiếp theo.
