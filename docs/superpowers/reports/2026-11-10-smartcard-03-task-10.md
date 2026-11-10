# Plan 03 — Task 10: Reset PIN qua escrow và nạp tiền mặt

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`, BASE `54d537e982210e057efdff955e1e0690f3158bf0`. Chỉ Task 10; dừng trước Task 11.

## Chức năng và file

- `controllers/admin/card.controller.js`, `routes/admin/card.route.js`, `validates/admin/card.validate.js`: hai POST `/admin/card/reset-pin` và `/admin/card/topup-cash`, strict Joi, quyền hiện tại và Step-up bound đúng nhân viên còn hiệu lực. Reset chỉ active/current, chuẩn hóa DOB Mongo Date thành YYYYMMDD trước `generatePin(dob)`; create trả opId, không PIN.
- `helpers/card-op.helper.js`: confirm reset thắng lần đầu mới trả `result.newPin`, scrub cả newPin/encryptedPin. Notification được xóa ở đầu mỗi callback transaction retry để lần rollback không rò PIN/gửi mail. Await mail, bắt throw/reject và trả kết quả an toàn sent/failed/not-applicable; replay không trả PIN hoặc gửi lại mail. Không lưu PIN rõ trong database.
- `models/card-operation.model.js`: thêm `emailStatus` an toàn, không lưu nội dung mail/PIN. `models/card-transaction.model.js`: `cashRequestId` unique partial index không TTL để giữ identity của khoản tiền trong ledger.
- Nạp tiền giữ body `{cardId,amount}` và yêu cầu header `Idempotency-Key` 32 hex. Header định danh một ý định, không thay authentication; phải giữ cùng key/body khi mất phản hồi. Backend bind actor/card/amount, replay trả txRef/status cũ cả sau done; mismatch bị từ chối. Hai khoản tiền thật khác nhau cần hai key khác nhau.
- Transaction ghi chung AccountAdmin theo nhân viên và Card theo ví trước khi tổng hợp, chống vượt hạn mức khi request cạnh tranh trên nhiều thẻ/nhân viên. Mỗi lần ≥10.000đ, tối đa 20.000.000đ/nhân viên/ngày Việt Nam, balance + pending + amount ≤50.000.000đ. Daily sum tính mọi cash credit accepted, kể cả pending/sent/failed; wallet pending gồm pending-card/sent và failed-signed chưa đối soát, không đếm trùng row. Chỉ tạo credit cash pending-card, chưa đổi balance; receipt đúng thẻ mới settlement.
- `views/admin/pages/card-detail.pug`, `public/admin/assets/js/card-admin.js`: form Reset PIN/nạp tiền theo quyền và trạng thái, modal PIN một lần, xóa khi đóng/pagehide; xử lý Step-up có chờ đổi thẻ nhân viên, sau đó yêu cầu cắm lại thẻ đích. Cash giữ intent/key/txRef khi mơ hồ, có nút đối chiếu và chỉ bắt đầu khoản khác bằng thao tác riêng sau done. Không tự phát lại RESET_PIN hoặc CREDIT khi mất xác nhận.
- `public/assets/js/card/card-client.js`: tùy chọn tương thích `openSession({expectedCardId,sync:false})` chỉ SELECT/INFO/identity cho guard ban đầu, không sync tiền trước khi endpoint kiểm quyền/Step-up. Mặc định giữ full sync. Hai flow kiểm thêm ACTIVE/identity để thẻ trắng hoặc terminated không tạo operation/khoản nạp.
- Tạo `test/card-admin-ops.test.js` (9 unit) và `test/integration/card-admin-ops.test.js` (19 Mongo/HTTP); cập nhật HANDOFF, checklist Task 10 và báo cáo này. Tổng 14 file; không đổi dependency, `.env`, Gradle, Applet hoặc giao thức APDU.

## TDD và kiểm thử cuối

RED backend ban đầu 13 FAIL/0 PASS trước code; UI 6 FAIL trước exported flows. Regression RED riêng cho readiness chờ đổi thẻ, DOB Date lọt PIN ngày sinh, blank/terminated chip và initial sync chặn luồng Step-up của khoản pending. Sau sửa, focused Mongo 19 PASS; focused unit/regression 63 PASS gồm 9 unit mới. Có test thật rollback callback rồi một request khác thắng, bảo đảm lần callback thất bại không để lại notification/PIN.

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–10 (147 hồi quy + 9 mới) | 156 | 0 | 0 |
| E2E giao thức jCardSim thật | 5 | 0 | 0 |
| MongoDB/HTTP integration thật (145 hồi quy + 19 mới) | 164 | 0 | 0 |
| Edge thật UI/API/MongoRS/jCardSim | 22 | 0 | 0 |
| Chạy riêng thiếu TEST_DATABASE | 0 | 0 | 164 |

Coordinator chạy sau source freeze: `AGENT_URL=http://127.0.0.1:31999 npm test` đạt 161/161; `npm run test:integration` với Mongo test replica set đạt 164/164, có TTL Mongo thật. Không dùng lần SKIP thay integration PASS. Warning Moment bad-date của fixture Task 5 cũ vẫn được ghi nhận; không có lỗi mới hoặc skip bất ngờ khi cấu hình đủ.

19 integration mới kiểm quyền/freshness ở cả endpoint mới và API operation cũ, input/state/type, ciphertext/DOB, confirm lặp/đồng thời, rollback retry và secret scrub, mail sent/fail/không recipient, daily cap theo nhân viên và tất cả trạng thái cash, khoảng ngày Việt Nam gồm biên cuối/ngày sau, wallet pending, same-key và khác-key races qua nhiều card/staff, receipt giả/sai amount/counter/balance và recovery áp dụng một lần. Unit dùng doubles ở transport, không gọi đó là E2E hoặc browser thật.

Log trong workspace Superpowers ignored: `task-10-red-*.txt`, `task-10-green-db.txt`, `task-10-green-ui.txt`, `task-10-report.md`, `task-10-root-unit-e2e.log`, `task-10-root-integration.log`, `task-10-root-integration-skip.log`, `task-10-browser-proof-final.log` và các artifact review.

## Edge và jCardSim thật

**REAL:** Edge 157 headless profile riêng, account/detail Pug và route/controller/middleware/API thật, MongoDB test replica set và Card Agent/jCardSim thật. Setup dùng admin fixture slot 0; khách fixture slot 1 được INIT, đổi PIN, ghi/commit hồ sơ và JPEG 6.080 byte có chữ ký, ghi một vé. Không chạy lại form phát hành/Cloudinary/SMTP Task 7; các APDU reset/PIN sai/CREDIT chỉ tác động thẻ sim.

Đã sai PIN thật 5 lần đến hết lượt và nhận `6983`; Reset PIN qua giao diện/ký escrow/APDU/confirm thành công, PIN mạnh hiện một lần, tries trở lại 5 và mustChangePin=1. Đóng modal xóa PIN; confirm lặp không trả PIN/gửi mail lại. Đổi PIN mới trên chip rồi đọc lại hồ sơ, ảnh, vé, ví. Reset thêm một lần sau khi ví đã có 500.000đ vẫn giữ nguyên tiền, hồ sơ, JPEG và vé.

Nạp 500.000đ: Step-up hết hạn yêu cầu staff PIN và chữ ký thật, chưa tạo cash trước xác thực. Sau accept, CDP làm lỗi transport Agent để giữ đúng một row pending-card, balance server vẫn 0. Thử lại với pending và Step-up stale vẫn xác thực được trước khi ký CREDIT. Tiếp theo CREDIT thật thành công nhưng CDP chặn request confirm trước backend: chip=500.000, server=0, Tx sent. Nút đối chiếu dùng GET_RECEIPT thật khôi phục Tx done, server=chip=500.000, chỉ một cash row; replay key không nạp thêm. Không uncaught JavaScript exception.

Step-up stale dùng JWT fixture có timestamp quá 5 phút, không đợi đồng hồ thực 5 phút. Fixture bỏ script/CDN nghiệp vụ không liên quan, giữ CardClient/CardAdmin/account. Mất Agent/confirm được điều khiển qua CDP, không mock APDU hoặc giả receipt.

**Email: MOCK**, gồm trả sent/fail/throw/reject trong integration và hai lần failed rõ ràng trong Edge. **SMTP REAL: NOT_RUN**; không tuyên bố đã gửi PIN thật. Cloudinary không dùng trong Task 10, REAL NOT_RUN.

## Review độc lập

**Spec PASS / Quality Approved / SecurityApproved**, không Critical/Important trong Task 10. Hai reviewer đọc frozen diff, rulings, các kiểm tra cross-boundary có tên và log; không tự chạy lại DB/Agent. Artifact task-10-spec-review.md và task-10-security-review.md trong workspace Superpowers ignored.

Một Minor không chặn: mốc tính ngày hạn mức và createdAt tự sinh là hai lần đọc đồng hồ; request đi qua nửa đêm có thể không thống nhất ngày tính/ghi nhận hoặc bị từ chối không cần thiết. Chưa chứng minh vượt cap nhờ Account lock tuần tự hóa cùng staff. Ghi nhận DEFERRED, nên dùng chung acceptedAt mỗi callback ở lần sửa phù hợp; không che giới hạn bằng các test biên đã PASS.

## An toàn dữ liệu và giới hạn

Chỉ database `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, replica set `travelTask4`, guard Task 3 xác minh tên DB/loopback/DATABASE/kết nối trước xóa. Không tải `.env`, không dùng admin chính hoặc dữ liệu tài chính website, không reset/drop DB dev/production. Khóa/dữ liệu là test; không log PIN/JWT/key/proof, không đưa PIN vào storage/URL.

Sau kiểm thử đã cleanup fixture qua guard và dừng đúng replica set do phiên này chạy: cổng 27018 ECONNREFUSED, MongoDB 27017 read-only hello vẫn OK, Agent 31999 HTTP200 được giữ chạy, Edge profile test đóng. Hash .env, package.json/yarn.lock và hai Gradle UTF-8 không đổi; không commit profile/log/khóa.

- RESET_PIN không có signed receipt trong giao thức: backend vẫn dùng authorized prepared/challenge/card-state/SW ACK của Task 5. Một ACK browser riêng không chứng minh chip đã reset; bằng chứng chip ở phép kiểm jCardSim thật phía trên.
- Có crash window sau commit trước mail/persist outcome hoặc trước response; chưa có outbox. Retry không phát lại PIN/mail; cần đối chiếu rồi thực hiện reset mới được xác thực nếu mất PIN.
- Intent cash chỉ giữ RAM. Reload phải đối chiếu ledger/sync trước khi nhận khoản mới; server giữ marker không TTL. Lỗi validation/cap giữ intent đến reload, là giới hạn UX đã ghi nhận.
- Các Minor Task 7–9 tiếp tục được theo dõi; không mở rộng sang Task 11.
- Node thực tế 25.9.0; Node 26, thẻ vật lý/PCSC, trình duyệt khác, toàn bộ trang website và production chưa kiểm chứng.

Commit message: `feat(card): admin PIN reset via escrow and cash top-up`; tra hash bằng `git log -1 --format=%H -- test/integration/card-admin-ops.test.js`. Không push/merge; dừng trước Task 11.
