# Plan 03 — Task 6: Browser Card Client và PIN Modal

Ngày 2026-11-10. Workspace `D:\vietnam-travel`, branch `feature/smartcard`.
BASE `425f1d1bdc5f694d6cb4e1b40994f0e1f4c04cbb`.

## Phạm vi và file

Chỉ Task 6, không triển khai Task 7. Bốn file mới:

- `public/assets/js/card/card-client.js`: UMD, dùng CardShared của Task 1, xuất Node module và `window.cardClient`.
- `views/admin/partials/card-pin-modal.pug` và `views/client/partials/card-pin-modal.pug`: hộp PIN native dialog.
- `test/card-client.test.js`: unit, giao thức qua transport giả, DOM fixture và render Pug.

Hai layout `views/admin/layouts/default.pug`, `views/client/layouts/default.pug` thêm modal và cấu hình Agent → Shared → Client. Ba tài liệu cập nhật gồm báo cáo này, HANDOFF và checklist Task 6. Không đổi backend, dependency, `.env`, applet hoặc hai chỉnh sửa Gradle UTF-8 có sẵn.

## Chức năng và ràng buộc

Đủ interface `status`, `transmit`, `cmd`, `openSession`, `verifyPin`, `changePin`, `getChallenge`, `runSignedOp`, `writeTarget`, `readTarget`, `readProfile`, `readPhotoUrl`, `readBalance`, `readTxLog`, `readTickets`, `authenticate`, `askPin`. Client khởi tạo lười, không gọi Agent khi nạp trang. Thêm `dispose()` để chủ động giải phóng tài nguyên.

- SELECT/INFO rồi sync tối đa 10 vòng; kết thúc khi step null hoặc thẻ terminate, từ chối vòng thứ 11 bằng SYNC_LOOP. Tôn trọng requiresAuth của Task 5; thẻ chưa đổi PIN chỉ sync public state/receipt.
- Signed operation giữ thứ tự challenge → sign → APDU → confirm. Forward response/SW thật kể cả SW lỗi trước khi ném CardError. Lỗi kết nối không giả lập SW hoặc tự gửi lại APDU tiền; backend giữ khả năng recovery receipt.
- Queue chung trong module tuần tự hóa các luồng composite giữa nhiều client cùng JS realm. Đọc/ghi theo giới hạn giao thức, chunk 224 byte; parser kiểm độ dài dữ liệu.
- Cấu hình Agent qua data attribute được Pug escape và script tĩnh, không nội suy JavaScript. Agent chỉ loopback HTTP(S), không credentials/query/hash. Backend cùng origin; trường xác thực từ thẻ không bị body ghi đè.
- Modal có password/numeric/maxlength 6, label/status, confirm/cancel/Escape, focus và xóa input/listener sau sử dụng. Hủy trả PIN_CANCELLED; chặn định dạng sai và PIN mới yếu bằng CardShared. Không log/lưu PIN vào storage hoặc URL.
- Quản lý một blob URL ảnh mỗi client, thu hồi khi thay ảnh, đổi phiên, lỗi, pagehide hoặc dispose.

## Kiểm thử và review

TDD ban đầu: 31 FAIL do thiếu client và tích hợp layout, sau đó GREEN. Regression queue nhiều instance có RED trước sửa. Review độc lập phát hiện hai Important: pagehide dispose terminal làm client không dùng lại được sau BFCache; close event bất đồng bộ cũ hủy nhầm prompt PIN vừa mở. Vòng sửa thêm ba test: 36 PASS/3 FAIL → 39 PASS/0 FAIL.

Sửa vòng đời bằng suspend/resume cùng instance, generation hủy continuation/queued work cũ, abort và giải phóng request/PIN/blob khi hide. Không tự fetch, retry APDU hoặc confirm muộn sau restore. Dispose tường minh vẫn terminal. Close handler bỏ qua event cũ nếu dialog đã mở lại. Các test kiểm cả transport và response.json trả muộn, cùng reference global và sử dụng lại sau restore.

Kết quả kiểm thử cuối trên source sau sửa:

| Nhóm | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Unit Task 1–6, gồm 39 test client mới | 128 | 0 | 0 |
| E2E giao thức Card Agent/jCardSim thật, reset slot 0 mỗi test | 5 | 0 | 0 |
| MongoDB/HTTP integration thật trên replica set test | 78 | 0 | 0 |
| Kiểm riêng khi không có TEST_DATABASE | 0 | 0 | 78 |
| Edge thật: layout, native PIN, Agent/API/Mongo, blob và SW lỗi | 17 | 0 | 0 |
| Edge thật: chuỗi native close và lifecycle với sự kiện tổng hợp | 2 | 0 | 0 |

Lệnh `AGENT_URL=http://127.0.0.1:31999 npm test` đạt 133/133; `npm run test:integration` với TEST_DATABASE test cổng 27018 đạt 78/78. Integration đã chạy thật, có TTL được Mongo xóa và guard từ chối môi trường đổi trước xóa. Không cộng lần chạy SKIP vào bằng chứng integration PASS. Log `task-6-root-unit-e2e-final.log`, `task-6-root-integration-final.log`, `task-6-root-integration-skip.log`, `task-6-browser-proof-final.log`, `task-6-native-red.log`, `task-6-native-green.log` nằm trong `.superpowers/sdd/2026-11-04-smartcard-03-web/` (Git ignore).

Hai regression Edge ban đầu trả `promptChain=PIN_CANCELLED`, `bfcacheLifecycle=CLIENT_DISPOSED`; sau sửa prompt thứ hai vẫn mở và client restored nhận hủy bình thường PIN_CANCELLED. Phép lifecycle dùng PageTransitionEvent tổng hợp trong browser thật, chưa chứng minh một lần history Back/Forward có BFCache persisted thực tế. Test native dialog close dùng sự kiện native thực.

Review độc lập: lượt đầu Spec FAIL / Quality Changes Requested, hai Important, không Critical; Security Approved trong phạm vi rà soát. Sau một vòng sửa, cả hai ADDRESSED; re-review Spec PASS / Quality Approved / Security Approved trong delta, không finding mới hoặc finding mở. Artifact `task-6-review.md` và `task-6-rereview.md`. Coordinator chạy lại toàn bộ suite và browser proof sau source stable; không coi test transport giả là bằng chứng Agent/database thật.

Review độc lập: lượt đầu Spec FAIL / Quality Changes Requested, hai Important, không Critical; Security Approved trong phạm vi rà soát. Sau một vòng sửa, cả hai ADDRESSED; re-review Spec PASS / Quality Approved / Security Approved trong delta, không finding mới hoặc finding mở. Artifact `task-6-review.md` và `task-6-rereview.md`. Coordinator chạy lại toàn bộ suite và browser proof sau source stable; không coi test transport giả là bằng chứng Agent/database thật.

## Phạm vi bằng chứng và giới hạn

Kiểm tra trình duyệt dùng Edge headless thật với profile test riêng, CDP và native dialog; không chỉ render Pug/HTTP. Fixture server render hai layout thật nhưng bỏ script/CDN nghiệp vụ không liên quan; mount API thật, MongoDB test replica set và Card Agent jCardSim thật. Không chạy website bằng `.env` hoặc database phát triển. Phép kiểm này không thay thế hồi quy mọi trang kinh doanh hiện có.

Test MongoDB dùng riêng `mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test`, guard Task 3 xác minh tên DB, loopback, DATABASE và kết nối thực trước từng delete. Không drop/reset database website cổng 27017. Agent dùng slot 0 và khóa/dữ liệu test.

Sau kiểm thử, fixture DB test được cleanup qua guard; replica set test do phiên này chạy đã shutdown (mongod exit 0, cổng 27018 ECONNREFUSED). Lệnh shutdown làm socket reset; đã kiểm log/process/cổng để xác nhận dừng thật. Read-only hello MongoDB 27017 vẫn OK, Agent 31999 HTTP 200 được giữ chạy; đóng riêng Edge profile test. Hash `.env`, package.json và cả hai Gradle UTF-8 không đổi. Không commit profile/log/khóa hoặc thay đổi Gradle có sẵn.

Node thực tế 25.9.0; chưa chạy Node 26 theo plan. Browser proof chỉ Edge, chưa kiểm Chrome/Firefox/Safari hoặc phần cứng PC/SC. Đồng bộ nhiều tab không có lock chung; queue chỉ trong cùng JS realm. Kiểm PIN yếu theo ngày sinh cần caller cung cấp DOB qua tham số tùy chọn thứ ba của changePin; không tự lấy hoặc bịa ngày sinh. Chưa kiểm thanh toán gateway sandbox, SMTP hay chấp nhận production trong Task 6.
