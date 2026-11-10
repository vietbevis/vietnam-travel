# Plan 03 — Task 11: Cập nhật hồ sơ/ảnh và cấp lại thẻ

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`, BASE `86fcde8c5abd70f0cfbabd969892093def27e047`. Chỉ Task 11; không triển khai Task 12.

## Chức năng và file

- `controllers/admin/card.controller.js`, `routes/admin/card.route.js`, `validates/admin/card.validate.js`: POST `/admin/card/profile/build` kiểm quyền `card-edit`, chỉ thẻ khách active/current với Customer active. Strict allowlist chín trường TLV, ngày hợp lệ, tổng hồ sơ ≤448 byte; kiểm JPEG ≤10.080 byte ở backend. Tạo commit-write riêng cho hồ sơ/ảnh, không đổi Customer lúc build. `params.customerUpdate` chỉ áp dụng khi operation tương ứng được confirm thành công; ảnh cập nhật avatar theo cùng nguyên tắc.
- `helpers/card-op.helper.js`, `models/card.model.js`: ràng buộc operation mới nhất theo từng vùng hồ sơ/ảnh để confirm cũ không ghi đè bản mới; vẫn kiểm TLV khớp Customer chuẩn cộng thay đổi dự kiến. Replay HTTP confirm đã ghi nhận kiểm actor/policy và không cấp lại APDU. Metadata `Card.replacement` giữ actor, lý do, đích và mốc hoàn tất bền để ngăn dùng lại nguồn cấp vốn lần hai.
- POST `/admin/card/replace` cần `card-issue` + `card-revoke` + Step-up canonical trong 5 phút, bắt buộc lý do. Thẻ nguồn bị revoked/noncurrent ngay, ghi `revokedReason=replaced`, giữ tiền đến finish; không hoàn tiền mặt. Prepare/recover/finish kiểm lại quyền/Step-up, owner/type/actor/target. Omit hoặc giả `replaceOf` không vượt qua nghĩa vụ thẻ nguồn. Pending/sent và lệnh đã ký chưa đối soát chặn cấp lại; không xóa transaction hoặc receipt marker để bỏ qua.
- `issueFinish` dùng cùng transaction MongoDB để kích hoạt thẻ mới, hoàn tất claim, đưa số dư nguồn về 0, tạo debit transfer done và credit transfer pending-card, cập nhật vé và audit. Thẻ mới vẫn balance=0, counter không tự tăng; CREDIT receipt đúng thẻ mới settlement. Không tạo giao dịch 0đ. Chỉ vé written chưa dùng/chưa check-in, đơn paid còn hợp lệ, payload đúng và ngày khởi hành chưa qua theo Việt Nam được chuyển pending. Không hồi sinh vé đã dùng/hủy/quá hạn/sai dữ liệu.
- `public/admin/assets/js/card-admin.js`, `views/admin/pages/card-detail.pug`, `views/admin/pages/card-issue.pug`: form sửa hồ sơ, preview/crop/nén ảnh, PIN khách, kết quả riêng từng operation và reload dữ liệu đã xác nhận. Cấp lại có xác nhận, Step-up và luồng phát hành với nguồn/chủ thẻ/loại thẻ bị khóa từ server; chủ nguồn luôn có trong lựa chọn kể cả ngoài 500 bản ghi đầu. Có đường dẫn tiếp tục từ nguồn revoked. PIN chỉ hiển thị một lần rồi xóa, không storage. Staff replacement giữ `cardRequired` và JWT thẻ cũ bị backend từ chối.
- Tạo `test/card-profile-replace-ui.test.js`, `test/integration/card-replace.test.js`; cập nhật HANDOFF, checklist Task 11 và báo cáo này. Không đổi dependency, `.env`, Gradle, Applet hoặc giao thức APDU.

## TDD và kiểm thử

RED ban đầu 7 bài Mongo thất bại do endpoint chưa có; UI RED do chưa có flow; RED riêng confirm cùng trường đến muộn trước khi có latest-target binding. Sau triển khai tập trung 14 PASS. Edge phát hiện GET issue thiếu `replaceSource` trong render locals: thêm hai HTTP/Pug test RED, sửa và focused GREEN 16/16 (13 Mongo +3 unit). Không sửa test để bỏ validation/giao thức. Review phát hiện thiếu audit build/rejection: thêm ba test RED, bổ sung audit whitelist và message tiếng Việt; focused GREEN cuối 19/19 (16 Mongo +3 unit).

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–11 | 159 | 0 | 0 |
| E2E giao thức jCardSim thật | 5 | 0 | 0 |
| MongoDB/HTTP integration thật | 180 | 0 | 0 |
| Edge thật với API/MongoRS/jCardSim | 25 | 0 | 0 |
| Chạy riêng khi thiếu TEST_DATABASE | 0 | 0 | 180 |

Các con số được đối chiếu với log cuối trước commit. `AGENT_URL=http://127.0.0.1:31999 npm test`; `npm run test:integration` trên replica set test. Guard DB được hồi quy với thiếu/sai TEST_DATABASE, trùng DATABASE, thay đổi cấu hình/kết nối và kiểm trước mỗi lần xóa. Không dùng SKIP làm bằng chứng integration thành công. Warning Moment `bad-date` từ fixture Task 5 cũ vẫn xuất hiện; đã ghi nhận từ các task trước, không có FAIL hoặc SKIP bất ngờ khi cấu hình đủ.

## Edge và jCardSim thật

**REAL:** Edge 157 headless profile test riêng, Express/auth/controller/Pug/CardClient thật, MongoDB replica set test và Agent `--sim`. Setup thẻ khách slot 0 có hồ sơ/JPEG/vé và CREDIT receipt thực 700.000đ; admin fixture đăng nhập bằng thẻ nhân viên slot 2. Thẻ mới slot 1 được phát hành qua form thật. Không dùng admin chính hoặc dữ liệu website.

25 kiểm tra PASS: UI ghi SĐT/ảnh, CDP tạm giữ confirm để kiểm Customer còn dữ liệu cũ, sau đó đối chiếu TLV/JPEG đọc từ chip; ví/vé không mất. API trực tiếp thiếu card-edit bị từ chối. Step-up stale JWT fixture yêu cầu PIN/chữ ký thật trước thu hồi. Nguồn revoked giữ 700.000đ trước finish; finish tạo đúng một debit done/credit pending 700.000đ, nguồn về 0 và đích vẫn 0. Chỉ vé hợp lệ chuyển pending, vé used giữ nguyên. PIN ban đầu mạnh, mustChangePin và xóa dialog/storage được kiểm tra; đổi PIN trên chip mới trước đồng bộ tài chính.

CDP ngắt transport Agent sau INIT thật trong lần phát hành thay thế đầu: server cancel successor thành failed/noncurrent, nguồn vẫn revoked giữ đủ 700.000đ, Customer.avatar chưa đổi và không có transfer. INFO chip phát hành dở vẫn ACTIVE, không giả định đã reset vật lý. Chỉ sau reset sim slot 1 rõ ràng và kiểm CREATED mới phát hành lại thành công từ cùng nguồn.

CDP chặn request confirm trước backend sau CREDIT APDU thật: chip mới 700.000đ, server 0, Tx sent. Đồng bộ lại dùng GET_RECEIPT thực, server=chip=700.000đ, chỉ hai row transfer của một lần chuyển. Vé hợp lệ được ghi lại đúng một lần lên chip mới; vé used không được hồi sinh. Hai HTTP finish đồng thời trả alreadyFinished, không thêm transfer/thẻ current. Quay lại slot 0 và bấm đồng bộ: chip thực chuyển TERMINATED `7F`, VERIFY_PIN không còn thành công. Không uncaught JavaScript exception.

Hết hạn Step-up dùng JWT fixture có timestamp quá 5 phút, không đợi đồng hồ thực 5 phút. Mất confirm dùng CDP điều khiển lỗi transport; APDU, chữ ký và receipt không mock. Fixture bỏ script/CDN nghiệp vụ không liên quan, không phải hồi quy toàn website. Integration có chữ ký RSA fixture, chỉ browser/E2E mới là bằng chứng Agent thực.

**Cloudinary: MOCK; REAL NOT_RUN. SMTP: MOCK; REAL NOT_RUN.** Browser upload ba lần qua adapter giả có kiểm giới hạn bytes; mail trả thất bại rõ ràng. Không tuyên bố đã upload/gửi PIN ra dịch vụ thật. Unit flow dùng transport doubles và không tính là browser thật.

## Review độc lập

Review đầu: SecurityApproved; Spec FAIL / Quality Needs fixes do thiếu audit profile-build và rejection replacement. Fix 1 về source binding UI đã CLOSED. Sau vòng sửa audit RED → GREEN, scoped re-review xác nhận tất cả finding ADDRESSED: **Spec PASS / Quality Approved / SecurityApproved**, không Critical/Important hoặc Minor mới còn mở. Hai reviewer độc lập đối chiếu frozen diff và delta, không tự chạy lại suite/DB/Agent. Các Minor trước Task 11 vẫn được theo dõi.

Artifacts Superpowers ignored: task-11-spec-review.md, task-11-security-review.md, task-11-spec-rereview.md, task-11-security-rereview.md; log task-11-root-unit-e2e-final.log, task-11-root-integration-final.log, task-11-root-integration-skip.log và task-11-browser-proof-final.log. Lần đầu harness dùng nhầm tên response thay responseHex và chờ PIN không có trong signed sync; đã sửa harness, không đổi giao thức hay code sản phẩm để né lỗi.

## An toàn và giới hạn

Chỉ `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, replica set `travelTask4`, đi qua guard Task 3. Không tải/sửa `.env`, không reset/drop DB dev/production. Chỉ reset thẻ sim fixture slot 0/1/2; khóa và dữ liệu là test, không log PIN/JWT/proof/key. Hash `.env`, package.json/yarn.lock và hai Gradle UTF-8 được so sánh trước/sau. Không commit log/profile test hoặc khóa.

Sau kiểm thử đã cleanup fixture bằng guard, shutdown đúng replica set test do phiên này khởi chạy: 27018 ECONNREFUSED; MongoDB 27017 chỉ đọc hello vẫn OK; Agent 31999 HTTP200 được giữ chạy; Edge profile test đã đóng. Không xóa dữ liệu website.

- A7 hiện dành cho thẻ khách theo contract `CustomerUpdate`; không sửa hồ sơ AccountAdmin qua endpoint này. Cấp lại thẻ nhân viên có integration riêng, `cardRequired` và token cũ được kiểm backend; chưa chạy lại toàn bộ luồng cấp lại nhân viên bằng Edge.
- COMMIT_WRITE không có signed receipt trong giao thức. SW/ACK từ browser riêng không phải chứng minh mật mã rằng chip đã ghi; bằng chứng chip được kiểm thực trong Edge/jCardSim. Unknown confirm giữ Customer cũ, phải đối chiếu/rebuild/ghi lại rõ ràng. Hồ sơ và ảnh có thể thành công từng phần; UI không tuyên bố atomic chung.
- Nguồn đã revoked không tự được khôi phục nếu phát hành mới gián đoạn. Cancel/expiry giữ nguồn và tiền để tiếp tục cấp lại sau xác thực, reset sim chỉ khi chủ động trong test. Thẻ cũ offline chưa coi là đã TERMINATED cho tới khi đồng bộ.
- Form phát hành mở quá 5 phút có thể bị từ chối prepare/finish; fail-closed giữ nguồn tiền, cần xác thực nhân viên và tiếp tục từ thẻ nguồn. GET nguồn stale có thể trả JSON yêu cầu Step-up; chưa có UX đổi qua lại thẻ tự động cho riêng finish.
- Upload ngoài transaction có thể để lại Cloudinary asset mồ côi khi hủy/lỗi. Mail sau commit còn crash window, chưa có outbox; không phát lại PIN qua retry. Các Minor Task 7–10 tiếp tục theo dõi, không mở rộng task.
- Node thực tế 25.9.0; Node 26 **NOT_RUN**, chưa kết luận tương thích runtime này. Chưa kiểm thẻ vật lý/PCSC, trình duyệt khác, toàn website hoặc production.

Commit message: `feat(card): on-card profile/photo update and card replacement`; tra hash bằng `git log -1 --format=%H -- test/integration/card-replace.test.js`. Không push/merge; dừng trước Task 12.
