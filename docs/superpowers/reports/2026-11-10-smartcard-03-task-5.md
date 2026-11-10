# Plan 03 — Task 5: Card Operation Engine, Sync Planner và API

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`.
BASE `dd73d217aa8801248896f19bb1350cd5f784d704`.

## Phạm vi

Chỉ Task 5: tạo engine operation, planner thuần, chọn item vé, năm endpoint `/card-api` và mount trước setting/category middleware. Không triển khai giao diện/card-client hoặc Task 6.

Các interface: createOp, signOp, confirmOp, applyReceipt, planNextSync, loadSyncContext. Dùng crypto/APDU helper Task 1, model/guard/log Task 3 và settlement Task 4; không thêm dependency hoặc đổi giao thức Java Card.

## Quyết định về an toàn

- Spec chỉ có draft/prepared/done/failed, khác bước confirming trong plan: claim prepared→done và tất cả hiệu ứng cùng transaction; thất bại rollback. Không thêm trạng thái ngoài spec.
- Cập nhật Card/Transaction/Operation/Order/Customer phải cùng session. Cho phép thay đổi tối thiểu helper thanh toán để tái sử dụng settlement trong session mà giữ interface hai tham số hiện có.
- System operation phải đúng một quyết định sync còn hợp lệ của server; không dùng system để ký debit, reset PIN, use-ticket hay sửa hồ sơ. Actor generic lấy từ JWT đã kiểm và quan hệ/quyền trong DB, không từ body.
- Review SE-01 phát hiện public auto-credit với challenge tùy ý có thể giữ ví chưa đối soát vĩnh viễn. Vì vậy sync state/receipt vẫn public; cấp chữ ký credit/ghi/xóa vé cần đúng current owner hoặc admin có quyền, và operation được bind actor để confirm không bị người khác ACK giả. Anonymous next trả step:null/requiresAuth, không tạo operation hay authorization. Sau đăng nhập phải chạy lại sync để xử lý các bước này. Đây là thu hẹp cố ý phần public auto-credit của spec theo yêu cầu chống vượt quyền/replay; không thêm flow đăng nhập của Task 12.
- Card state/SW do trình duyệt báo không phải bằng chứng mật mã. Chỉ receipt có chữ ký đúng public key của thẻ và đầy đủ ràng buộc mới áp dụng tiền/đơn hàng.
- Applet Wallet không tự loại txRef trùng: thêm signedOpId/signedAt bền trên CardTransaction, không cấp lại chữ ký tiền cho transaction đã ký dù operation hết TTL hoặc client báo SW lỗi. Marker ghi cùng transaction và chặn nhiều lệnh ví chưa đối soát trên một thẻ.
- Credit SW lỗi vẫn pending-card, debit chỉ bốn SW trong plan mới failed; GET_RECEIPT 6A88 failed nhưng không xóa khả năng nhận receipt hợp lệ đến muộn. Nếu không có receipt để xác minh, cần đối soát thủ công; không tự ký lại credit trên bằng chứng SW không có chữ ký.
- PIN rõ chỉ trong RAM; payload reset được mã hóa escrow trước lưu operation. Không log PIN/key hoặc trả lỗi nội bộ có thông tin nhạy cảm.

Các điều chỉnh file ngoài danh sách chính: helper thanh toán (session chung), CardTransaction (hai marker chống re-sign) và `index.js` (handler lỗi JSON chỉ cho `/card-api`). Parser JSON toàn app chạy trước router, nên cần error boundary tại app để không trả HTML/log lỗi thô khi JSON sai. Không thay model operation, applet hay format APDU.

## Môi trường kiểm thử

MongoDB website cổng 27017 được giữ nguyên. Phiên này khởi chạy lại riêng replica set test `travelTask4` cổng 27018 bằng binary đã có, dbpath test được Git ignore. URI `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, qua guard Task 3. Không tải `.env` vào test, không reset/drop DB dev/production. Card Agent thật tại 31999, sim slot 0; E2E do coordinator chạy riêng, không tranh chấp slot.

Node thực tế 25.9.0; Node 26 runtime chưa kiểm chứng. Không cài thư viện/công cụ mới hoặc gửi email thật trong kiểm thử.

Sau kiểm thử đã dọn fixture bằng guard trong đúng DB test và dừng riêng tiến trình replica set 27018 do phiên này khởi chạy; giữ các file test trong workspace ignored. MongoDB đang có ở 27017 vẫn kết nối được và không bị dừng/reset.

Sau kiểm thử đã dọn fixture bằng guard trong đúng DB test và dừng riêng tiến trình replica set 27018 do phiên này khởi chạy; giữ các file test trong workspace ignored. MongoDB đang có ở 27017 vẫn kết nối được và không bị dừng/reset.

## Kiểm thử và review

TDD trước implementation: 9 planner FAIL và 15 integration FAIL vì thiếu module/engine. Các test mở rộng đã quan sát RED riêng cho quyền/system policy, cardTxRef, parser JSON, staff/isCurrent và response contract; sau sửa chuyển GREEN. Phép kiểm live đầu tiên phát hiện confirm thiếu `code`, đã bổ sung test RED và sửa envelope thay vì hạ điều kiện kiểm.

| Nhóm kiểm thử | PASS | FAIL | SKIP | Bằng chứng |
|---|---:|---:|---:|---|
| Unit Task 1–5 | 89 | 0 | 0 | Gồm 12 test planner/guard mới |
| E2E giao thức Task 2 | 5 | 0 | 0 | Card Agent/jCardSim thật, reset slot từng bài |
| Full MongoDB/HTTP integration | 78 | 0 | 0 | 8 Task 3 + 15 Task 4 + 55 Task 5, replica set test thật |
| Integration thiếu TEST_DATABASE | 0 | 0 | 78 | Không kết nối/xóa DB |
| Luồng engine + HTTP sync + jCardSim thật | 1 | 0 | 0 | Phép kiểm bổ sung riêng, không cộng vào suite trên |

Coordinator chạy lại sau fix round 1: `npm.cmd test` có AGENT_URL **94 PASS / 0 FAIL / 0 SKIP**; `npm.cmd run test:integration` trên replica set **78 PASS / 0 FAIL / 0 SKIP**, gồm TTL thật. Các log được giữ trong workspace ignored Superpowers; test suite DB chạy tuần tự qua script Task 4.

55 integration Task 5 kiểm: chữ ký đúng/sai và sai type/card/txRef/amount/balance/counter; double confirm; hai op cùng tx và hai tx cùng card tranh ký; actor khác; source/order/cardTxRef; rollback signer và rollback năm collection khi settlement lỗi; expiry và op bị TTL xóa không cho re-sign; SW debit matrix và 6A88 rồi receipt đến muộn; system policy được kiểm lại; staff/type/owner sai; ciphertext reset và cleanup; payload/effect vé/profile; API JWT/quyền/step-up/cardRequired, Origin/input/JSON lỗi và envelope. Test sau review kiểm anonymous fake challenge không tạo authorization, binding actor, public state/recovery, quyền admin hiện tại, issuer chỉ có card-issue, DOB Date, profile bỏ customerUpdate, candidate vé lỗi và audit cardId/duplicate.

**Phép kiểm live bổ sung sau fix:** dùng khóa fixture, INIT thẻ sim trắng và lưu modulus do jCardSim trả về. Anonymous sync không cấp authorization; sync với JWT fixture đúng chủ ký CREDIT 700.000đ, gửi APDU qua Agent thật và confirm receipt. Tiếp theo ký DEBIT 200.000đ cho đơn fixture nhưng cố ý bỏ confirm; sync ưu tiên GET_RECEIPT và khôi phục qua HTTP `/sync/receipt` không cần cookie. Kết quả Card.balance 500.000đ, counter 2, Order paid, Customer.totalSpent 200.000đ, vé pending. Gửi lại receipt không tăng chi tiêu. Đây là engine + MongoDB replica set + HTTP sync API + APDU/jCardSim thật, không mock giao thức. Chưa phải luồng giao diện trình duyệt hoặc thanh toán cổng thật.

Review lần đầu: spec PASS, chất lượng và bảo mật ChangesRequested. Đã sửa SE-01 (anonymous challenge làm giữ ví) và Q-01 (settlement core bị lặp); đồng thời sửa audit thiếu cardId/recovery, candidate vé lỗi che sibling, định dạng code và kiểm TLV khi customerUpdate bị bỏ trống. Mỗi lỗi logic có test RED trước fix. Round 1: 45 PASS/5 FAIL trước sửa, thêm RED riêng cho issuer chỉ có card-issue và DOB Date; focused cuối 82 PASS gồm 55 Task 5 integration, 15 payment regression và 12 planner.

Re-review độc lập `/root/task5_spec_review`: **Spec PASS / Quality Approved**, Q-01 và các minor ADDRESSED. `/root/task5_security_review`: **SE-01 ADDRESSED / SecurityApproved**. Không còn Critical/Important; không có finding bị bỏ qua để commit. Reviewer đọc code/diff và bằng chứng, không tự chạy lại Mongo/E2E hoặc thay source.

## File tạo/sửa

- Tạo: `helpers/card-op.helper.js`, `helpers/card-sync.helper.js`, `helpers/ticket.helper.js`.
- Tạo: `controllers/client/card-api.controller.js`, `routes/client/card-api.route.js`.
- Tạo: `test/card-sync.test.js`, `test/integration/card-op.test.js`.
- Sửa: `routes/client/index.route.js`, `helpers/order-payment.helper.js`, `models/card-transaction.model.js`, `index.js` với các thay đổi tối thiểu đã giải thích ở trên.
- Cập nhật HANDOFF, checklist Task 5 của Plan 03 và báo cáo này. Hai Gradle UTF-8, `.env`, dependencies và các task khác giữ nguyên.

## Giới hạn

- Simulator không chứng minh an toàn phần cứng. Task 5 chưa phải luồng trình duyệt/thẻ/thanh toán hoàn chỉnh của các task sau.
- APDU không phải receipt ví không có phản hồi ký xác minh; confirm loại này chỉ là ACK có kiểm quyền và policy server, không phải chứng cứ phần cứng.
- Không coi operation TTL là kiểm hết hạn nghiệp vụ; backend phải kiểm expireAt tại mỗi request.
- Chỉ commit Task 5, không push/merge hoặc tự chuyển Task 6.

Commit message: `feat(card): signed card operation engine and sync planner`. Tra commit chứa báo cáo bằng `git log -1 --format=%H -- helpers/card-op.helper.js`. Kiểm tra cuối xác nhận đúng 14 file Task 5/tài liệu, `.env`, package/dependencies, hai Gradle và các checklist Task 1–4/6–16 giữ nguyên; controller thanh toán hiện có không đổi.

Commit message: `feat(card): signed card operation engine and sync planner`. Tra commit chứa báo cáo bằng `git log -1 --format=%H -- helpers/card-op.helper.js`. Kiểm tra cuối xác nhận đúng 14 file Task 5/tài liệu, `.env`, package/dependencies, hai Gradle và các checklist Task 1–4/6–16 giữ nguyên; controller thanh toán hiện có không đổi.
