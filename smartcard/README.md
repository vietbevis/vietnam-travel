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
3. **Tạo `.env`** từ `.env.example`, điền các biến `CARD_*`:
   - `CARD_SERVER_KEY_PATH` — đường dẫn khoá riêng vừa sinh (mặc định `keys/card-server-private.pem`).
   - `CARD_ESCROW_MASTER` — 64 ký tự hex (khoá escrow gốc).
   - `CARD_AGENT_URL` — địa chỉ Card Agent (mặc định `http://127.0.0.1:31999`).
4. **Chạy Card Agent giả lập:** `cd smartcard && ./gradlew :agent:run --args="--sim"` (4 slot jCardSim, cổng 31999).
   Origin của web phải có trong `allowedOrigins` (`smartcard/agent/agent.properties`, so khớp chính xác), ví dụ `http://localhost:3000`; sai Origin agent trả 403.
5. **Chạy web:** `npm start` (hoặc lệnh chạy dev của dự án) rồi vào trang quản trị.
6. **Kiểm thử:**
   - Unit: `AGENT_URL=http://127.0.0.1:31999 npm test` (`AGENT_URL` trỏ tới agent `--sim` đang chạy; thiếu thì các test cần agent bị bỏ qua).
   - Integration: `TEST_DATABASE=mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test npm run test:integration`.
     Chỉ chấp nhận Mongo loopback, replica set và đúng database `vietnam-travel-smartcard-test`; không có `TEST_DATABASE` thì các test được `skip`.
   - Applet và agent: `cd smartcard && sh ./gradlew test`.

### Thống kê thẻ trên dashboard (A11)

Chỉ hiển thị cho tài khoản có quyền `card-view`. Tháng hiện tại và các ngày tính theo giờ Việt Nam (UTC+7).
Bảng tỉ lệ check-in: mỗi dòng là một (tour, ngày khởi hành) trong khoảng ±7 ngày của các đơn đã thanh toán, chưa huỷ;
"Vé trên thẻ" = vé ở trạng thái `written` hoặc `used`; "Đã check-in" = vé `used`.

### Kết quả nghiệm thu end-to-end

_Chưa có. Mục này sẽ được điền sau khi chạy nghiệm thu end-to-end (Task 16, bước 3)._
