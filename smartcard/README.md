# Travel smartcard applet

Applet Java Card `vn.travel.card.TravelCardApplet` (AID `F054524156454C01`, package AID `F054524156454C00`).
Spec: `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md` mục 3.

## Chạy kiểm thử

    cd smartcard
    ./gradlew :applet:test

Chạy trên JDK mặc định (17+; đã thử với 25) với jCardSim. `TestVectorsExport` sinh và tự xác minh một file vectors
ở vị trí tạm; file `test-vectors/vectors.json` đã commit (phía web dùng, plan 03 Task 1) chỉ bị ghi đè khi bạn truyền cờ
(cặp khóa của thẻ là ngẫu nhiên nên file sẽ thay đổi):

    ./gradlew :applet:test -PwriteVectors

## Yêu cầu về buffer APDU

Toàn bộ dữ liệu lệnh được nhận bằng vòng lặp `receiveBytes` (lần đọc đầu có thể chỉ nhận một phần với T=1 chained/contactless)
vào buffer staging transient 260 byte (5 + Lc tối đa 255, `CLEAR_ON_DESELECT`), và bản sao trong buffer APDU bị xóa
ngay lập tức. Thẻ phải cung cấp buffer APDU tối thiểu theo Java Card là 133 byte (header 5 + 128 mỗi lần
đọc); truyền không đủ đúng Lc byte sẽ lỗi `6700`. Buffer staging được xóa về 0 sau
mỗi lệnh.

## TERMINATE an toàn khi mất điện

SET_STATE 7F commit `state = TERMINATED` cùng cờ `wipePending` trong một transaction nhỏ, sau đó chạy các thao tác
xóa idempotent (PIN/DEK/escrow, khóa, ví, vé, kho 10 KB) bên ngoài transaction rồi gỡ cờ. Nếu mất điện giữa chừng,
đợt xóa được chạy lại ở đầu `process()` kế tiếp (kể cả SELECT).

## Dựng CAP

Cài công cụ một lần (cả hai đều bị git bỏ qua trong `smartcard/tools/`):

    mkdir -p smartcard/tools
    curl -fsSL -o smartcard/tools/ant-javacard.jar https://github.com/martinpaljak/ant-javacard/releases/latest/download/ant-javacard.jar
    git clone --depth 1 https://github.com/martinpaljak/oracle_javacard_sdks smartcard/tools/sdks

Sau đó dựng bằng **JDK 17** (bộ chuyển đổi từ chối JDK 25 với kit v24.0):

    cd smartcard
    JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew :applet:cap

Đầu ra: `smartcard/applet/build/travelcard.cap` (kit `jc320v24.0_kit`, target `jc304_kit`, tức Java Card 3.0.4+).

Ghi chú:
- Bộ xác minh off-card trong kit không đọc được các file export 3.0.4 ("unsupported export file format"),
  nên mặc định tắt xác minh với target 3.0.4. Để chạy bộ xác minh, hãy nhắm target 3.1:
  `./gradlew :applet:cap -PcapTarget=jc310r20210706_kit -PcapVerify=true` (pass; đầu ra là CAP nhắm 3.1,
  hãy ghi đè bằng cách chạy lại bản dựng mặc định trước khi cài lên thẻ 3.0.x).
- Đổi kit bằng `-PcapJckit=<dir>` / `-PcapTarget=<dir>` (thư mục nằm trong `tools/sdks`).
- Kích thước: khoảng 48 KB CAP nén zip, khoảng 9,5 KB thành phần CAP (Method ~5,7 KB); dữ liệu persistent chủ yếu là
  kho ảnh 10 080 B. Vừa với các thẻ 32 KB trở lên thông thường.

## Cài lên thẻ thật (GlobalPlatformPro)

    java -jar gp.jar --install applet/build/travelcard.cap

Gỡ applet (đồng thời khôi phục thẻ cài dở hoặc bị lỗi):

    java -jar gp.jar --delete F054524156454C00

## Cảnh báo

`test-vectors/server-test-key.pem` là khóa server **chỉ dùng để thử nghiệm** được commit vào repo. Tuyệt đối không dùng nó để
cá nhân hóa thẻ thật; thẻ production cần khóa server được giữ ngoài git (`keys/`).

## Agent (cầu HTTP giữa trình duyệt và thẻ)

Chạy ở chế độ giả lập (jCardSim, 4 slot), lắng nghe `http://127.0.0.1:31999`:

```bash
cd smartcard && ./gradlew :agent:run --args="--sim"
```

Chế độ đầu đọc thật: `./gradlew :agent:run` (đọc `smartcard/agent/agent.properties`, mặc định `mode=pcsc`).
Tham số dòng lệnh: `--sim` ghi đè chế độ, `--port=N` ghi đè cổng.

Điểm cuối: `GET /v1/status`, `POST /v1/transmit`, và (chỉ chế độ sim) `POST /v1/sim/slot`, `POST /v1/sim/reset`.
Agent kiểm header `Host` (chỉ nhận `127.0.0.1:<cổng>` hoặc `localhost:<cổng>`) và `Origin` (danh sách `allowedOrigins`); sai thì trả 403.

Kết quả chạy thử chế độ sim: `/v1/status` trả `cardPresent:true, slot:0`; SELECT + INFO đều `9000`; Origin lạ và Host lạ đều 403.

### Checklist PC/SC (cần đầu đọc thật, chưa kiểm tra)

- [ ] Chạy khi chưa cắm thẻ: `cardPresent` phải là `false`.
- [ ] Cắm thẻ đã cài CAP: SELECT + INFO trả `9000`.
- [ ] Rút thẻ: transmit trả 503.
- [ ] Cắm lại: trả `9000` mà không cần khởi động lại agent.

Lưu ý: rút/cắm đầu đọc (nhất là đầu đọc cuối cùng) có thể làm dịch vụ PC/SC dừng, khi đó cần khởi động lại agent.
Agent chưa có timeout cho thẻ: thẻ treo sẽ chặn các yêu cầu khác cho đến khi thẻ phản hồi.

## Nạp ví online (ZaloPay / VNPay)

- `POST /card-api/topup` tạo giao dịch credit `awaiting-payment` rồi trả `redirectUrl` của cổng; sau khi cổng báo thành công, giao dịch chuyển `pending-card` đúng một lần và được ghi lên thẻ ở lần đồng bộ kế tiếp (`/account/card?topup=1`).
- **ZaloPay chỉ gọi callback (`/card-api/topup-zalopay-result`) tới địa chỉ công khai.** Khi chạy local phải đặt `DOMAIN_WEBSITE` là URL công khai (ví dụ ngrok: `ngrok http 3000` rồi `DOMAIN_WEBSITE=https://<id>.ngrok-free.app`), nếu không callback không tới và tiền không được cộng.
- VNPay quay về `/card-api/topup-vnpay-result` bằng trình duyệt nên chạy được với `localhost`; F5 trang này không cộng thêm lần nữa.

## Chạy toàn hệ thống

Hướng dẫn dựng toàn bộ hệ thống (web + MongoDB + Card Agent) để phát triển và nghiệm thu.

1. **MongoDB phải là replica set.** Thanh toán bằng ví thẻ, phát hành và thay thẻ dùng transaction nên Mongo đơn lẻ (standalone) không đủ.
   Ví dụ dev: chạy `mongod --replSet rs0` rồi `rs.initiate()` một lần. Chuỗi kết nối đặt ở `DATABASE` trong `.env`.
2. **Sinh khoá server của thẻ:** `npm run card:keygen` (ghi vào `keys/`, thư mục này nằm trong `.gitignore`, không commit).
   Lệnh in ra một dòng `CARD_ESCROW_MASTER=…`; chép giá trị này vào `.env` (không lưu ở nơi khác).
3. **Tạo `.env`** từ `.env.example`, điền các biến `CARD_*`:
   - `CARD_SERVER_KEY_PATH` — đường dẫn khoá riêng vừa sinh (mặc định `keys/card-server-private.pem`).
   - `CARD_ESCROW_MASTER` — 64 ký tự hex (khoá escrow gốc), lấy từ kết quả `card:keygen`.
   - `CARD_AGENT_URL` — địa chỉ Card Agent (mặc định `http://127.0.0.1:31999`).
   - `JWT_SECRET`, `EMAIL_*`, `CLOUDINARY_*` là bắt buộc với luồng thẻ: phát hành/thay thẻ tải ảnh lên Cloudinary
     (lỗi tải ảnh thì huỷ phát hành, `PHOTO_UPLOAD`), PIN ban đầu và OTP báo mất thẻ gửi qua email.
   - Nạp ví qua VNPay/ZaloPay cần `DOMAIN_WEBSITE` trỏ đúng địa chỉ web (ví dụ `http://localhost:3000`) và khoá sandbox của cổng.
4. **Chạy Card Agent giả lập:** `cd smartcard && ./gradlew :agent:run --args="--sim"` (4 slot jCardSim, cổng 31999).
   Origin của web phải có trong `allowedOrigins` (`smartcard/agent/agent.properties`, so khớp chính xác), ví dụ `http://localhost:3000`; sai Origin agent trả 403.
   Đổi thẻ đang cắm: `curl -X POST -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' -d '{"slot":1}' http://127.0.0.1:31999/v1/sim/slot`.
5. **Chạy web:** `npm start` (nodemon, cổng cố định 3000) hoặc `node index.js`, rồi mở đúng `http://localhost:3000`
   (không dùng `127.0.0.1:3000`: Origin khác sẽ bị agent từ chối).
   Nhóm quyền của tài khoản quản trị phải được cấp các quyền thẻ (`card-view`, `card-issue`, `card-edit`, `card-lock`, `card-revoke`,
   `card-reset-pin`, `card-topup`, `card-checkin`, `card-log-view`) ở trang Nhóm quyền thì menu thẻ mới hiện.
6. **Kiểm thử:**
   - Unit: `AGENT_URL=http://127.0.0.1:31999 npm test` (`AGENT_URL` trỏ tới agent `--sim` đang chạy; thiếu thì các test cần agent bị bỏ qua).
   - Integration: `TEST_DATABASE=mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test npm run test:integration`.
     Chỉ chấp nhận Mongo loopback, replica set và đúng database `vietnam-travel-smartcard-test`; không có `TEST_DATABASE` thì các test được `skip`.
     Nếu shell đang có `DATABASE` trỏ tới chính database kiểm thử thì guard từ chối; chạy với `env -u DATABASE …`.
   - Applet và agent: `cd smartcard && ./gradlew test`.

### Thống kê thẻ trên dashboard (A11)

Chỉ hiển thị cho tài khoản có quyền `card-view`. Tháng hiện tại và các ngày tính theo giờ Việt Nam (UTC+7).
Bảng tỉ lệ check-in: mỗi dòng là một (tour, ngày khởi hành) trong khoảng ±7 ngày của các đơn đã thanh toán, chưa huỷ;
"Vé trên thẻ" = vé ở trạng thái `written` hoặc `used`; "Đã check-in" = vé `used`.

### Kết quả nghiệm thu end-to-end

Chạy ngày 11/11/2026, một lượt liên tục. Script nghiệm thu chấm **18/18 bước tự động PASS**; bảng dưới gộp lại thành
16 dòng: **15 PASS, 1 NOT_RUN** (cổng thanh toán sandbox thật, không nằm trong 18 bước tự động).
Ba bước của script không có dòng riêng: S0 (dựng dữ liệu, tài khoản, slot thẻ) là bước chuẩn bị; 5a (sửa `departureDate`
của tour về hôm nay qua UI sửa tour, làm trước khi đặt vì item đơn lưu ngày khởi hành) gộp vào dòng 5; 4b (đơn thứ hai trả
bằng ví để có vé cho bước cấp lại thẻ) gộp vào dòng 6. Môi trường:
- Card Agent `--sim` (jCardSim, slot 0–3).
- Web `node index.js` tại `http://localhost:3000`.
- MongoDB replica set loopback, database kiểm thử `vietnam-travel-smartcard-test`.
- Chrome headless thật, điều khiển qua DevTools Protocol.
- Step-up nhân viên chạy đúng thời gian thật: trước bước 3, 6 và 7 chờ hết hạn 5 phút để thao tác phải xác thực lại bằng thẻ nhân viên.

Ký hiệu chế độ:
- **REAL**: chạy thật qua trình duyệt → web → agent → applet.
- **MOCK**: thay dịch vụ ngoài bằng bản giả lập cục bộ:
  - SMTP: thư được giữ trong bộ nhớ để lấy PIN/OTP.
  - Cloudinary: trả URL giả.
  - Cổng VNPay: chặn request bằng DevTools, kiểm tra chữ ký merchant và trả return URL ký cục bộ.
- **NOT_RUN**: không chạy được vì không có thông tin truy cập thật.

| Bước | Kỳ vọng | Thực tế | Kết quả | Chế độ |
|---|---|---|---|---|
| 1. Admin phát hành thẻ nhân viên cho mình (slot 0), đăng xuất, đăng nhập mật khẩu + thẻ | Thẻ `active`; tài khoản bắt buộc thẻ; đăng nhập đòi PIN ban đầu rồi đổi PIN | Thẻ `active`, `cardRequired=true`; vào lại `/admin/dashboard` bị chuyển về trang đăng nhập; PIN ban đầu → đổi PIN → dashboard; chip `mustChangePin=false` | PASS | REAL |
| 2. Phát hành thẻ khách (slot 1), PIN gửi email | Thẻ `active`, email chứa PIN ban đầu | Thẻ `active`; thư "Thẻ thành viên của bạn" tới email khách, PIN trong thư khớp PIN hiển thị một lần | PASS | REAL (SMTP, Cloudinary MOCK) |
| 3. Khách đăng nhập, đổi PIN; admin nạp tiền mặt 3 000 000 (step-up slot 0 rồi đổi sang slot 1) | Khách đổi PIN; nạp đòi PIN thẻ nhân viên, tiền ghi vào chip | Đổi PIN xong vào `/account/card`; nạp: 1 lần xác thực PIN nhân viên, giao dịch `done`, server và chip đều 3.000.000 đ | PASS | REAL |
| 4. Khách đặt tour bằng ví thẻ → `paid` → vé ghi lên thẻ | Đơn `paid`, trừ ví, vé `written` trên chip | Đơn 1.500.000 đ `paid`, debit `done`, server và chip đều 1.500.000 đ; vé `written` ngay sau thanh toán, chip có vé "Chưa dùng" (sau khi sửa lỗi `f4dd69e`) | PASS | REAL |
| 5. Check-in ngày khởi hành (sửa `departureDate` tour về hôm nay) → vé USED | Quét thẻ hiện ảnh/thông tin/vé; xác nhận → vé đã dùng | Sửa ngày qua UI sửa tour; quét thấy tên, nhóm máu, ảnh, vé hợp lệ; "Đã check-in thành công."; item `used`, chip "Đã dùng" | PASS | REAL |
| 6. Khách báo mất qua OTP → admin cấp lại (slot 2) → số dư, vé chuyển sang → cắm slot 1 bị TERMINATE | Thẻ cũ khoá rồi thu hồi; thẻ mới nhận số dư và vé chưa dùng; thẻ cũ bị khoá vĩnh viễn trên chip | OTP qua email → "Đã khóa thẻ…"; cấp lại cần step-up nhân viên; thẻ cũ `revoked`, thẻ mới `active`; lần đọc đầu thẻ mới: credit 900.000 đ `done`, vé chưa dùng ghi sang thẻ mới; cắm lại thẻ cũ: "Thẻ đã bị thu hồi.", chip state `0x7F` | PASS | REAL (SMTP MOCK) |
| 7. Sai PIN 5 lần trên slot 2 → admin reset PIN → khách đổi PIN | Đếm lùi số lần thử, khoá PIN; reset cần step-up; khách phải đổi PIN | "còn 4…0 lần thử", lần 6 "PIN đã bị khoá"; reset: step-up nhân viên, PIN mới gửi email (khớp), chip tries=5 `mustChangePin=true`; khách đăng nhập → đổi PIN → chip `mustChangePin=false` | PASS | REAL (SMTP MOCK) |
| 8a. Dashboard hiển thị số liệu khớp | Thống kê thẻ, doanh thu ví, tỉ lệ check-in khớp DB | UI và DB cùng: 3 thẻ hoạt động, 0 khoá, 1 thu hồi; doanh thu ví tháng 2.200.000 đ (3 debit); tour A 1/1/1 | PASS | REAL |
| 8b. Trang nhật ký có đủ các bước | Mọi bước có nhật ký; không lộ PIN/OTP/mật khẩu | 61/61 mục, 4 trang; có đủ issue, auth (login-staff, login-customer, step-up), topup-cash, pay, checkin, lock/replace, reset PIN; đủ các loại op đã xác nhận; 0 bí mật trong HTML nhật ký và log web | PASS | REAL |
| T13. Mất biên nhận khi trả bằng ví (chặn `/card-api/op/confirm`, tải lại trang thẻ) | Đọc lại biên nhận từ chip, đơn `paid` đúng một lần, chip = server | Confirm bị chặn → đơn `unpaid`; đọc thẻ → banner lệch, GET_RECEIPT → đơn `paid`, 1 debit, server = chip = 1.000.000 đ | PASS | REAL (chặn mạng bằng DevTools) |
| T13. Đơn vượt số dư | Báo "Số dư ví không đủ", không tạo giao dịch | Cảnh báo và nút bị vô hiệu; gọi thẳng `pay/prepare` cũng bị từ chối; 0 giao dịch | PASS | REAL |
| T13. Khách hạng Gold | Giỏ hàng giảm 5% | Tạm tính 1.500.000, giảm 75.000, "(Hạng Gold giảm 5%)" | PASS | REAL (dữ liệu `totalSpent` dựng sẵn) |
| T15. Check-in lần hai | "Vé đã sử dụng" | Quét lại: "Vé đã sử dụng.", không có nút xác nhận; gọi thẳng API cũng bị từ chối | PASS | REAL |
| T15. Huỷ đơn có vé `written` → cắm thẻ | Vé bị xoá khỏi thẻ, item `deleted` | Sau huỷ: `pending-delete`; đồng bộ ("Đồng bộ ngay" trên chi tiết thẻ) → item `deleted`, vé biến mất khỏi chip | PASS | REAL |
| T14. Nạp online, quay về `/account/card?topup=1`; F5 | Cộng tiền đúng một lần | Chữ ký request merchant hợp lệ; lần 1 "Đã ghi 100.000 đ vào thẻ.", server và chip đều 1.100.000 đ; F5 không cộng thêm | PASS | MOCK (cổng VNPay); web/agent/chip REAL |
| T14. Cổng thanh toán sandbox thật | — | Không có khoá sandbox VNPay/ZaloPay | — | NOT_RUN |

Lỗi phát hiện khi nghiệm thu:
- `f4dd69e`: sau khi trả bằng ví thẻ, vé vẫn `pending`, chưa ghi lên thẻ. Đã sửa: đồng bộ ngay sau khi debit được xác nhận.

Hạn chế đã biết:
- Nút "Đọc thẻ" của khách chỉ đọc số dư, không ghi hoặc xoá vé đang chờ. Vé chờ được ghi khi thanh toán, khi đăng nhập bằng thẻ hoặc khi admin "Đồng bộ ngay".
- F5 trang return nạp online hiện "Đang chờ cổng thanh toán xác nhận…" dù tiền đã vào thẻ.
- (Đã khắc phục sau nghiệm thu) Nhật ký `card-op-confirm` nay ghi loại op, mã thẻ và tham số an toàn (txRef, đơn, item, trạng thái, số tiền); lỗi ném ra khi ký/xác nhận và mỗi bước đồng bộ (`card-sync-op`) cũng được ghi.
