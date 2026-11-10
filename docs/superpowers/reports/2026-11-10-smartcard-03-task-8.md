# Plan 03 — Task 8: Đăng nhập thẻ nhân viên và Step-up Authentication

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`.
BASE `bdc8e82cb3a98cb0f47a39c6b39a7b487c59986c`. Chỉ Task 8, dừng trước Task 9.

## Phạm vi và quyết định tích hợp

Triển khai helper token/nonce/chữ ký, đăng nhập hai bước bằng thẻ nhân viên, middleware revalidate và Step-up. Tích hợp đúng `views/admin/layouts/account.pug` cùng `public/admin/assets/js/account.js`, không nhầm `script.js` của dashboard.

Giữ JWT legacy 1 ngày/remember 30 ngày và cookie flags; preToken 5 phút chỉ cho giai đoạn password đã xác nhận, chưa phải main session. OTP với tài khoản bắt buộc dùng thẻ chỉ được cấp quyền đổi mật khẩu, không main JWT. Nonce 60 giây dùng một lần, claim nguyên tử, bind purpose/account; không dựa TTL để kiểm expiry. Step-up tối đa 5 phút, bound đúng thẻ và account từ JWT verified cùng trạng thái DB, giữ expiry session hiện tại.

Hai Minor Task 7 (auth lặp, fetch đối chiếu cancel thiếu timeout) được ghi nhận, không mở rộng sửa ngoài phạm vi liên quan Task 8.

## Chức năng đã triển khai

- `adminToken.issue` giữ cookie httpOnly/sameSite strict và JWT 1 ngày hoặc 30 ngày khi remember. `preToken` 5 phút, stage card, bind account và remember sau kiểm mật khẩu; xóa main cookie cũ và chỉ cấp main JWT sau proof staff hợp lệ.
- `cardAuth.issueNonce/verify`: nonce ngẫu nhiên 16 byte, unique index, 60 giây, đúng purpose/account, claim used nguyên tử. Kiểm M_auth bằng public key đúng thẻ, cardId/counter uint32/chữ ký, staff/current/active/owner. Auth không sửa ví/counter; anomaly chỉ log sau chữ ký hợp lệ, không có transaction sent giải thích.
- Middleware và các boundary admin độc lập dùng chung resolve account/role/card hiện tại; staged pre/reset token không được dùng làm main token. Card đã bind vào JWT phải tiếp tục active/current/đúng owner kể cả khi cardRequired được bỏ sau đó. Quyền đổi hoặc account/card bị khóa có hiệu lực ở request kế tiếp.
- OTP của account cardRequired chỉ cấp resetToken 5 phút, stage reset-password; cho phép đổi mật khẩu nhưng không cấp main JWT hoặc preToken. Token reset gắn fingerprint password, không dùng lại sau đổi mật khẩu; OTP được kiểm expiry và tiêu thụ nguyên tử. Legacy OTP vẫn giữ thời hạn đăng nhập 1 ngày.
- Bốn endpoint login-card và step-up challenge/verify nhận dữ liệu CardClient, không nhận identity/purpose/stepUpAt/remember do browser tự khai. `stepUp.isFresh(req)` dùng verified context, đúng thẻ/account và mốc không tương lai, tuổi ≤300000 ms. Reissue Step-up giữ exp JWT cũ; session không exp bị từ chối khi reissue.
- Đúng account layout: cấu hình Agent qua attribute escaped, CardShared → CardClient → account.js cùng PIN modal. Login có HTML validation dự phòng khi CDN JustValidate vắng. Thẻ mới phải VERIFY PIN ban đầu, nhập/khớp PIN mới, CHANGE_PIN/VERIFY mới rồi AUTH; weak/mismatch/cancel/error không đi tiếp. PIN/password được xóa, không log/storage/URL. Lỗi SW và Agent/slot chưa phát hành hiển thị tiếng Việt.

## File tạo/sửa

Tạo: `helpers/admin-token.helper.js`, `helpers/card-auth.helper.js`, `test/integration/admin-auth.test.js`, `test/admin-account-ui.test.js`, báo cáo này.

Sửa theo luồng Task 8: `controllers/admin/account.controller.js`, `routes/admin/account.route.js`, `middlewares/admin/auth.middleware.js`, `controllers/admin/card.controller.js`, `routes/admin/card.route.js`, `views/admin/pages/login.pug`, `views/admin/layouts/account.pug`, `public/admin/assets/js/account.js`.

Tích hợp tối thiểu: `controllers/client/card-api.controller.js` dùng canonical stage/card/step-up policy cho alternate API, `models/card-nonce.model.js` thêm unique nonce, `index.js` thêm account JSON error boundary tránh raw-body logger; fixture `test/integration/card-op.test.js` bổ sung active staff card đúng owner cho sensitive step-up, không làm yếu assertion. Cập nhật HANDOFF và checklist Task 8. Tổng 19 file trong commit, không sửa `script.js` dashboard hoặc hai Gradle có sẵn.

## TDD và kiểm thử cuối

RED integration ban đầu: 20 tests, 18 FAIL/2 PASS; UI RED 2 FAIL khi CDN thiếu. Sau đó có RED riêng cho đổi PIN lần đầu, nonce trùng/step-up JWT không exp và reset password yếu. Focused cuối **31 PASS** (27 MongoDB/RSA/HTTP, 4 UI VM); hồi quy riêng Task 5/7 **80 PASS**. Các run trung gian thất bại do fixture `.invalid` bị Joi từ chối và fixture sensitive-op thiếu bound staff card đã được sửa đúng dữ liệu, không hạ assertion.

Coordinator kiểm tra source stable:

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–8 (136 hồi quy + 4 mới) | 140 | 0 | 0 |
| E2E jCardSim giao thức Task 2 | 5 | 0 | 0 |
| MongoDB/HTTP integration thật (103 hồi quy + 27 mới) | 130 | 0 | 0 |
| Edge thật, login/Step-up/thu hồi/Agent | 20 | 0 | 0 |
| Kiểm riêng khi thiếu TEST_DATABASE | 0 | 0 | 130 |

Lệnh `AGENT_URL=http://127.0.0.1:31999 npm test` đạt 145/145; `npm run test:integration` với TEST_DATABASE test replica set đạt 130/130. Run thiếu TEST_DATABASE skip, không dùng thay integration PASS. Có warning Moment bad-date từ fixture Task 5 cũ; không có FAIL hoặc skip bất ngờ khi cấu hình đủ. Không cài dependency mới.

Log và report chi tiết ở `.superpowers/sdd/2026-11-04-smartcard-03-web/` (Git ignore): `task-8-red.log`, `task-8-ui-red.log`, các log RED mở rộng, `task-8-green.log`, `task-8-regression.log`, `task-8-root-unit-e2e.log`, `task-8-root-integration.log`, `task-8-root-integration-skip.log`, `task-8-browser-proof.log` và `task-8-report.md`.

## Edge, jCardSim và token cũ

**REAL:** Edge 157 headless profile riêng, account/dashboard Pug và route/controller/middleware thật, bcrypt/JWT thật, MongoDB test replica set, CardClient và Agent/jCardSim thật. Không phải thẻ vật lý. Fixture loại script/CDN nghiệp vụ không liên quan; cố tình bỏ CDN JustValidate để chạy fallback thật, không thay handler submit bằng mock.

Đã kiểm legacy remember 30 ngày; staff sau mật khẩu chỉ có preToken 5 phút; PIN sai qua APDU thật hiện còn 4 lần thử và xóa input; PIN đúng xác thực RSA vào dashboard với cardId/stepUpAt đúng và xóa preToken. Thẻ nhân viên mới có mustChangePin được đổi PIN trước AUTH và vào dashboard thành công.

Sau đăng nhập, cập nhật Card fixture sang locked rồi revoked: browser bị đưa về login, cookie token bị xóa. Gửi lại đúng JWT cũ qua HTTP thật sau revoked vẫn bị redirect, không dùng được dashboard. Thay permissions trong Role fixture làm request hiện tại tới trang phát hành bị 403.

Login tạo Step-up fresh. Dùng JWT fixture được ký với stepUpAt quá 5 phút để kiểm backend trả not-fresh, rồi dùng modal PIN và AUTHENTICATE thật để reissue; freshness trở lại và exp JWT bằng exp cũ. **Không đợi đồng hồ thực 5 phút**; trường hợp stale dùng timestamp fixture. Đã chuyển sang slot 1 trắng (CREATED/chưa phát hành), UI báo lỗi và không cấp main token; CDP chặn kết nối Agent cũng báo tiếng Việt, không bypass. Slot trắng không phải bằng chứng rút đầu đọc vật lý.

Không có PIN/nonce/chữ ký/JWT/key được in vào log proof hoặc báo cáo. UI VM dùng doubles chỉ để kiểm flow, không gọi đó là browser/Agent thật. Integration dùng RSA keypair fixture thật nhưng không giả định đã chạy qua Agent; bằng chứng Agent là bộ E2E và Edge nêu trên. SMTP/Cloudinary không cần cho luồng test này; delivery/upload thật **NOT_RUN**.

## Review và an toàn dữ liệu

Hai review độc lập: **Spec PASS / Quality Approved / Security PASS**, không phát hiện Critical/Important phải sửa. Spec reviewer đọc frozen diff và log root; security reviewer rà staged token/OTP bypass, replay, binding, stale token và Step-up, không tự chạy lại DB/Agent. Artifact `task-8-spec-review.md`, `task-8-security-review.md`. Một Minor Task 8: một số helper/test nén nhiều statement trên dòng dài, cần cải thiện khả năng đọc ở lần chỉnh phù hợp. Hai Minor Task 7 tiếp tục được ghi nhận, không sửa mở rộng.

DB test riêng `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, replica set `travelTask4`, guard Task 3 xác minh loopback/tên DB/DATABASE/kết nối thực trước từng delete. Không tải `.env` vào fixture/test hoặc phát hành thẻ cho admin website. Card/account/role/OTP đều fixture trong DB test; chỉ reset sim slot 0 và 1 trong ngữ cảnh kiểm thử.

Sau test đã cleanup fixture bằng guard và dừng đúng RS do phiên này khởi chạy: cổng 27018 ECONNREFUSED, MongoDB 27017 read-only hello vẫn OK, Agent 31999 HTTP200 được giữ chạy, Edge profile test đóng. Hash `.env`, package.json và cả hai Gradle UTF-8 không đổi; không commit test profile/log/khóa. Không reset/drop database dev hoặc production.

## Giới hạn và bàn giao

Node thực tế 25.9.0; chưa chạy Node 26 theo plan, trình duyệt khác hoặc PC/SC/thẻ vật lý. Chưa hồi quy mọi trang website hoặc xác nhận SMTP/Cloudinary thật. Hai Minor Task 7 và Minor về định dạng Task 8 không chặn nghiệm thu nội bộ, vẫn cần theo dõi khi review tổng thể.

Commit message: `feat(card): staff card login and step-up authentication`; tra hash bằng `git log -1 --format=%H -- helpers/admin-token.helper.js`. Chỉ Task 8; dừng trước Task 9, không push/merge.
