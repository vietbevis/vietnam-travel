# Bàn giao: Thẻ Thành viên Du lịch (Java Card)

Tài liệu này dành cho thành viên nhận tiếp phần còn lại của dự án. Ngày lập: 2026-11-06, cập nhật 2026-11-11. Nhánh làm việc: `feature/smartcard` (tách từ `main`).

Dự án là web du lịch Node/Express + Mongo + Pug (thanh toán ZaloPay/VNPay), được bổ sung tính năng thẻ thành viên Java Card. Đây là bài tập lớn: **chỉ cần thẻ ảo (jCardSim), không cần thẻ thật.**

## 1. Tóm tắt tình trạng

| Phần | Trạng thái | Ghi chú |
|---|---|---|
| Plan 01: Applet Java Card | **Xong** | 266 test pass, build được file CAP |
| Plan 02: Card Agent (cầu HTTP giữa trình duyệt và thẻ) | **Xong** | 30 test pass, chạy thử được chế độ sim |
| Plan 03: Web (server + giao diện) | **Xong cả 16 task; Task 1–12 đã rà soát lại và sửa** | 199 unit/E2E jCardSim + 289 Mongo/HTTP integration PASS (2026-11-11); nghiệm thu end-to-end trên Chrome 15 PASS + 1 NOT_RUN (cổng sandbox thật). Xem [báo cáo Task 13–16 và rà soát](reports/2026-11-11-smartcard-03-tasks-13-16-and-review.md) |

**Cập nhật 2026-11-10:** Task 1 Plan 03 đã bổ sung helper giao thức/mật mã, `CardShared`, test runner, keygen và cấu hình web tối thiểu. Review độc lập: Spec PASS / Quality Approved; không phát hiện vấn đề cần sửa. Xem [báo cáo Task 1](reports/2026-11-10-smartcard-03-task-1.md).

**Task 2 đã hoàn tất:** năm E2E giao thức thật qua Card Agent/jCardSim đạt PASS; tổng suite lúc hoàn tất Task 2 có agent là 51 PASS, không agent là 46 PASS/5 SKIP. Review phát hiện và đã sửa điều kiện `AGENT_URL` rỗng phải FAIL; re-review Spec PASS / Quality Approved. Xem [báo cáo Task 2](reports/2026-11-10-smartcard-03-task-2.md), gồm giới hạn Node 26 chưa chạy.

**Task 3 đã hoàn tất:** sáu model, chín quyền, log/tier/wallet helper và guard DB test đã triển khai; tổng suite có agent 70 PASS, Mongo test thật 8 PASS. Trang tạo quyền được kiểm HTTP 200 qua route/auth/controller/Pug thật với fixture DB test, đủ chín checkbox. Review Spec PASS / Quality Approved. Xem [báo cáo Task 3](reports/2026-11-10-smartcard-03-task-3.md). Không migration hoặc reset DB dev; chỉ dùng `vietnam-travel-smartcard-test`.

**Task 4 đã triển khai/kiểm thử và review:** tách helper ZaloPay/VNPay, bảo toàn chữ ký và redirect thành công; callback kiểm identity/amount/method/merchant/status. `markOrderPaid` CAS chống lặp; đơn có customerId cập nhật paid + chi tiêu + vé trong transaction. Full suite 82 PASS (77 unit + 5 E2E), full Mongo integration 23 PASS; bộ 15 test payment đã kiểm lại trên replica set và standalone. Review độc lập Spec PASS / Quality Approved, không có finding mở. Xem [báo cáo Task 4](reports/2026-11-10-smartcard-03-task-4.md).

**Task 5 đã triển khai/kiểm thử và review:** operation engine, planner thuần, chọn vé và năm API `/card-api`; 12 unit mới và 55 integration mới. Full suite 94 PASS (89 unit + 5 E2E), full integration 78 PASS. Phép kiểm engine + HTTP sync + Mongo replica set + jCardSim thật xác nhận debit mất confirm được GET_RECEIPT khôi phục, đơn paid/spend chỉ một lần. Review sau một vòng sửa: Spec PASS / Quality Approved / SecurityApproved. Xem [báo cáo Task 5](reports/2026-11-10-smartcard-03-task-5.md).

**Task 6 đã triển khai/kiểm thử:** UMD Browser Card Client đủ interface, sync tối đa 10 bước, signed APDU chuyển SW thật về backend, modal PIN an toàn, cấu hình escaped và quản lý blob/lifecycle. Thêm 39 test: full suite 133 PASS (128 unit + 5 E2E), integration thật 78 PASS. Edge headless thật PASS 17 mục với layout/API/Mongo test/jCardSim; hai regression lifecycle chuyển RED→GREEN. Chi tiết phạm vi và review trong [báo cáo Task 6](reports/2026-11-10-smartcard-03-task-6.md).

**Task 7 đã triển khai/kiểm thử, review Approved:** phát hành khách mới/khách cũ/nhân viên, sáu API admin, crop/compress/kiểm JPEG, danh sách Customer và menu theo quyền. Thêm 8 unit và 25 integration; full suite 141 PASS, Mongo test 103 PASS, Edge thật 19 mục PASS. Review đã sửa mất prepare response và bypass tài sản khi bỏ replaceOf; không còn Critical/Important, hai Minor được ghi nhận. Claim request bền chống replay/cancel đến muộn; requestId chỉ RAM browser, PIN mã hóa trong metadata riêng và được xóa khi kết thúc. Xem [báo cáo Task 7](reports/2026-11-10-smartcard-03-task-7.md).

**Task 8 đã triển khai/kiểm thử, review Approved:** login legacy giữ JWT/cookie, staff password → preToken → PIN/RSA proof, nonce single-use/expiry, middleware revalidate card/role, OTP reset không full-auth bypass và Step-up bound thẻ/account giữ exp cũ. Account layout/account.js có CardClient/PIN và đổi PIN lần đầu. Full 145 PASS (140 unit + 5 E2E), Mongo test 130 PASS, Edge thật 20 mục PASS, gồm token cũ sau lock/revoke và Step-up stale fixture rồi xác thực lại thật. Review không Critical/Important; một Minor định dạng và hai Minor Task 7 tiếp tục ghi nhận. Xem [báo cáo Task 8](reports/2026-11-10-smartcard-03-task-8.md).

**Task 9 đã triển khai/kiểm thử, review Approved:** danh sách/chi tiết thẻ, khóa/mở/thu hồi với refund và audit transaction, quyền/Step-up, log chỉ xem, sync đúng thẻ. Full 152 PASS (147 unit + 5 E2E), Mongo test thật 145 PASS, Edge thật 19 mục PASS xác nhận chip 03/02/7F và JWT cũ sau thu hồi nhân viên bị từ chối. Đã sửa Important public prepared set-state chặn revoke và hồi quy JWT lệch giây, không Critical/Important mở. Một Minor dữ liệu đang render cần reload sau revoke; giữ các Minor trước đó. Xem [báo cáo Task 9](reports/2026-11-10-smartcard-03-task-9.md).

**Task 10 đã triển khai/kiểm thử, review Approved:** reset PIN qua escrow, PIN chỉ trả confirm thắng lần đầu, scrub và mail outcome; cash pending/idempotency và cap theo nhân viên/ngày Việt Nam/ví, recovery receipt. Full 161 PASS (156 unit + 5 E2E), Mongo test thật 164 PASS, Edge thật 22 mục PASS, reset giữ ví 500.000đ/hồ sơ/ảnh/vé và lost-confirm cash không nạp trùng. Spec PASS / Quality Approved / SecurityApproved, không Critical/Important. Minor timestamp ngày/createdAt và UX giữ intent đến reload được ghi nhận; SMTP MOCK, REAL NOT_RUN. Xem [báo cáo Task 10](reports/2026-11-10-smartcard-03-task-10.md).

**Task 11 đã triển khai/kiểm thử và review:** sửa hồ sơ/ảnh Customer chỉ sau commit-write confirm, latest-target binding chặn ACK cũ, audit build/rejection; cấp lại bind nguồn/chủ/loại/actor với cả hai quyền và Step-up. Finish transaction giữ tiền nguồn đến lúc debit transfer done/credit pending, không credit server trước receipt; vé dùng/quá hạn không hồi sinh. Full 164 PASS (159 unit + 5 E2E), Mongo test thật 180 PASS, Edge thật 25 mục PASS: SĐT/JPEG đọc lại đúng, mất Agent sau INIT/cancel giữ nguồn 700.000đ, cấp lại slot 1, lost-confirm CREDIT rồi GET_RECEIPT đưa server=chip=700.000đ đúng một lần, vé ghi lại và chip cũ slot 0 TERMINATED 7F. Đã sửa source binding bị thiếu trong Pug và audit thiếu; kết quả review cuối ghi trong [báo cáo Task 11](reports/2026-11-10-smartcard-03-task-11.md). Cloudinary/SMTP MOCK, REAL NOT_RUN. Chỉ tiếp tục Task 12 khi được giao.

**Task 12 đã triển khai/kiểm thử và review:** khách đăng nhập bằng PIN/thẻ/RSA, nonce single-use và customerToken 1 ngày, revalidate owner/card mỗi request; tài khoản server/chip, profile ba trường confirm-only và OTP báo mất purpose riêng admin. OTP HMAC, expiry/attempt/quota bền, IP được kiểm trước email, transaction lock/consume/audit giữ ví và pending. PIN sinh nhật được kiểm DOB cục bộ khi chip cho phép đọc và buộc đổi mạnh trước AUTH, cả khi hủy rồi đăng nhập lại. Full 174 PASS (169 unit +5 E2E), Mongo test thật 202 PASS, Edge thật 26 mục PASS: chip/server 700.000đ sau lost-confirm receipt, sửa hồ sơ đúng, OTP sai/hết hạn/replay và JWT cũ sau lock bị từ chối, chip LOCK03. Spec PASS / Quality Approved / SecurityApproved, các Important đã sửa. Minor pending/history cần reload sau mismatch sync; SMTP/Cloudinary MOCK, REAL NOT_RUN. Xem [báo cáo Task 12](reports/2026-11-10-smartcard-03-task-12.md). Task 13–16 đã làm xong sau đó, xem đoạn dưới.

**Điều kiện vận hành:** MongoDB standalone hiện tại chỉ phục vụ settlement đơn legacy không customerId. Engine, phát hành và đơn gắn customerId cần replica set/transaction; standalone bị từ chối để tránh ghi một phần. Test dùng replica set cô lập cổng 27018, không đổi DB website. Cloudinary thiếu cấu hình; SMTP có cấu hình nhưng chưa có địa chỉ nhận thử, upload/delivery thật NOT_RUN (Task 7 dùng MOCK; Task 8 không cần dịch vụ này). Manual gateway sandbox, Node 26 runtime và thẻ thật chưa kiểm chứng. Browser proof render layout/route/API thật trong fixture test, bỏ script/CDN không liên quan; chưa hồi quy mọi trang nghiệp vụ. Ứng dụng ghi cảnh báo khi Mongo không phải replica set (không dừng app). Cấp lại qua Task 11 có claim/transfer riêng; phát hành thông thường không được bỏ replaceOf để vượt nghĩa vụ thẻ cũ.

**Task 13–16 và rà soát lại (2026-11-11):** đã làm thanh toán bằng ví thẻ + giảm giá theo hạng (13), nạp ví online ZaloPay/VNPay (14), vé điện tử/check-in/hủy đơn (15), dashboard + README "Chạy toàn hệ thống" + nghiệm thu toàn bộ (16). Sau đó toàn bộ Task 1–12 được review độc lập lại: sửa 1 lỗi nghiêm trọng (thẻ kẹt vĩnh viễn khi GET_RECEIPT trả 6A88) và 8 lỗi quan trọng (thanh toán cổng mất dấu vết, số điện thoại ZaloPay, nhật ký thao tác bị từ chối, thông báo thiếu quyền, mass-assignment form tài khoản admin, kiểm tra PIN ngày sinh, spam `/sync/next`, `requiresAuth`). Các lỗi nhỏ còn lại và 19 quyết định đã đưa ra nằm trong [báo cáo](reports/2026-11-11-smartcard-03-tasks-13-16-and-review.md). Bước tiếp theo: merge/PR vào `main` khi được duyệt.

**Lưu ý cho các task tiếp theo:** sync state/receipt vẫn public; ký credit/ghi/xóa vé cần current owner hoặc admin có quyền, operation bind actor. Anonymous sync trả `step:null, requiresAuth:true`; chạy lại sync sau đăng nhập. Transaction đã có `signedOpId/signedAt` nhưng chưa done cần recovery ngay cả status failed/pending-card; không xóa marker/cấp chữ ký tiền mới dựa SW hoặc TTL. Các luồng nạp/trả tiền/thu hồi/cấp lại/hủy đơn tương lai phải giữ quy tắc đối soát này. Khi không còn receipt hoặc đơn không còn khớp, cần xử lý thủ công, không tự tạo paid/balance.

## 2. Tài liệu cần đọc (theo thứ tự)

1. `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md`: đặc tả thiết kế, là nguồn chuẩn. Giao thức thẻ ở mục 3, API của agent ở mục 4, dữ liệu và quy tắc ở mục 5, cơ chế chung ở mục 6, luồng nghiệp vụ ở mục 7, kiểm thử ở mục 8.
2. `docs/superpowers/plans/2026-11-04-smartcard-03-web.md`: kế hoạch chi tiết cho phần còn lại, từng task có code mẫu và checklist.
3. `smartcard/README.md`: cách chạy test, dựng CAP, chạy agent.
4. Plan 01 và plan 02 trong `docs/superpowers/plans/` (đã xong, đọc khi cần hiểu lý do thiết kế).
5. `docs/superpowers/installed-tools.md`: danh sách mọi thứ đã cài thêm trên máy người làm trước.

## 3. Kiến trúc ngắn gọn

```
Applet (Java Card) ⇄ APDU/PC/SC ⇄ Card Agent (Java, 127.0.0.1:31999) ⇄ fetch ⇄ Trình duyệt ⇄ HTTPS ⇄ Node/Express + Mongo
```

- Trình duyệt không truy cập được PC/SC, nên cần Card Agent chạy trên máy người dùng.
- Agent và trình duyệt đều là tầng chuyển tiếp **không tin cậy**: mọi lệnh ghi lên thẻ phải do server ký và gắn với challenge của thẻ.
- Applet `vn.travel.card.TravelCardApplet` dùng RSA-1024, AES-128, SHA-256. Chi tiết trong spec mục 3.

## 4. Đã làm

### Plan 01: Applet (`smartcard/applet/`)
- Đầy đủ lệnh theo spec: PIN, ví, vé, nhật ký, hồ sơ và ảnh, xác thực server (M_cmd), biên nhận, TERMINATE an toàn khi mất điện.
- 266 test (JUnit 5 + jCardSim). File CAP dựng được (khoảng 49,7 KB) bằng JDK 17.
- `smartcard/test-vectors/vectors.json` và `server-test-key.pem` (khóa chỉ để test): bộ dữ liệu mẫu cho phần web ở Task 1 của plan 03.

### Plan 02: Card Agent (`smartcard/agent/`)
- `CardPort` có hai bản cài đặt: `SimCardPort` (4 thẻ ảo jCardSim, đổi slot sẽ xóa phiên PIN) và `PcscCardPort` (đầu đọc thật qua PC/SC).
- `AgentHttpServer`: bind `127.0.0.1:31999`, kiểm tra Origin và Host, xử lý preflight CORS, trả 400/403/503 đúng spec, khóa tuần tự các batch APDU.
- `AgentMain` cùng `agent.properties` (port, allowedOrigins, mode).
- Đã review cả hai plan bằng subagent, đã sửa các lỗi Critical và Important.

## 5. Plan 03 (web): tiến độ từng task

Plan 03 chia thành 16 task, dự kiến làm theo 3 đợt. Chạy tuần tự, mỗi task commit riêng.

**Đợt 1: Nền tảng (Task 1 đến 6)**

| Task | Nội dung |
|---|---|
| 1 | **Đã triển khai/kiểm thử** — test runner, sinh khóa, `card-shared.js`, crypto, APDU; 46/46 unit test PASS, review Approved |
| 2 | **Đã kiểm thử** — 5/5 E2E giao thức qua agent sim; full suite 51 PASS, re-review Approved |
| 3 | **Đã triển khai/kiểm thử** — model, quyền, nhật ký, hạng, ví; 65 unit + 5 E2E + 8 Mongo test PASS, review Approved |
| 4 | **Đã triển khai/kiểm thử, review Approved** — helper thanh toán, CAS/transaction settlement; 12 unit mới + 15 Mongo payment PASS; manual gateway NOT_RUN |
| 5 | **Đã triển khai/kiểm thử, review Approved** — engine/planner/API, receipt recovery và chống double confirm; 12 unit + 55 integration mới; live jCardSim proof PASS |
| 6 | **Đã triển khai/kiểm thử** — Browser Card Client, modal PIN, cấu hình an toàn; 39 unit mới, Edge thật + API/Mongo test/jCardSim PASS |

**Đợt 2: Chức năng admin (Task 7 đến 11)**

| Task | Nội dung |
|---|---|
| 7 | **Đã triển khai/kiểm thử, review Approved** — phát hành khách/nhân viên, danh sách/menu; 8 unit + 25 integration mới; Edge thật 19 mục PASS, Cloudinary/SMTP MOCK |
| 8 | **Đã triển khai/kiểm thử, review Approved** — staff card login/OTP chống bypass/Step-up; 4 unit + 27 integration mới, Edge thật 20 mục PASS |
| 9 | **Đã triển khai/kiểm thử, review Approved** — list/detail/status/refund/audit, 7 unit + 15 integration mới, Edge thật 19 mục PASS |
| 10 | **Đã triển khai/kiểm thử, review Approved** — reset PIN/cash cap/idempotency, 9 unit + 19 integration mới, Edge thật 22 mục PASS; SMTP MOCK |
| 11 | **Đã triển khai/kiểm thử, review Approved** — sửa hồ sơ/ảnh trên thẻ (A7) và cấp lại thẻ (A6) |

**Đợt 3: Chức năng khách hàng (Task 12 đến 16)**

| Task | Nội dung |
|---|---|
| 12 | **Đã triển khai/kiểm thử, review Approved** — đăng nhập khách bằng thẻ, tài khoản thẻ, OTP khóa thẻ; 169 unit +5 E2E +202 Mongo +26 Edge PASS |
| 13 | **Xong** — thanh toán bằng ví thẻ, giảm giá theo hạng, tự điền (U5-debit, U9, U4) |
| 14 | **Xong** — nạp ví online qua ZaloPay/VNPay (U5-credit); sandbox thật NOT_RUN |
| 15 | **Xong** — vé điện tử, check-in, hủy đơn (U6, A9) |
| 16 | **Xong** — thống kê dashboard (A11) và nghiệm thu toàn bộ (15 PASS, 1 NOT_RUN) |

Lưu ý quan trọng từ plan 03 (mục Global Constraints và Review Focus):
- Không thêm dependency npm mới. Dùng `node:test`, `node:crypto`.
- Mọi hằng số, layout, mã SW, ngưỡng lấy nguyên văn từ spec mục 3 và 5.4. INS/SW/TLV chỉ định nghĩa một chỗ, ở `public/assets/js/card/card-shared.js`.
- PIN không được ghi vào log, DB hay console. Thư mục `keys/` phải nằm trong `.gitignore`, khóa server thật không bao giờ commit.
- Test tích hợp chỉ chạy khi có biến `TEST_DATABASE`, **không bao giờ trỏ vào DB thật**.
- 5 điểm cần đặc biệt kiểm tra: mất biên nhận sau DEBIT, confirm cùng một op hai lần, dùng op hoặc đơn của người khác, thẻ nhân viên bị thu hồi khi đang đăng nhập, callback nạp tiền bị gọi lặp. Mỗi điểm có tên test cụ thể trong plan.

## 6. Thiết lập môi trường để làm tiếp

Yêu cầu: Node (plan ghi Node 26), Yarn hoặc npm, MongoDB, JDK 17 trở lên để chạy agent (Gradle wrapper đã kèm sẵn).

```bash
# 1. Cài thư viện web (node_modules không nằm trong file zip)
yarn install            # hoặc npm install

# 2. Tạo file .env từ .env.example rồi điền giá trị thật (DATABASE, JWT_SECRET, email, Cloudinary, ZaloPay, VNPay)
cp .env.example .env

# 3. Kiểm tra phần thẻ (không cần phần cứng)
cd smartcard && ./gradlew test          # kỳ vọng 266 test applet + 30 test agent

# 4. Chạy agent ở chế độ thẻ ảo (dùng khi làm và kiểm tay phần web)
./gradlew :agent:run --args="--sim"
# agent lắng nghe ở http://127.0.0.1:31999, kiểm tra: curl http://127.0.0.1:31999/v1/status -H "Origin: http://localhost:3000"
```

Ghi chú:
- `smartcard/agent/agent.properties` có `allowedOrigins=http://localhost:3000`. Nếu web chạy cổng khác thì sửa lại, nếu không mọi request từ trình duyệt sẽ bị 403.
- Dựng file CAP (không bắt buộc cho bài tập) cần thêm công cụ trong `smartcard/tools/` (đã bị loại khỏi file zip vì nặng khoảng 100 MB). Xem mục "Dựng CAP" trong `smartcard/README.md` và các lệnh tải trong `installed-tools.md`. Cần JDK 17, vì bộ chuyển đổi không chạy với JDK 25.

## 7. Còn thiếu hoặc để lại sau

Các mục dưới đây đã biết rõ, không chặn việc làm plan 03.

**Phần cứng và thẻ thật (không bắt buộc cho bài tập)**
- Chưa kiểm tra `PcscCardPort` với đầu đọc thật. Checklist chưa tick nằm trong `smartcard/README.md`, mục Agent.
- Rút và cắm lại đầu đọc có thể phải khởi động lại agent (ngữ cảnh PC/SC tĩnh). Chưa có timeout, thẻ bị treo sẽ chặn mọi request tới agent.
- Chưa cài lên thẻ thật: cần GlobalPlatformPro, xem `smartcard/README.md`, mục "Cài lên thẻ thật".
- File CAP chưa qua bước verify: bản build mặc định chạy `verify=false`, vì bộ kiểm tra của kit từ chối các file export Java Card 3.0.4 (bản kiểm tra đầy đủ nhắm Java Card 3.1). Với bài tập dùng jCardSim thì không ảnh hưởng.
- Cần ít nhất 133 byte buffer APDU trên thẻ thật (applet nhận dữ liệu theo từng đoạn, xem README).

**Phía agent**
- Test cho logic kết nối lại của `PcscCardPort` chỉ dùng kênh giả, chưa chạy với phần cứng.
- Còn thiếu một số test mở rộng (ghi trong review cuối): POST từ Origin lạ không chạm tới cổng thẻ, header Allow-Headers/Vary, Host trên OPTIONS, log không chứa dữ liệu APDU.
- Chưa chạy thử thủ công tình huống cổng 31999 bị chiếm và việc tắt agent (đã có code xử lý).
- Gson đang parse ở chế độ lenient.

**Git và dọn dẹp**
- Commit `4c4a8b0` (applet) tự nó không biên dịch được, đã được sửa ở `6e15015`. Có thể squash hai commit này nếu muốn lịch sử gọn.
- Tên nhánh `feature/smartcard` chưa merge vào `main`. Chưa tạo PR.

**Plan 03 (web)**
- Lỗi nhỏ còn để lại, các mục NOT_RUN (cổng sandbox thật, SMTP, Cloudinary, thẻ thật) và rủi ro còn lại của việc đóng giao dịch 6A88: xem [báo cáo Task 13–16 và rà soát](reports/2026-11-11-smartcard-03-tasks-13-16-and-review.md), mục 3, 5 và 6.
- Chạy sau proxy HTTPS cần bật Express `trust proxy`, nếu không kiểm tra Origin và giới hạn tần suất đồng bộ thấy IP/giao thức của proxy.

**Bảo mật cần nhớ khi triển khai thật**
- `smartcard/test-vectors/server-test-key.pem` chỉ dùng để test. Khóa server thật sinh bằng `npm run card:keygen` (Task 1 của plan 03), để trong `keys/` và không commit.
- Không commit file `.env`.

## 8. Quy ước làm việc đã dùng (nên giữ nguyên)

- Mọi comment giải thích, Javadoc, README, ghi chú viết **hoàn toàn bằng tiếng Việt** (có dấu). Tên định danh, thuật ngữ giao thức (APDU, SW, PC/SC, CORS...) giữ nguyên.
- Commit message viết tiếng Anh, có tiền tố: `feat(card):`, `test(card):`, `fix(agent):`, `docs(applet):`...
- Mỗi lần cài thêm công cụ trên máy phải ghi vào `docs/superpowers/installed-tools.md`.
- Mỗi task: viết test trước, chạy test, commit riêng, có người khác review trước khi sang task tiếp.

## 9. Cấu trúc thư mục liên quan

```
docs/superpowers/
  specs/2026-11-04-travel-smartcard-design.md   # đặc tả (nguồn chuẩn)
  plans/2026-11-04-smartcard-0{1,2,3}-*.md       # 3 kế hoạch; 01 và 02 đã xong
  installed-tools.md                             # nhật ký cài đặt
  HANDOFF.md                                     # tài liệu này
smartcard/
  applet/        # applet Java Card + test
  agent/         # Card Agent (HTTP ⇄ thẻ)
  test-vectors/  # dữ liệu mẫu cho phần web
  README.md
```
