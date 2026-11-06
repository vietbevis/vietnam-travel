# Thẻ Thành viên Du lịch (Java Card) — Đặc tả thiết kế

Ngày: 2026-11-04 · Dự án: web du lịch Node/Express + MongoDB (`project-1`)

Tài liệu này là **hợp đồng chung** cho 3 plan:
- `docs/superpowers/plans/2026-11-04-smartcard-01-applet.md`: applet Java Card
- `docs/superpowers/plans/2026-11-04-smartcard-02-agent.md`: Card Agent (cầu nối PC/SC ↔ HTTP)
- `docs/superpowers/plans/2026-11-04-smartcard-03-web.md`: backend + giao diện web

Mọi byte layout, mã INS/SW và endpoint ở đây là **chuẩn duy nhất**. Plan nào lệch khỏi tài liệu này là plan sai.

---

## 1. Phạm vi

### 1.1 Tính năng (mã dùng xuyên suốt các plan)

**Khách hàng**

| Mã | Tính năng |
|---|---|
| U1 | Kích hoạt thẻ, bắt buộc đổi PIN lần đầu |
| U2 | Đăng nhập web bằng thẻ + PIN (challenge–response RSA) |
| U3 | Xem hồ sơ và ảnh giải mã từ thẻ; tự sửa SĐT và người liên hệ khẩn cấp |
| U4 | Tự điền form đặt tour (từ tài khoản đã đăng nhập, hoặc nút "Điền từ thẻ") |
| U5 | Ví trên thẻ: trả tiền đơn hàng (DEBIT, PIN mỗi giao dịch); nạp ví qua ZaloPay/VNPay (CREDIT) |
| U6 | Vé điện tử ghi lên thẻ sau khi đơn đã thanh toán |
| U7 | Lịch sử giao dịch: sổ cái server + log trên thẻ, cảnh báo khi lệch |
| U8 | Báo mất, tự khoá thẻ qua OTP email |
| U9 | Hạng thành viên theo tổng chi tiêu, giảm giá tự động |

**Admin / nhân viên**

| Mã | Tính năng |
|---|---|
| A0 | Đăng nhập admin = mật khẩu + thẻ nhân viên + PIN; xác thực lại (step-up) cho thao tác nhạy cảm |
| A1 | Phát hành thẻ (khách / nhân viên) |
| A2 | Danh sách, chi tiết thẻ |
| A3 | Khoá / mở khoá |
| A4 | Thu hồi (TERMINATE) |
| A5 | Reset PIN |
| A6 | Cấp lại thẻ (chuyển số dư và vé) |
| A7 | Sửa hồ sơ / ảnh trên thẻ |
| A8 | Nạp tiền mặt tại quầy |
| A9 | Check-in tour |
| A10 | Nhật ký kiểm toán |
| A11 | Thống kê dashboard |

### 1.2 Ngoài phạm vi (cố ý không làm)

- Check-in offline (không có server).
- RSA-2048, Secure Messaging (GP SCP), mã PUK.
- Lưu hạng thành viên trên thẻ.
- Hoàn tiền tự động về ví khi huỷ đơn (xử lý thủ công).
- Nhiều đầu đọc cùng lúc.

---

## 2. Kiến trúc

```
Applet (thẻ) ⇄ APDU/PC/SC ⇄ Card Agent (Java, 127.0.0.1:31999) ⇄ fetch ⇄ Trình duyệt (pug + JS) ⇄ HTTPS ⇄ Node/Express + MongoDB
```

**Bố cục thư mục:**

```
smartcard/                 Gradle multi-project (Gradle 9.7, JDK 25 để build)
  applet/                  package vn.travel.card — compile --release 8
  agent/                   package vn.travel.agent — --release 17
  test-vectors/            server-test-key.pem (CHỈ dùng test), vectors.json (sinh từ test applet)
helpers/ models/ controllers/ routes/ views/ public/   (web, theo pattern hiện có)
public/assets/js/card/     card-shared.js (dùng chung trình duyệt + Node), card-client.js (trình duyệt)
test/                      node:test
```

**Mô hình tin cậy:**

1. Agent và trình duyệt **không được tin**. Chúng chỉ chuyển tiếp dữ liệu.
2. Server chỉ chấp nhận dữ liệu "thẻ nói" (xác thực, biên nhận ví) khi có **chữ ký RSA của thẻ**, kiểm bằng public key đã lưu lúc phát hành.
3. Thẻ chỉ thực hiện lệnh thay đổi giá trị hoặc trạng thái khi lệnh kèm **chữ ký server** trên một challenge một lần do thẻ sinh ra.
4. Quyền (role/permission) chỉ nằm ở server.
5. **Server là nguồn sự thật** cho trạng thái thẻ, số dư và vé. Thẻ là bản thực thi có chữ ký. Lệch giữa hai bên được đồng bộ qua cơ chế `sync` (mục 6.4).

---

## 3. Giao thức thẻ

### 3.1 Hằng số

- **Package AID:** `F0 54 52 41 56 45 4C 00`
- **Applet AID:** `F0 54 52 41 56 45 4C 01`
- **CLA:** `0x80`. Phiên bản giao thức: `0x01`.
- **cardType:** `0x00` = chưa phát hành, `0x01` = khách, `0x02` = nhân viên.
- **state:**
  - `0x00` CREATED
  - `0x02` ACTIVE
  - `0x03` LOCKED
  - `0x7F` TERMINATED
- **PIN:** đúng 6 byte ASCII `'0'..'9'`, tối đa 5 lần thử.
- **Số tiền / số dư:** uint32 big-endian, đơn vị VNĐ.
  - `BALANCE_MAX = 50 000 000`
  - Số tiền hợp lệ: `1..50 000 000`
- **Chunk dữ liệu:** `CHUNK = 224` byte.
  - Hồ sơ tối đa `448` byte (2 chunk).
  - Ảnh tối đa `10 080` byte (45 chunk).
- **Ticket:** 5 slot. Nhật ký giao dịch: vòng 10 bản ghi.

### 3.2 Mật mã

| Mục đích | Thuật toán |
|---|---|
| Khoá thẻ | RSA-1024 CRT, e = 65537, sinh trên thẻ lúc INIT |
| Khoá server | RSA-1024, PKCS#8 PEM, e = 65537 |
| Chữ ký (cả hai phía) | RSA PKCS#1 v1.5 + SHA-256 (`Signature.ALG_RSA_SHA_256_PKCS1`; Node `crypto.sign('sha256', …)`) |
| DEK | AES-128 ngẫu nhiên sinh trên thẻ, chỉ tồn tại dạng rõ trong RAM (`TYPE_AES_TRANSIENT_DESELECT`) sau khi VERIFY_PIN đúng |
| KEK từ PIN | `SHA-256(salt16 ‖ pin6)[0..15]`; `encDekPin = AES-128-ECB(KEK, DEK)` |
| Escrow | `kEscrow = HMAC-SHA256(CARD_ESCROW_MASTER, cardId16)[0..15]` do server tính và gửi lúc INIT; thẻ giữ trong AESKey bền; `encDekEscrow = AES-128-ECB(kEscrow, DEK)` |
| Mã hoá dữ liệu | AES-128-CBC-NOPAD. Mỗi lần BEGIN_WRITE sinh `IV` ngẫu nhiên 16B cho target. Chunk `i` dùng IV với byte cuối `IV[15] ^ i`. Chunk cuối được pad `0x00` đến bội 16, độ dài thật lưu riêng |

**Giới hạn cần ghi trong báo cáo:** `kEscrow` nằm trong EEPROM cùng chỗ với DEK bọc. Lớp KEK-từ-PIN là phòng thủ nhiều lớp. Hàng rào chính là OwnerPIN và khả năng chống can thiệp của chip.

**Thông điệp được ký** (byte đầu là tag để tách ngữ cảnh):

- **Lệnh server**
  - `M_cmd = 0x43 ‖ challenge16 ‖ cardId16 ‖ INS ‖ P1 ‖ P2 ‖ payload`
  - Dữ liệu APDU = `payload ‖ sig128`
  - Thẻ huỷ challenge sau **mọi** lần kiểm (đúng hay sai). `GET_CHALLENGE` luôn thay challenge cũ. Challenge xoá khi deselect.
- **Xác thực thẻ**
  - `M_auth = 0x41 ‖ nonce16 ‖ cardId16 ‖ txCounter4`
- **Biên nhận ví**
  - `M_rcpt = 0x52 ‖ cardId16 ‖ type1 ‖ txRef8 ‖ amount4 ‖ balanceAfter4 ‖ txCounter4`, dài 38 byte
  - `type`: `0x01` credit, `0x02` debit
  - Phản hồi = `M_rcpt ‖ sig128` (166 byte)

### 3.3 Tập lệnh

**Ký hiệu cột Điều kiện:**
- "PIN" = PIN đã xác thực trong phiên.
- "Ký" = lệnh có chữ ký server (mục 3.2).
- Chỉ ở trạng thái ACTIVE, trừ khi ghi khác.

| INS | Tên | Điều kiện | Dữ liệu vào | Dữ liệu ra |
|---|---|---|---|---|
| `01` | INIT | chỉ ở CREATED | `cardId16 ‖ cardType1 ‖ serverModulus128 ‖ pin6 ‖ kEscrow16` (167B) | `cardModulus128` |
| `10` | GET_PUBLIC_INFO | mọi trạng thái | — | `cardId16 ‖ cardType1 ‖ state1 ‖ mustChangePin1 ‖ triesRemaining1 ‖ version1` (21B; ở CREATED cardId = 0) |
| `20` | VERIFY_PIN | — | `pin6` | — |
| `21` | CHANGE_PIN | — | `oldPin6 ‖ newPin6` | — (xoá `mustChangePin`) |
| `22` | RESET_PIN | Ký | `encPin16 = AES-128-ECB(kEscrow, newPin6 ‖ 0x00×10)` | — (đặt `mustChangePin = 1`, mở khoá PIN) |
| `30` | GET_CHALLENGE | ACTIVE hoặc LOCKED | — | `challenge16` |
| `31` | AUTHENTICATE | PIN | `nonce16` | `txCounter4 ‖ sig128` trên `M_auth` |
| `32` | GET_CARD_PUBKEY | — | — | `cardModulus128` |
| `40` | READ_DATA | PIN | P1 = target (`01` hồ sơ, `02` ảnh); P2 = số thứ tự chunk, hoặc `FF` để lấy độ dài | chunk đã giải mã (chunk cuối cắt đúng độ dài), hoặc `len2` |
| `41` | BEGIN_WRITE | PIN | P1 = target; `totalLen2` | — (target bị vô hiệu cho tới khi COMMIT) |
| `42` | WRITE_CHUNK | PIN | P1 = target; P2 = chunk tiếp theo, đúng thứ tự | plaintext ≤ 224 (phải đúng 224, trừ chunk cuối) |
| `43` | COMMIT_WRITE | Ký | P1 = target; payload = `sha256_32 ‖ len2` | — |
| `50` | GET_BALANCE | PIN, chỉ thẻ khách | — | `balance4 ‖ txCounter4` |
| `51` | CREDIT | Ký, chỉ thẻ khách | payload = `txRef8 ‖ amount4` | biên nhận 166B |
| `52` | DEBIT | Ký + PIN, chỉ thẻ khách | payload = `txRef8 ‖ amount4` | biên nhận 166B; **luôn** reset PIN và xoá DEK sau lệnh |
| `53` | READ_TX_LOG | PIN, chỉ thẻ khách | — | `count1 ‖ n×(type1 ‖ amount4 ‖ balanceAfter4 ‖ txCounter4 ‖ txRef8)`, mới nhất trước |
| `54` | GET_RECEIPT | chỉ thẻ khách | `txRef8` | biên nhận 166B ký lại từ bản ghi log; không thấy → `6A88` |
| `60` | WRITE_TICKET | Ký, chỉ thẻ khách | payload = `ticket33 = orderCode12(ASCII) ‖ tourId12(ObjectId) ‖ departure8(ASCII YYYYMMDD) ‖ pax1` | — (trùng orderCode + tourId đang VALID thì coi như thành công) |
| `61` | READ_TICKETS | PIN, chỉ thẻ khách | — | `count1 ‖ n×(status1 ‖ ticket33)`; status `1` VALID, `2` USED |
| `62` | USE_TICKET | Ký, chỉ thẻ khách | payload = `orderCode12 ‖ tourId12` | — (VALID → USED) |
| `63` | DELETE_TICKET | Ký, chỉ thẻ khách | payload = `orderCode12 ‖ tourId12` | — (slot về trống) |
| `70` | SET_STATE | Ký, ACTIVE hoặc LOCKED | P1 = `02` / `03` / `7F`, payload rỗng | — (`7F` = xoá trắng mảng, `clearKey()` mọi khoá) |

**Ma trận chặn lệnh** (lệnh không được phép trả `6985`):
- **TERMINATED:** chỉ `10`.
- **CREATED:** chỉ `10`, `01`.
- **LOCKED:** chỉ `10`, `30`, `70`.
- **ACTIVE và `mustChangePin = 1`:** chỉ `10 20 21 22 30 32 41 42 43 70`.
- **ACTIVE và `mustChangePin = 0`:** mọi lệnh trừ `01`.
- Lệnh "chỉ thẻ khách" gửi vào thẻ nhân viên trả `6986`.

### 3.4 Mã trạng thái (SW)

| SW | Ý nghĩa |
|---|---|
| `9000` | OK |
| `6700` | Sai độ dài |
| `63Cx` | Sai PIN, còn x lần |
| `6982` | Chưa xác thực PIN |
| `6983` | PIN đã bị khoá |
| `6985` | Sai trạng thái / chưa đổi PIN / vé đã dùng |
| `6986` | Không cho phép với loại thẻ này |
| `6A80` | Dữ liệu sai (PIN không phải số, hash không khớp, số tiền 0) |
| `6A84` | Hết chỗ (vé đầy, dữ liệu quá lớn) |
| `6A86` | P1/P2 sai (target, chunk sai thứ tự hoặc ngoài phạm vi) |
| `6A88` | Không tìm thấy (vé, biên nhận, dữ liệu rỗng) |
| `6D00` | INS không hỗ trợ |
| `6E00` | CLA sai |
| `6F10` | Số dư không đủ |
| `6F11` | Vượt hạn mức số dư |
| `6F20` | Chữ ký server sai |
| `6F21` | Chưa có challenge |

---

## 4. Card Agent — HTTP API

- Lắng nghe `127.0.0.1:31999`.
- Cấu hình ở `smartcard/agent/agent.properties`: `port`, `allowedOrigins` (phân tách bằng dấu phẩy), `mode=pcsc|sim`, `reader` (tuỳ chọn).
- Tham số dòng lệnh `--sim` ghi đè `mode`.
- **CORS:** nếu header `Origin` có mặt mà không thuộc `allowedOrigins` thì trả `403`. Không có `Origin` thì cho qua.
- **Preflight `OPTIONS`:** trả `204` kèm `Access-Control-Allow-Origin`, `-Methods: GET, POST`, `-Headers: Content-Type`, `Access-Control-Allow-Private-Network: true`.

| Method | Path | Body | Trả về |
|---|---|---|---|
| GET | `/v1/status` | — | `{"mode":"sim\|pcsc","reader":string,"cardPresent":bool,"slot":int\|null}` |
| POST | `/v1/transmit` | `{"apdus":["80100000",…]}` (1–64 hex) | `{"responses":[{"data":"hex","sw":"9000"},…]}`. Chạy tuần tự, **dừng sau phản hồi đầu tiên có SW khác 9000** (phản hồi đó vẫn được trả về). Agent tự xử lý `61xx` bằng GET RESPONSE |
| POST | `/v1/sim/slot` | `{"slot":0..3}` | `{"slot":n}`, chỉ có ở chế độ sim |
| POST | `/v1/sim/reset` | `{"slot":0..3}` | Cài lại applet trắng (CREATED) |

**Lỗi:**
- `400 {"error":"bad-request"}`
- `403 {"error":"origin"}`
- `404` khi gọi endpoint sim ở chế độ pcsc
- `503 {"error":"no-card"}`

Chế độ sim có 4 thẻ ảo (jCardSim), applet cài sẵn, mặc định slot 0. Thẻ ảo chỉ tồn tại trong vòng đời của tiến trình agent.

---

## 5. Server — cấu hình và dữ liệu

### 5.1 Biến môi trường mới (`.env.example`)

```
CARD_SERVER_KEY_PATH="keys/card-server-private.pem"   # RSA-1024 PKCS#8, thư mục keys/ được gitignore
CARD_ESCROW_MASTER="<64 ký tự hex>"
CARD_AGENT_URL="http://127.0.0.1:31999"              # đưa ra pug qua app.locals.cardAgentUrl
```

### 5.2 Model (MongoDB, theo pattern `models/*.model.js`)

**Customer** (`customers`)
- `fullName, email, phone, dob (Date), gender ('male'|'female'|'other'), idNumber, emergencyName, emergencyPhone, bloodType, allergies, avatar, totalSpent (Number, mặc định 0), status ('active'), createdBy, deleted…`

**Card** (`cards`)
- Thông tin chung: `cardId (32 hex, unique), cardType ('customer'|'staff'), ownerId, publicKeyModulus (256 hex)`
- Trạng thái:
  - `status ('issuing'|'active'|'locked'|'revoked'|'failed')`
  - `isCurrent (Boolean)`: true khi status ∈ {issuing, active, locked}
  - Unique partial index `{ownerId:1, cardType:1}` với `partialFilterExpression: {isCurrent: true}`
- Ví: `balance (Number, 0), txCounter (Number, 0)`
- Lịch sử: `issuedBy, issuedAt, activatedAt, lockedReason, revokedBy, revokedAt, revokedReason, replaceOf (cardId), lastSeenAt`

**CardTransaction** (`card-transactions`)
- `txRef (16 hex, unique), cardId, type ('credit'|'debit')`
- `source ('cash'|'zalopay'|'vnpay'|'order'|'transfer'|'refund')`
- `amount, orderId, status, balanceAfter, txCounter, receiptHex, createdBy`
- `status`:
  - `awaiting-payment`: chờ cổng thanh toán
  - `pending-card`: tiền đã nhận, chờ ghi lên thẻ
  - `sent`: lệnh đã ký và gửi, chưa có biên nhận
  - `done`
  - `failed`

**CardLog** (`card-logs`)
- `action, cardId, actorType ('admin'|'customer'|'system'), actorId, result ('success'|'fail'), detail, ip, createdAt`
- **Không có route xoá.**

**CardNonce** (`card-nonces`)
- `nonce (32 hex), purpose ('login-customer'|'login-staff'|'step-up'), accountId, expireAt (TTL, now + 60s), used (Boolean)`

**CardOperation** (`card-operations`)
- `cardId, type, params (Object), challenge, status ('draft'|'prepared'|'done'|'failed'), actorType, actorId, expireAt (TTL, now + 5 phút)`

**Thay đổi model hiện có:**
- `AccountAdmin` thêm `cardRequired (Boolean, false)`.
- `Order` thêm `customerId, cardTxRef`.
- Mỗi phần tử `items[]` thêm:
  - `ticketStatus ('none'|'pending'|'written'|'used'|'pending-delete'|'deleted')`
  - `checkedInAt, checkedInBy`

### 5.3 Quyền mới (`config/permission.js`)

`card-view` · `card-issue` · `card-edit` · `card-lock` · `card-revoke` · `card-reset-pin` · `card-topup` · `card-checkin` · `card-log-view`

### 5.4 Quy tắc nghiệp vụ (giá trị cố định)

**PIN**
- PIN yếu (bị từ chối): 6 chữ số giống nhau; dãy tăng hoặc giảm liên tiếp (`123456`, `654321`, `012345`…); trùng `DDMMYY` của ngày sinh.
- PIN ban đầu và PIN reset do server sinh bằng `crypto.randomInt`, sinh lại cho tới khi không yếu.

**Thời hạn**
- Nonce: 60 giây, dùng một lần.
- Operation: 5 phút.
- Step-up: còn hiệu lực trong **5 phút** kể từ lần xác thực thẻ nhân viên gần nhất.

**Ví**
- Nạp online: tối thiểu 10 000. Phải thoả `balance + tổng các credit pending-card/sent + amount ≤ 50 000 000`.
- Nạp tiền mặt: tối thiểu 10 000 mỗi lần. Tổng tiền mặt mỗi nhân viên mỗi ngày ≤ 20 000 000.

**Hạng thành viên** (theo `totalSpent`)
- Standard: < 10 000 000, giảm 0%
- Silver: ≥ 10 000 000, giảm 3%
- Gold: ≥ 30 000 000, giảm 5%
- Platinum: ≥ 80 000 000, giảm 8%
- `discount = Math.round(subTotal × %)`

**Phát hành, khoá, thu hồi**
- Mỗi `(ownerId, cardType)` chỉ có một thẻ `isCurrent`.
- Khách phải có email.
- Phát hành xong thẻ nhân viên thì `AccountAdmin.cardRequired = true`.
- Tài khoản có `cardRequired` mà không có thẻ `active` thì **không đăng nhập được**.
- Thu hồi khi `balance > 0` phải chọn một trong hai:
  - "đã hoàn tiền mặt": ghi debit `source = 'refund'` chỉ ở server;
  - cấp lại thẻ (A6): chuyển số dư.

**Vé**
- Check-in chỉ trong khoảng `[departureDate − 1 ngày, hết ngày departureDate]`, giờ Asia/Ho_Chi_Minh.
- Huỷ đơn (admin đổi status = `cancel`):
  - item `written` → `pending-delete`
  - item `pending` → `none`

**Yêu cầu step-up:** A4 (thu hồi), A5 (reset PIN), A8 (nạp tiền mặt).

---

## 6. Server — cơ chế chung

### 6.1 Helper
- `helpers/card-crypto.helper.js`: ký/kiểm chữ ký, escrow.
- `helpers/card-apdu.helper.js`: dựng và phân tích APDU.
- `public/assets/js/card/card-shared.js`: hằng INS/SW, thông báo lỗi tiếng Việt, mã TLV hồ sơ, chính sách PIN. Dùng chung trình duyệt và Node theo kiểu UMD.

### 6.2 TLV hồ sơ (thẻ coi là byte mờ, server tạo ra)

Mỗi trường: `tag1 ‖ len1 ‖ value(UTF-8)`. Bỏ qua trường rỗng. Tổng ≤ 448 byte, nếu vượt thì báo lỗi.

| Tag | Trường | Độ dài tối đa |
|---|---|---|
| `01` | fullName | 60 |
| `02` | dob (`YYYYMMDD`) | 8 |
| `03` | gender | 6 |
| `04` | phone | 15 |
| `05` | idNumber | 20 |
| `06` | emergencyName | 60 |
| `07` | emergencyPhone | 15 |
| `08` | bloodType | 3 |
| `09` | allergies | 120 |

### 6.3 Card Operation (mọi lệnh có chữ ký server)

1. **Tạo:** `createOp({cardId, type, params, actor})` → op `draft`.
2. **Ký:** `signOp(opId, challengeHex)` → dựng payload theo `type`, ký `M_cmd`, op chuyển sang `prepared`, trả APDU hex.
3. **Xác nhận:** `confirmOp(opId, responseHex, sw, actor)` → op `done` hoặc `failed`, chạy hiệu ứng phía server.

| `type` | INS / P1 | Hiệu ứng khi `9000` |
|---|---|---|
| `set-state` | `70` / `params.state` | Ghi log |
| `reset-pin` | `22` | Gửi email PIN mới, ghi log (`params.newPin` xoá khỏi op sau khi confirm) |
| `credit` | `51` | Kiểm biên nhận → CardTransaction `done`, cập nhật `Card.balance`, `Card.txCounter` |
| `debit` | `52` | Như trên + `markOrderPaid(orderId, 'card')` |
| `write-ticket` | `60` | item `ticketStatus = written` |
| `use-ticket` | `62` | item `used`, `checkedInAt`, `checkedInBy` |
| `delete-ticket` | `63` | item `deleted` |
| `commit-write` | `43` / target | Áp `params.customerUpdate` vào Customer (nếu có) |

**Kiểm biên nhận** (credit/debit/GET_RECEIPT), tất cả phải đúng:
- chữ ký thẻ hợp lệ;
- `cardId` khớp;
- `txRef` khớp;
- `amount` khớp;
- `txCounter == Card.txCounter + 1`;
- `balanceAfter == Card.balance ± amount`.

Khi `signOp` cho credit/debit, CardTransaction chuyển sang `sent`.

### 6.4 Sync (chạy mỗi khi trình duyệt mở phiên thẻ)

Endpoint công khai `/card-api/sync/*`. An toàn vì sync chỉ thực thi trạng thái server đã quyết định, và mọi hiệu ứng tiền bạc đều cần chữ ký của thẻ.

**Vòng lặp tối đa 10 bước.** Trình duyệt gửi `GET_CHALLENGE` (vô hiệu mọi lệnh đã ký trước đó) rồi gọi `POST /card-api/sync/next {cardId, cardState, challenge}`. Hàm thuần `planNextSync` chọn **một** việc theo thứ tự ưu tiên:

1. Thẻ có CardTransaction `sent`: trả `{kind:'receipt', txRef}`. Trình duyệt gửi `GET_RECEIPT`.
   - Có biên nhận → confirm như bình thường.
   - `6A88` → transaction `failed`.
   - Nếu là debit, đơn vẫn `unpaid`.
2. Trạng thái không khớp, trả op `set-state`:
   - server `revoked` → `7F`
   - server `locked` và thẻ ACTIVE → `03`
   - server `active` và thẻ LOCKED → `02`
3. Credit `pending-card` cũ nhất → op `credit`.
4. Item `pending-delete` → op `delete-ticket`.
5. Item `pending` thuộc đơn đã thanh toán của chủ thẻ → op `write-ticket`.
6. Không còn gì → `null`.

Trình duyệt gửi APDU, rồi `POST /card-api/sync/confirm {opId|txRef, response, sw}`.

Server chỉ sinh việc khi `Card.status ∈ {active, locked, revoked}`, thẻ chưa TERMINATED, và thẻ là thẻ khách (bước 3–5).

### 6.5 Xác thực

**Khách (U2)**
1. Sync.
2. Nhập PIN, `VERIFY_PIN`.
3. `POST /card-api/login/challenge` → nonce.
4. `AUTHENTICATE`.
5. `POST /card-api/login/verify {cardId, nonce, counter, signature}`.
6. Server kiểm chữ ký `M_auth`, thẻ `active`, loại `customer`, nonce chưa dùng và chưa hết hạn.
7. Cookie `customerToken` (JWT 1 ngày `{customerId, cardId}`, httpOnly, sameSite strict).

Nếu `counter > Card.txCounter` mà không có transaction `sent` → ghi CardLog `counter-anomaly`.

**Nhân viên (A0)**
1. `POST /admin/account/login`: nếu `cardRequired` thì không cấp token, mà đặt cookie `preToken` (JWT 5 phút `{id, stage:'card'}`) và trả `{code:'card-required'}`.
2. Chạy luồng thẻ giống trên, gọi `/admin/account/login-card/challenge` và `/verify`.
3. Cấp `token` `{id, email, cardId, stepUpAt}`.

`auth.middleware.verifyToken` kiểm thêm: nếu `cardRequired` thì `decoded.cardId` phải là thẻ `active`, loại `staff`, chủ là tài khoản này. Middleware đặt `req.stepUpAt`.

**Step-up:** `POST /admin/card/step-up/challenge|verify` cấp lại `token` với `stepUpAt = now`.

---

## 7. Luồng nghiệp vụ chính

**A1 — Phát hành**
1. Agent kiểm `GET_PUBLIC_INFO` có state = CREATED.
2. `POST /admin/card/issue/prepare`: server tạo Customer (nếu là khách mới), `cardId`, PIN ban đầu, `kEscrow`, bản ghi Card `issuing`, TLV hồ sơ, op nháp commit-write cho hồ sơ và ảnh. Trả `{cardId, initApdu, initialPin, profileHex, photoOpId, profileOpId}`.
3. Gửi INIT, rồi `POST /issue/init-confirm {cardId, response}` để lưu modulus.
4. `VERIFY_PIN(initialPin)`.
5. Ghi hồ sơ: BEGIN / WRITE ×n / GET_CHALLENGE / `op/sign` / COMMIT / `op/confirm`. Làm tương tự cho ảnh.
6. `POST /issue/finish`: Card `active`, email PIN ban đầu cho khách, đặt `cardRequired` nếu là thẻ nhân viên, ghi log.
7. Nếu lỗi giữa chừng: `POST /issue/cancel`, Card chuyển `failed`. Thẻ thật phải cài lại applet; thẻ sim gọi `/v1/sim/reset`.

**U5 — Trả tiền đơn**
1. `/order/payment-card?orderId`.
2. Đăng nhập khách bắt buộc, đơn thuộc khách này và `unpaid`, không có debit `sent` cho đơn.
3. Nhập PIN, `VERIFY_PIN`, `GET_CHALLENGE`.
4. `POST /card-api/pay/prepare` (op debit đã ký).
5. Gửi `DEBIT`, rồi `op/confirm`.
6. Server kiểm biên nhận → `markOrderPaid` → sync ghi vé.

**U5 — Nạp online**
1. `POST /card-api/topup {amount, method}` → CardTransaction `awaiting-payment` → chuyển hướng sang cổng.
2. Callback hoặc return URL hợp lệ → `pending-card`.
3. Trang tài khoản chạy sync → `CREDIT`.

**A5 — Reset PIN**
1. Step-up.
2. `POST /admin/card/reset-pin {cardId}`: tạo op `reset-pin` với `newPin`.
3. `GET_CHALLENGE`, `op/sign`, gửi `RESET_PIN`, `op/confirm`.
4. Hiển thị PIN mới cho admin và gửi email.

**A4 — Thu hồi**
1. Step-up.
2. `POST /admin/card/status {action:'revoke'}`: server `revoked` ngay, `isCurrent = false`.
3. Nếu thẻ đang cắm thì sync đẩy `SET_STATE 7F`.

**A6 — Cấp lại thẻ**
1. Thu hồi thẻ cũ (lý do "replaced").
2. Phát hành thẻ mới với `replaceOf`.
3. Ở bước `issue/finish`: tạo credit `source = 'transfer'` bằng số dư cũ (`pending-card`), ghi debit `transfer` cho thẻ cũ phía server, đặt lại item `written` / `used = false` của khách về `pending`.

**A9 — Check-in**
1. Chọn tour, ngày.
2. Cắm thẻ, sync, khách nhập PIN.
3. Đọc ảnh và READ_TICKETS.
4. `POST /admin/card/checkin/lookup`.
5. Tạo op `use-ticket`, ký, gửi, confirm.

**U8 — Khoá thẻ qua OTP**
1. `/card-lock`: nhập email → OTP 6 số, hiệu lực 5 phút (dùng lại model `ForgotPassword`), gửi qua `mailHelper.sendMail`.
2. Xác nhận OTP → Card `locked` (lý do `customer-reported-lost`).

---

## 8. Chiến lược kiểm thử

**Applet**
- JUnit 5 + jCardSim (`com.klinec:jcardsim:3.0.5.11`) bao toàn bộ ma trận ở mục 3.
- Test `TestVectorsExport` sinh `smartcard/test-vectors/vectors.json`.

**Agent**
- JUnit với `SimCardPort` và HTTP client.

**Web**
- `node --test` cho helper thuần: crypto (đối chiếu `vectors.json`), APDU, TLV, chính sách PIN, `planNextSync`, hạng thành viên, hạn mức nạp.
- `test/card-e2e.test.js` chạy giao thức thật qua agent `--sim` (bỏ qua nếu thiếu `AGENT_URL`).
- Giao diện kiểm thủ công theo checklist trong từng task, dùng agent `--sim`.
