# Bàn giao: Thẻ Thành viên Du lịch (Java Card)

Tài liệu này dành cho thành viên nhận tiếp phần còn lại của dự án. Ngày lập: 2026-11-06. Nhánh làm việc: `feature/smartcard` (tách từ `main`).

Dự án là web du lịch Node/Express + Mongo + Pug (thanh toán ZaloPay/VNPay), được bổ sung tính năng thẻ thành viên Java Card. Đây là bài tập lớn: **chỉ cần thẻ ảo (jCardSim), không cần thẻ thật.**

## 1. Tóm tắt tình trạng

| Phần | Trạng thái | Ghi chú |
|---|---|---|
| Plan 01: Applet Java Card | **Xong** | 266 test pass, build được file CAP |
| Plan 02: Card Agent (cầu HTTP giữa trình duyệt và thẻ) | **Xong** | 30 test pass, chạy thử được chế độ sim |
| Plan 03: Web (server + giao diện) | **Task 1–2 đã triển khai và kiểm thử** | 46 unit + 5 E2E jCardSim pass; Task 3–16 chưa triển khai |

**Cập nhật 2026-11-10:** Task 1 Plan 03 đã bổ sung helper giao thức/mật mã, `CardShared`, test runner, keygen và cấu hình web tối thiểu. Review độc lập: Spec PASS / Quality Approved; không phát hiện vấn đề cần sửa. Xem [báo cáo Task 1](reports/2026-11-10-smartcard-03-task-1.md).

**Task 2 đã hoàn tất:** năm E2E giao thức thật qua Card Agent/jCardSim đạt PASS; tổng suite có agent là 51 PASS, không agent là 46 PASS/5 SKIP. Review phát hiện và đã sửa điều kiện `AGENT_URL` rỗng phải FAIL; re-review Spec PASS / Quality Approved. Xem [báo cáo Task 2](reports/2026-11-10-smartcard-03-task-2.md), gồm giới hạn Node 26 chưa chạy. Dừng trước Task 3; các chức năng nghiệp vụ website chưa được triển khai.

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

## 5. Việc cần làm tiếp: Plan 03 (web)

Plan 03 chia thành 16 task, dự kiến làm theo 3 đợt. Chạy tuần tự, mỗi task commit riêng.

**Đợt 1: Nền tảng (Task 1 đến 6)**

| Task | Nội dung |
|---|---|
| 1 | **Đã triển khai/kiểm thử** — test runner, sinh khóa, `card-shared.js`, crypto, APDU; 46/46 unit test PASS, review Approved |
| 2 | **Đã kiểm thử** — 5/5 E2E giao thức qua agent sim; full suite 51 PASS, re-review Approved |
| 3 | Model, quyền, nhật ký, hạng thành viên, quy tắc ví |
| 4 | Tách helper thanh toán và `markOrderPaid` |
| 5 | Card Operation engine, sync planner, endpoint `/card-api` |
| 6 | `card-client.js` trên trình duyệt và hộp nhập PIN |

**Đợt 2: Chức năng admin (Task 7 đến 11)**

| Task | Nội dung |
|---|---|
| 7 | Phát hành thẻ (A1), danh sách khách hàng, menu |
| 8 | Đăng nhập admin bằng thẻ nhân viên và step-up (A0) |
| 9 | Danh sách, chi tiết, khóa/mở/thu hồi, nhật ký (A2, A3, A4, A10) |
| 10 | Reset PIN (A5) và nạp tiền mặt (A8) |
| 11 | Sửa hồ sơ/ảnh trên thẻ (A7) và cấp lại thẻ (A6) |

**Đợt 3: Chức năng khách hàng (Task 12 đến 16)**

| Task | Nội dung |
|---|---|
| 12 | Khách đăng nhập bằng thẻ, trang tài khoản thẻ, khóa thẻ qua OTP (U1, U2, U3, U7, U8) |
| 13 | Thanh toán bằng ví thẻ, giảm giá theo hạng, tự điền (U5-debit, U9, U4) |
| 14 | Nạp ví online qua ZaloPay/VNPay (U5-credit) |
| 15 | Vé điện tử, check-in, hủy đơn (U6, A9) |
| 16 | Thống kê dashboard (A11) và nghiệm thu toàn bộ |

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
