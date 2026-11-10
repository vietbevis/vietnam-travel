# Plan 03 — Task 12: Đăng nhập khách bằng thẻ, tài khoản thẻ và OTP báo mất

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`, BASE `ef805a533a6d67af3ee277000aa36d896caf1451`. Chỉ Task 12, dừng trước Task 13. Đã kiểm thử và review cuối trước commit.

## Chức năng và file

- Tạo `middlewares/client/customer-auth.middleware.js`: JWT HS256 customerToken 1 ngày, đúng customerId/cardId và exp; mỗi request kiểm lại Customer active/nondeleted và đúng thẻ customer active/current/owner. Token sai, hết hạn, thẻ locked/revoked hoặc owner sai bị loại và xóa cookie. `optional` đặt locals an toàn cho trang cũ; `required` redirect HTML, API trả lỗi JSON. Cookie httpOnly, sameSite strict, secure khi production.
- Tạo `controllers/client/account.controller.js`, `routes/client/account.route.js`, `validates/client/card.validate.js`; mở rộng `controllers/client/card-api.controller.js`, `routes/client/card-api.route.js`, `routes/client/index.route.js`. Login challenge/verify dùng CardAuth/nonce 60 giây single-use CAS, M_auth RSA đúng thẻ/loại/chủ/trạng thái. Login ghi activation khi chưa có; logout xóa cookie. Profile build chỉ nhận phone/emergencyName/emergencyPhone, định danh từ phiên, TLV còn lại từ Customer chuẩn; engine/latest-target binding giữ actor và chỉ áp Customer sau confirm.
- Trang tài khoản hiển thị hạng/chi tiêu/số dư/pending/lịch sử server. Đọc chip bằng PIN: hồ sơ, ảnh blob, balance/counter, log và vé; lệch ví có banner, sync rồi đọc lại và lấy snapshot server. Không ghi số dư theo dữ liệu browser hoặc tạo tiền để che lệch.
- Mở rộng `models/forgot-password.model.js` theo purpose, hash/salt/card/customer, attempts/consumedAt và quota bền có unique key; sửa tối thiểu `controllers/admin/account.controller.js` để admin-reset/records legacy không purpose tách khỏi OTP khóa thẻ. Không migration hoặc thay dữ liệu thật. OTP khách lưu HMAC theo domain/email/card/salt, không rõ trong DB; sáu số từ crypto.randomInt, 5 phút kiểm tại backend, max 5 lần thử mỗi mã. Mã bound thẻ nguồn, không khóa nhầm successor sau cấp lại; email cũ khác hoa/thường được xử lý, email canonical trùng nhiều Customer bị từ chối an toàn.
- Quota gửi email 5/15 phút, IP 30/15 phút, cooldown gửi 60 giây; xác nhận email 20/15 phút, IP 100/15 phút. Records quota tồn tại qua restart/reissue, retention TTL 24 giờ; validity không phụ thuộc TTL. OTP consume, lock Card và audit cùng transaction, giữ số dư/pending/sent. Lý do `customer-reported-lost`, actor customer. Nonce/purpose/OTP không dùng chéo với admin.
- Gửi OTP tồn tại/không tồn tại/thẻ không active/quota/mail lỗi cùng generic response. Không chờ SMTP; response floor 120ms, tối đa 4 promise outbound, không queue chứa OTP tăng vô hạn. Ghi outcome sent/failed/busy an toàn. Email thông báo sau lock; request lặp không gửi lại hiệu ứng thành công.
- Tạo `views/client/pages/account-login.pug`, `account-card.pug`, `account-card-lock.pug`, `public/assets/js/card-customer.js`, `public/assets/css/card-customer.css`; sửa layout/header để nạp đúng CardShared → CardClient → script khách và dùng header login/tên/thẻ/logout/báo mất. UMD/browser flow xử lý Agent lỗi/slot trống/staff/locked, PIN sai/mismatch/yếu, forced change, PIN/OTP xóa và không storage. Scoped CSS responsive, dữ liệu chip render textContent.
- Sửa `index.js` thêm error boundary `/account` sau global parser: JSON lỗi không đi vào logger Express mặc định chứa raw body/OTP. Tạo `test/card-customer-ui.test.js`, `test/customer-account-boundary.test.js`, `test/integration/card-customer.test.js`; `test/integration/card-op.test.js` chỉ thêm expiresIn 1d cho ba JWT customer fixture cũ để đúng contract mới, không hạ assertion. Cập nhật HANDOFF, checklist và báo cáo này. Không dependency/env/Gradle/Applet/APDU mới.

## TDD, review và kiểm thử cuối

RED trước source cho HTTP/RSA/Mongo và UMD UI; có RED riêng cho delayed expiry, email legacy case, audit unauthorized, DOM snapshot/late logout/parser. Self-review phát hiện notification sống qua transaction abort: test RED thấy mail chứa mã không persist, catch clear notification và GREEN focused 20 Mongo. Root chạy Edge lần đầu gặp chuỗi tiếng Việt sai encoding trong harness PowerShell→Node; sửa harness, không sửa code sản phẩm để né test.

Review đầu phát hiện hai Important: IP bị giới hạn vẫn tiêu quota email khác, và PIN sinh nhật lọt qua lần đổi PIN đầu do chip chưa cho đọc DOB. Đã sửa cả hai bằng RED → GREEN (22 Mongo +10 UI/parser). Scoped re-review: **Spec PASS / Quality Approved / SecurityApproved**, tất cả Important ADDRESSED, không Critical/Important mới. Fix 1 rollback/mail cũng CLOSED. Minor pending/history giữ DEFERRED; các Minor cũ không bị bỏ quên. Hai reviewer độc lập chỉ đọc frozen diff/delta và evidence, không tự chạy lại DB/Agent.

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–12 | 169 | 0 | 0 |
| E2E giao thức jCardSim thật | 5 | 0 | 0 |
| MongoDB/HTTP integration thật | 202 | 0 | 0 |
| Edge thật + jCardSim | 26 | 0 | 0 |
| Chạy riêng khi thiếu TEST_DATABASE | 0 | 0 | 202 |

Root chạy source cuối: 174/174 unit+E2E, 202/202 MongoDB/HTTP thật, 26/26 kiểm tra Edge PASS. Root dùng `AGENT_URL=http://127.0.0.1:31999 npm test` và `npm run test:integration` với Mongo replica set riêng. Không dùng SKIP thay integration PASS. Warning Moment bad-date từ fixture Task 5 cũ tiếp tục ghi nhận, không mở rộng sửa ngoài task. Logs cuối: `task-12-root-unit-e2e-final.log`, `task-12-root-integration-final.log`, `task-12-root-integration-skip.log`, `task-12-browser-proof-final.log`; review `task-12-{spec,security}-review.md` và `task-12-{spec,security}-rereview.md`. Artifacts RED/GREEN/report/review/root logs ở `.superpowers/sdd/2026-11-04-smartcard-03-web/`, Git ignored.

## Kiểm chứng Edge và jCardSim

**REAL:** Edge 157 headless profile test riêng, Express/admin+client routes/controller/auth/Pug thật, CardClient thật, MongoDB test replica set và Agent `--sim`. Phát hành thẻ khách qua UI admin trên slot 0, thẻ nhân viên fixture slot 2; xóa cookie admin trước khi kiểm customer để quyền admin không che lỗi. Slot 1 trắng dùng kiểm thẻ chưa phát hành. Không thẻ vật lý hoặc dữ liệu website.

26 kiểm tra PASS. Đã kiểm đổi PIN đầu/mismatch/yếu, cookie customer 1 ngày httpOnly/strict, Gold theo chi tiêu fixture, header và logout/relogin; PIN sai thật hiện còn 4 lần thử và xóa input. CDP làm lỗi transport Agent, slot trống/staff bị từ chối và không bypass. Form tài khoản được kiểm viewport 390px.

PIN sinh nhật: chip mới chặn đọc hồ sơ trước lần CHANGE_PIN đầu, nên UI đọc DOB cục bộ sau CHANGE_PIN/VERIFY khi chip cho phép. Nếu mã vừa chọn trùng DOB, buộc đổi tiếp trước AUTH. Edge thử mã trùng DDMMYY của DOB fixture, hủy hộp đổi tiếp rồi đăng nhập lại bằng mã đó: normal login vẫn buộc đổi mạnh trước khi cấp cookie. Không gửi PIN tới backend hoặc mở API DOB ẩn danh, không thay giao thức.

Để kiểm lệch ví, tại GET_BALANCE của browser, fixture tạo pending transfer và thực hiện CREDIT APDU thật 700.000đ nhưng chưa confirm. Browser đọc chip 700.000đ trong khi server 0đ, hiện banner rồi GET_RECEIPT thực khôi phục đúng một lần. Sau đó server/chip 700.000đ; đọc được hồ sơ, JPEG, log và vé trên chip. Sửa ba trường liên hệ, đọc lại TLV khớp Customer; ảnh/ví/vé/chi tiêu và trường khác không mất. Trang server hiển thị giao dịch done 700.000đ và thêm pending 10.000đ fixture đúng trạng thái.

OTP qua UI: email tồn tại/không tồn tại cùng thông điệp; sai mã không khóa, expireAt fixture quá hạn bị từ chối ngay trước TTL, quota không reset khi cấp mã mới sau mốc cooldown fixture. Mã đúng khóa một lần, giữ 700.000đ và pending 10.000đ; replay bị từ chối. Exact JWT trước lock bị redirect ở request tiếp theo; login lại sync chip LOCK `03` rồi báo bị khóa. Không uncaught exception/PIN/OTP storage. Mốc hết hạn/cooldown dùng timestamp fixture, không chờ đồng hồ thật 5 phút.

**SMTP: MOCK; REAL NOT_RUN.** Adapter bắt OTP trong RAM để nhập form test và kiểm email thông báo; không log hoặc đưa mã vào báo cáo/URL. **Cloudinary: MOCK cho setup phát hành; REAL NOT_RUN.** Không tuyên bố mail/upload dịch vụ ngoài thành công. Unit transport/DOM doubles và RSA fixture integration không được tính là Edge/Agent thật. Browser fixture bỏ script/CDN nghiệp vụ không liên quan; chưa hồi quy toàn website.

## An toàn và giới hạn

Chỉ `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, replica set `travelTask4`, guard Task 3 kiểm tên DB/loopback/DATABASE/kết nối thực trước xóa. Không nạp/sửa `.env`, không dùng khách/admin chính hoặc reset/drop DB dev/production. Khóa và dữ liệu là test; chỉ reset sim trong fixture. Hash `.env`, package.json/yarn.lock và hai Gradle được đối chiếu trước/sau, tất cả không đổi.

Sau kiểm thử đã cleanup fixture bằng guard và dừng đúng replica set do phiên này chạy (dbPath test đã xác minh), cổng 27018 ECONNREFUSED. MongoDB 27017 chỉ đọc hello vẫn OK; Agent 31999 HTTP200 được giữ chạy; Edge profile test đã đóng. Không xóa dữ liệu website.

- COMMIT_WRITE vẫn dùng ACK theo protocol hiện có, không có signed receipt riêng. Unknown confirm cần đối chiếu/rebuild; không tự áp Customer theo dữ liệu browser.
- SMTP hậu commit chưa có durable outbox, có crash window; mail pending/failed/busy không được tự coi đã gửi thật. Bốn SMTP promise treo có thể giữ slot; không có queue tăng vô hạn. Response floor giảm timing oracle, không chứng minh constant-time dưới tải DB bất thường.
- Minor UI: sau mismatch sync, pending/history đang render cần reload để lấy snapshot mới dù balance đã cập nhật. Các Minor Task 7–11 vẫn được theo dõi, không mở rộng task.
- Node thực tế 25.9.0; Node 26, PC/SC/thẻ vật lý, trình duyệt khác, toàn website và production **NOT_RUN**.

Commit message: `feat(card): customer card login, card account page and OTP self-lock`; tra hash bằng `git log -1 --format=%H -- test/integration/card-customer.test.js`. Không push/merge; dừng trước Task 13.
