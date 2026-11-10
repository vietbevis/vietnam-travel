# Plan 03 — Task 9: Quản lý trạng thái thẻ và nhật ký

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`. BASE `6e2555bce6e0da35215f80e0a413bc8ca8b8c110`; commit Gradle UTF-8 này đã có trước phiên Task 9, được bảo toàn. Chỉ Task 9; dừng trước Task 10.

## Chức năng và file

- `helpers/card-op.helper.js`: `cardStatus.nextStatus` thuần, đúng lock/unlock/revoke, cạnh sai trả null; thẻ kết thúc không được hồi sinh.
- `controllers/admin/card.controller.js`, `routes/admin/card.route.js`, `validates/admin/card.validate.js`: list/detail/log và status POST. Joi strict, quyền hiện tại ở backend; revoke cần Step-up verified của Task 8, lý do và xác nhận hoàn tiền khi số dư dương. Hết Step-up trả top-level `code:'step-up-required'`.
- `helpers/card-log.helper.js`: tùy chọn transaction session; giữ sanitizer, lỗi ghi audit trong transaction làm rollback. Các caller cũ không có session giữ best-effort.
- `public/admin/assets/js/card-admin.js`: form trạng thái, lý do/hoàn tiền, xác nhận thu hồi vĩnh viễn, luồng PIN/chữ ký Step-up rồi gửi lại đúng payload một lần. Không tự retry request mạng chưa rõ kết quả; thông báo cắm đúng thẻ khi đồng bộ.
- `public/assets/js/card/card-client.js`: `openSession({expectedCardId})` kiểm đúng thẻ trước sync và giữa các vòng; tham số tùy chọn giữ tương thích. TERMINATED đã xóa identity được nhận biết, không sync tiếp.
- Tạo `views/admin/pages/card-list.pug`, `card-detail.pug`, `card-log.pug`: lọc status/type/tên chủ thẻ/cardId, phân trang 20; detail chủ thẻ/số dư/credit chờ/100 giao dịch mới nhất/vé/50 log, vùng `[card-actions]`; log chỉ xem, lọc cardId/action/ngày Việt Nam, không route xóa. Giá trị Pug escaped, nút theo quyền.
- Tạo `test/card-status.test.js`, `test/integration/card-status.test.js`; sửa tối thiểu `helpers/admin-token.helper.js` để iat và exp dùng chung mốc thời gian, khắc phục hồi quy ranh giới giây được phát hiện trong phiên này.
- Cập nhật HANDOFF, checklist Task 9 và báo cáo này. Tổng 16 file; không đổi dependency, `.env`, Gradle, Applet hoặc giao thức.

## Nhất quán tiền, trạng thái và đồng bộ

Card CAS/write-lock dùng chung với sign/receipt, refund debit `source:'refund', status:'done'` và audit cùng MongoDB transaction. Thu hồi đặt `isCurrent:false`, lưu actor/thời gian/lý do, balance về 0 khi hoàn số dư dương; không tạo debit 0 hoặc tăng counter chip. Request lặp/cạnh tranh không ghi thêm refund. Thẻ issuing bị thu hồi được đóng claim/draft, xóa metadata bí mật, chặn finish cũ; không giả định chip đã reset.

Không cho thu hồi khi còn awaiting-payment/pending-card/sent, marker signed chưa done hoặc prepared operation không phải set-state. Trả lỗi cần đối soát, giữ nguyên tiền/receipt/marker; khóa/mở khóa không xóa giao dịch. Test receipt debit đến đồng thời với revoke kiểm settlement đúng một lần và chỉ hoàn số dư cuối cùng. Khi không còn receipt, vẫn cần đối soát thủ công; không tự dựng kết quả.

Prepared set-state công khai không được chặn revoke: nếu chặn mọi prepared operation, người biết cardId có thể tạo sync liên tục để giữ thẻ không thu hồi được. Policy ký/confirm vẫn đối chiếu trạng thái server hiện tại, nên operation cũ không thể mở lại server card đã thu hồi. Sync công khai vẫn chỉ thực thi trạng thái/receipt; không mở quyền ký tài chính.

## TDD, lỗi phát hiện và review

RED ban đầu: 15 FAIL/0 PASS trước code mới. RED bổ sung cho nhầm thẻ trước sync, identity bị xóa sau TERMINATE, thay thẻ giữa vòng và credit failed chưa ký không phải pending. Focused GREEN đầu gồm 67 PASS (20 mới và 47 regression browser trực tiếp).

Hồi quy root lần đầu: 151 unit/E2E PASS; Mongo 143 PASS/1 FAIL. Test legacy JWT 30 ngày phát hiện exp−iat thiếu một giây khi `Date.now` và autoiat của jsonwebtoken qua ranh giới giây. Test đồng hồ có kiểm soát tái hiện RED; payload `iat:now` khắc phục, không làm yếu assertion hoặc thay thời hạn session/Step-up.

Review độc lập đầu: Spec PASS/Quality Approved; Security Needs fixes, một Important S9-SEC-01 về prepared set-state công khai chặn revoke. Test HTTP thật anonymous `/card-api/sync/next` tái hiện RED trước sửa. Sau sửa, revoke thành công, refund một lần, stale state sign/confirm bị từ chối. Focused cuối 22 PASS (7 unit, 15 Mongo/HTTP).

Scoped re-review: **Spec PASS / Quality Approved / SecurityApproved**, S9-SEC-01 và lỗi JWT đã ADDRESSED; không còn Critical/Important trong phạm vi review. Reviewer đọc frozen diff, fix delta và bằng chứng, không tự chạy lại DB/Agent. Artifact `task-9-spec-review.md`, `task-9-security-review.md`, `task-9-spec-rereview.md`, `task-9-security-rereview.md` trong workspace Superpowers ignored.

Minor Task 9: sau revoke, số dư và bảng lịch sử đang render cần tải lại trang để thấy dữ liệu mới; server đã cập nhật đúng. Ghi nhận DEFERRED cùng hai Minor Task 7 (auth lặp/cancel fetch thiếu timeout) và Minor định dạng Task 8, không mở rộng sang task sau.

## Kết quả kiểm thử cuối

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–9 (140 hồi quy + 7 mới) | 147 | 0 | 0 |
| E2E giao thức jCardSim thật | 5 | 0 | 0 |
| MongoDB/HTTP integration thật (130 hồi quy + 15 mới) | 145 | 0 | 0 |
| Edge thật, UI/API/Mongo/jCardSim | 19 | 0 | 0 |
| Chạy riêng khi thiếu TEST_DATABASE | 0 | 0 | 145 |

Coordinator chạy sau source cuối: AGENT_URL=http://127.0.0.1:31999 npm test đạt 152/152; npm run test:integration với DB test replica set đạt 145/145, có TTL Mongo thật. Không dùng SKIP thay integration PASS. Warning Moment bad-date của fixture Task 5 cũ vẫn được ghi nhận; không có test FAIL hoặc skip bất ngờ khi cấu hình đủ.

Logs trong workspace Superpowers ignored: task-9-root-unit-e2e-final.log, task-9-root-integration-final.log, task-9-root-integration-skip.log, task-9-browser-proof.log, các log RED/GREEN, report/review. Lần chạy browser harness đầu thiếu P1/P2 trong lời gọi builder đã sửa ở script kiểm chứng trước khi đạt 19 PASS; không thay giao thức hoặc code sản phẩm để né lỗi.

## Edge và jCardSim thật

**REAL:** Edge 157 headless profile riêng, Pug/layout/route/controller/auth/API thật, MongoDB test replica set và Card Agent/jCardSim thật. Thẻ khách test được INIT trên slot 1, đổi PIN và CREDIT ký/receipt thật 100.000đ ở setup; admin fixture đăng nhập qua thẻ nhân viên slot 0 bằng PIN/RSA thật. Đây không phải chạy lại toàn bộ form phát hành/SMTP/Cloudinary của Task 7.

19 kiểm tra PASS: danh sách/tìm tên/lọc và detail; khóa server khi chip vẫn ACTIVE, nút Đồng bộ đưa chip `03`; mở khóa/sync `02`; JWT fixture có stepUpAt quá 5 phút gây hiện PIN trước revoke, xác thực thật lại rồi retry, giữ exp session; một refund debit hoàn tất và số dư server 0, retry không có refund thứ hai; sync đưa chip `7F`, VERIFY_PIN thật trả `6985`, API unlock bị từ chối; trang log chỉ xem; thu hồi thẻ nhân viên fixture bằng API rồi exact JWT cũ bị dashboard từ chối, browser mất session; không uncaught exception.

Hết hạn Step-up dùng timestamp JWT fixture được ký, **không chờ thực tế 5 phút**. Browser fixture bỏ script/CDN nghiệp vụ không liên quan, giữ CardClient/card-admin/account; APDU không mock. Unit transport dùng doubles chỉ được tính unit. Integration receipt dùng chữ ký RSA fixture thật, không tự coi là Agent thật. SMTP/Cloudinary **NOT_RUN** trong Task 9; không có gọi dịch vụ ngoài để tuyên bố thành công.

## An toàn và giới hạn

Chỉ MongoDB `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, replica set `travelTask4`, guard Task 3 kiểm tên DB/loopback/DATABASE/kết nối trước xóa. Không tải `.env`, không phát hành/thu hồi admin website, không reset/drop DB dev/production. Chỉ reset slot sim 0/1 bằng fixture; khóa server và dữ liệu là test, không log PIN/JWT/proof/key.

Sau test, cleanup fixture qua guard; đúng replica set do phiên này chạy đã dừng (27018 ECONNREFUSED), MongoDB 27017 read-only hello OK, Agent 31999 vẫn HTTP200, Edge profile test đã đóng. Hash `.env`, package.json/yarn.lock và hai Gradle giữ nguyên. Không commit profile/log/khóa.

Node thực tế 25.9.0; Node 26 chưa chạy. Chưa kiểm PC/SC/thẻ vật lý, trình duyệt khác hoặc hồi quy mọi trang nghiệp vụ. APDU đã ký/đang truyền và chip offline không thể coi là đã thực thi trạng thái server; cần kết nối và sync, các operation cũ vẫn chịu challenge/policy hiện tại.

Commit message: `feat(card): card list, detail, lock/unlock/revoke and audit log`; tra hash bằng `git log -1 --format=%H -- test/card-status.test.js`. Không push/merge, dừng trước Task 10.
