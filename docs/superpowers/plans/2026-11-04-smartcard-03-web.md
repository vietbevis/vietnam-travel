# Web — Tích hợp Thẻ Thành viên Du lịch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa toàn bộ tính năng U1–U9 và A0–A11 (spec mục 1.1) vào web Node/Express hiện có, giao tiếp với thẻ qua Card Agent.

**Architecture:**
- Phía server:
  - helper thuần (crypto, APDU, TLV, quy tắc nghiệp vụ) được test bằng `node:test`;
  - **Card Operation engine**: tạo → ký → xác nhận mọi lệnh có chữ ký;
  - **Sync planner**: đưa thẻ về đúng trạng thái server.
- Trình duyệt: điều phối qua `card-client.js` (agent ⇄ server).
- Controller và view theo pattern sẵn có của dự án (CommonJS, pug, JSON `{code, message}`).

**Tech Stack:** Node 26, Express 4, Mongoose 8, Pug, `node:crypto`, `node:test`. **Không thêm dependency npm mới.**

**Spec:** `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md`. Mục 3 (giao thức), 5 (dữ liệu, quy tắc), 6 (cơ chế), 7 (luồng).

**Phụ thuộc:**
- Task 1 cần `smartcard/test-vectors/vectors.json` (plan 01 Task 9).
- Task 2 và mọi bước kiểm thủ công cần agent `--sim` (plan 02).

## Global Constraints

- **Pattern code:**
  - CommonJS, `module.exports.fn = async (req, res) => {}`.
  - Response JSON luôn là `{code: "success"|"error", message, ...}`.
  - Kiểm quyền bằng `req.permissions.includes("<quyền>")` ở đầu controller admin; thiếu quyền trả `{code:"error", message:"Bạn không có quyền sử dụng tính năng này!"}`.
  - Validate body bằng Joi trong `validates/`.
  - Giao diện tiếng Việt.
- **Hằng số và quy tắc:** mọi hằng, layout, SW, ngưỡng (PIN yếu, TTL, hạn mức, hạng thành viên, cửa sổ check-in) lấy **nguyên văn** từ spec mục 3 và 5.4. Không tự đặt giá trị khác.
- **Một nguồn sự thật:** INS/SW/TLV/chính sách PIN chỉ định nghĩa trong `public/assets/js/card/card-shared.js`. Node `require` file này, không chép lại.
- **Tiền:** số nguyên VNĐ.
- **Nhật ký:** mọi thao tác thẻ thành công hoặc thất bại đều ghi `CardLog` qua `cardLogHelper.write`.
- **Bảo mật dữ liệu:**
  - PIN không được ghi vào log, DB hay console. PIN ban đầu/reset chỉ trả về trong response cho admin và gửi email; trường `params.newPin` của op bị `$unset` khi confirm hoặc khi op hết hạn.
  - `keys/` nằm trong `.gitignore`. Khoá server thật không bao giờ được commit.
- **Kiểm thử:**
  - Unit: `npm test` = `node --test "test/*.test.js"`.
  - Integration (cần Mongo): `npm run test:integration` = `node --test "test/integration/*.test.js"`. Chỉ chạy khi có `TEST_DATABASE`, không có thì `skip`. **Không bao giờ trỏ vào DB thật.**
- **Commit message:** tiếng Anh, tiền tố `feat(card):` / `test(card):` / `refactor(payment):`.

## Review Focus

1. **Mất biên nhận sau DEBIT** (đóng tab sau khi thẻ đã trừ tiền nhưng trước khi confirm) → phiên sau, sync dùng GET_RECEIPT khôi phục; đơn chuyển `paid` đúng một lần; `pay/prepare` từ chối khi đơn còn debit `sent`. Test: `card-sync.test.js` → `sentTxComesFirst`, integration `card-op.test.js` → `receiptRecoveryAppliesOnce`, checklist Task 13.
2. **Confirm cùng một op hai lần** (double-click, retry mạng) → chỉ lần đầu có hiệu lực. Test: `card-op.test.js` → `doubleConfirmAppliesOnce` (Task 5).
3. **Dùng opId hoặc đơn hàng của người khác** → `OP_FORBIDDEN`, đơn không đổi. Test: `card-op.test.js` → `otherActorCannotSign` (Task 5) và `payOtherCustomersOrderRejected` (Task 13).
4. **Thẻ nhân viên bị thu hồi khi đang đăng nhập** → request admin kế tiếp bị đá về trang login. Test: `admin-auth.test.js` → `revokedStaffCardLogsOut` (Task 8).
5. **Callback / return URL nạp tiền bị gọi lặp** (ZaloPay retry, F5 trang VNPay) → chỉ cộng một lần. Test: `topup.test.js` → `paidTwiceCreditsOnce` (Task 14).

---

## Cấu trúc file

```
package.json                         + scripts test, test:integration, card:keygen
.env.example, .gitignore             + biến CARD_*, keys/
index.js                             + app.locals.cardAgentUrl
scripts/generate-card-key.js
public/assets/js/card/card-shared.js UMD: INS/STATE/SW/TLV/PIN/apdu/hex
public/assets/js/card/card-client.js UMD factory: agent + điều phối server + hộp nhập PIN
helpers/card-crypto.helper.js        ký/kiểm, escrow, sinh PIN
helpers/card-apdu.helper.js          dựng/parse APDU phía server
helpers/card-log.helper.js
helpers/tier.helper.js
helpers/wallet-rule.helper.js
helpers/card-op.helper.js            Card Operation engine
helpers/card-sync.helper.js          planNextSync + loadSyncContext
helpers/card-auth.helper.js          nonce + kiểm AUTHENTICATE
helpers/admin-token.helper.js        cấp cookie token admin (tách từ account.controller)
helpers/zalopay.helper.js, helpers/vnpay.helper.js, helpers/order-payment.helper.js
helpers/ticket.helper.js
models/customer|card|card-transaction|card-log|card-nonce|card-operation.model.js
middlewares/client/customer-auth.middleware.js
controllers/admin/card.controller.js, controllers/admin/card-checkin.controller.js
controllers/client/card-api.controller.js, controllers/client/account.controller.js
routes/admin/card.route.js, routes/client/card-api.route.js, routes/client/account.route.js
validates/admin/card.validate.js, validates/client/card.validate.js
views/admin/pages/card-list|card-detail|card-issue|card-log|card-checkin.pug
views/client/pages/account-login|account-card|account-card-lock|order-payment-card.pug
views/admin/partials/card-pin-modal.pug, views/client/partials/card-pin-modal.pug
public/admin/assets/js/card-admin.js, public/assets/js/card-customer.js
test/*.test.js, test/integration/*.test.js, test/helpers/db.js
```

---

### Task 1: Nền tảng — test runner, khoá, card-shared, crypto, APDU

**Files:**
- Modify: `package.json`
  - scripts `"test"`, `"test:integration"`, `"card:keygen": "node scripts/generate-card-key.js"`
- Modify: `.env.example`, `.gitignore`
  - thêm 3 biến CARD_* ở spec 5.1
  - thêm `keys/` vào `.gitignore`
- Modify: `index.js`
  - `app.locals.cardAgentUrl = process.env.CARD_AGENT_URL`
- Create:
  - `scripts/generate-card-key.js`
  - `public/assets/js/card/card-shared.js`
  - `helpers/card-crypto.helper.js`
  - `helpers/card-apdu.helper.js`
- Test:
  - `test/card-shared.test.js`
  - `test/card-crypto.test.js`
  - `test/card-apdu.test.js`

**Interfaces — Produces:**

`card-shared.js` (UMD, `module.exports` trong Node, `window.CardShared` trong trình duyệt):
- Hằng: `CLA`, `AID_HEX`, `INS{...}` (đủ 22 lệnh, tên theo spec 3.3 viết `UPPER_SNAKE`), `STATE{CREATED, ACTIVE, LOCKED, TERMINATED}`, `TARGET{PROFILE:1, PHOTO:2}`, `CHUNK`, `PROFILE_MAX`, `PHOTO_MAX`
- `toHex(Uint8Array) → string` (in hoa), `fromHex(string) → Uint8Array`
- `apdu(ins, p1, p2, data?) → hex`: `80 ins p1 p2 [Lc data] 00`
- `swMessage(sw) → string`: tiếng Việt cho mọi SW ở spec 3.4; `63Cx` → `"Sai mã PIN, còn x lần thử"`
- `encodeProfile(obj) → Uint8Array`: lỗi `PROFILE_TOO_LARGE` / `FIELD_TOO_LONG:<field>`
- `decodeProfile(bytes) → obj`
- `isPinFormat(pin) → bool`
- `isWeakPin(pin, dob?) → bool`: `dob` dạng `YYYYMMDD`

`card-crypto.helper.js` (đọc env **lazy** mỗi lần gọi, cache khoá theo path):
- `getServerModulusHex() → string(256)`
- `signServer(buf) → Buffer(128)`
- `verifyCardSignature(modulusHex, msg, sig) → bool`
- `deriveEscrowKey(cardIdHex) → Buffer(16)`
- `encryptResetPin(cardIdHex, pin) → Buffer(16)`
- `generatePin(dob?) → string`
- `randomHex(nBytes) → string`

`card-apdu.helper.js`:
- `buildCmdMessage({challengeHex, cardIdHex, ins, p1, p2, payload}) → Buffer`
- `signedApdu({...cùng tham số}) → hex`
- `buildInitData({cardIdHex, cardType, pin, kEscrow}) → Buffer(167)`
- `parsePublicInfo(hex) → {cardId, cardType, state, mustChangePin, triesRemaining, version}`
- `buildAuthMessage({nonceHex, cardIdHex, counter}) → Buffer`
- `parseReceipt(hex) → {message, signature, cardId, type:'credit'|'debit', txRef, amount, balanceAfter, txCounter} | null`
- `walletPayload(txRefHex, amount) → Buffer(12)`
- `encodeTicket({orderCode, tourId, departureDate, pax}) → Buffer(33)`: ngày theo `utcOffset(420)`
- `ticketKey({orderCode, tourId}) → Buffer(24)`

- [x] **Step 1: Viết test (sẽ fail)**

```js
// test/card-shared.test.js
test('apdu with data', () => assert.equal(S.apdu(0x20, 0, 0, S.fromHex('343832393135')), '8020000006343832393135' + '00'));
test('apdu without data', () => assert.equal(S.apdu(0x10, 0, 0), '8010000000'));
test('profile roundtrip utf8', () => { const p = {fullName:'Nguyễn Văn Việt', dob:'20040215', phone:'0901234567', allergies:'Hải sản'}; assert.deepEqual(S.decodeProfile(S.encodeProfile(p)), p); });
test('profile skips empty fields', () => assert.equal(S.encodeProfile({fullName:'A', phone:''}).length, 3));
test('profile field limit', () => assert.throws(() => S.encodeProfile({fullName:'x'.repeat(61)}), /FIELD_TOO_LONG:fullName/));
test('weak pins', () => { for (const p of ['000000','123456','654321','012345','987654','150204']) assert.ok(S.isWeakPin(p, '20040215'), p); assert.ok(!S.isWeakPin('482915', '20040215')); });
test('swMessage 63C2', () => assert.equal(S.swMessage('63C2'), 'Sai mã PIN, còn 2 lần thử'));

// test/card-crypto.test.js — đặt env TRƯỚC khi require helper
process.env.CARD_SERVER_KEY_PATH = 'smartcard/test-vectors/server-test-key.pem';
const V = require('../smartcard/test-vectors/vectors.json');
process.env.CARD_ESCROW_MASTER = V.escrowMaster;
test('server modulus matches applet vectors', () => assert.equal(C.getServerModulusHex(), V.serverModulus.toUpperCase()));
test('server signature byte-identical to Java', () => assert.equal(C.signServer(Buffer.from(V.command.message,'hex')).toString('hex'), V.command.signature.toLowerCase()));
test('verifies card auth signature from applet', () => { const msg = A.buildAuthMessage({nonceHex:V.auth.nonce, cardIdHex:V.cardId, counter:parseInt(V.auth.counter,16)}); assert.ok(C.verifyCardSignature(V.cardModulus, msg, Buffer.from(V.auth.signature,'hex'))); });
test('escrow key + reset pin match applet', () => { assert.equal(C.deriveEscrowKey(V.cardId).toString('hex'), V.escrowKey.toLowerCase()); assert.equal(C.encryptResetPin(V.cardId, V.resetPin.newPin).toString('hex'), V.resetPin.encPin.toLowerCase()); });
test('generatePin never weak', () => { for (let i = 0; i < 500; i++) { const p = C.generatePin('20040215'); assert.ok(S.isPinFormat(p) && !S.isWeakPin(p, '20040215')); } });

// test/card-apdu.test.js
test('cmd message layout == vectors', () => assert.equal(A.buildCmdMessage({challengeHex:V.command.challenge, cardIdHex:V.cardId, ins:0x70, p1:0x03, p2:0, payload:Buffer.alloc(0)}).toString('hex'), V.command.message.toLowerCase()));
test('parseReceipt from applet', () => { const r = A.parseReceipt(V.receipt.hex); assert.equal(r.type, 'credit'); assert.ok(C.verifyCardSignature(V.cardModulus, r.message, r.signature)); });
test('parseReceipt rejects wrong length', () => assert.equal(A.parseReceipt('52'.padEnd(330,'0')), null));
test('initData length 167', () => assert.equal(A.buildInitData({cardIdHex:V.cardId, cardType:1, pin:'482915', kEscrow:Buffer.alloc(16)}).length, 167));
test('ticket encoding', () => { const t = A.encodeTicket({orderCode:'OD1234567890', tourId:'65f0a1b2c3d4e5f601234567', departureDate:new Date('2026-12-14T20:00:00Z'), pax:3}); assert.equal(t.length, 33); assert.equal(t.subarray(24,32).toString(), '20261215'); assert.equal(t[32], 3); });
```

- [x] **Step 2: Chạy test, xác nhận fail**

  Run: `npm test`

  Expected: FAIL (`Cannot find module`).

- [x] **Step 3: Cài đặt 3 module và script sinh khoá**

  - `generate-card-key.js`:
    - `crypto.generateKeyPairSync('rsa', {modulusLength:1024, publicExponent:65537})`;
    - ghi PKCS#8 PEM vào `keys/card-server-private.pem`;
    - **từ chối ghi đè** nếu file đã tồn tại;
    - in ra một dòng `CARD_ESCROW_MASTER=<64 hex>`.
  - Public key của thẻ lấy từ modulus: `crypto.createPublicKey({key:{kty:'RSA', n:<base64url>, e:'AQAB'}, format:'jwk'})`.
  - Ký: `crypto.sign('sha256', msg, {key, padding: crypto.constants.RSA_PKCS1_PADDING})`.
  - AES: `aes-128-ecb` với `setAutoPadding(false)`.

- [x] **Step 4: Chạy test, xác nhận pass**

  Run: `npm test`

  Expected: mọi test pass.

- [x] **Step 5: Sinh khoá dev**

  Run: `npm run card:keygen`, rồi chép dòng in ra vào `.env` (không commit `.env`).

- [x] **Step 6: Commit** — `feat(card): shared card protocol helpers with cross-language vectors`

---

### Task 2: Test giao thức end-to-end qua agent sim

**Files:**
- Test: `test/card-e2e.test.js`

**Interfaces:**
- Consumes: mọi export của Task 1; agent `--sim` (plan 02)

- [ ] **Step 1: Viết test**

  Test chỉ chạy khi có `AGENT_URL`, không có thì `skip`. Server key và escrow master dùng bộ test (như `card-crypto.test.js`). Trước mỗi test gọi `POST /v1/sim/reset {"slot":0}`.

```js
test('issue → change pin → auth', async () => { /* SELECT, INIT (buildInitData) → verify 128B modulus; CHANGE_PIN; VERIFY; AUTHENTICATE với nonce ngẫu nhiên → verifyCardSignature == true */ });
test('signed lock/unlock', async () => { /* GET_CHALLENGE → signedApdu(SET_STATE, p1 = 3) → 9000; parsePublicInfo.state == 3 */ });
test('credit/debit receipts verify', async () => { /* CREDIT 1 500 000 → parseReceipt, verify, balanceAfter 1 500 000, txCounter 1; VERIFY + DEBIT 400 000 → balanceAfter 1 100 000 */ });
test('reset pin via escrow', async () => { /* RESET_PIN với encryptResetPin(cardId, '903172') → VERIFY '903172' == 9000 */ });
test('profile write+commit', async () => { /* encodeProfile → BEGIN/WRITE/COMMIT(sha256 ‖ len) → READ_DATA trả đúng byte đã ghi */ });
```

- [ ] **Step 2: Chạy test**

  Run: `(cd smartcard && ./gradlew :agent:run --args="--sim") &` rồi `AGENT_URL=http://127.0.0.1:31999 node --test test/card-e2e.test.js`

  Expected: PASS 5/5. Nếu FAIL, sửa helper ở Task 1, không sửa applet, trừ khi applet vi phạm spec.

- [ ] **Step 3: Commit** — `test(card): end-to-end protocol test against simulated card`

---

### Task 3: Model, quyền, nhật ký, hạng thành viên, quy tắc ví

**Files:**
- Create:
  - các model `models/customer.model.js`, `models/card.model.js`, `models/card-transaction.model.js`, `models/card-log.model.js`, `models/card-nonce.model.js`, `models/card-operation.model.js`
  - helper `helpers/card-log.helper.js`, `helpers/tier.helper.js`, `helpers/wallet-rule.helper.js`
  - test helper `test/helpers/db.js`
- Modify:
  - `models/account-admin.model.js`: `cardRequired`
  - `models/order.model.js`: `customerId`, `cardTxRef`
  - `config/permission.js`: 9 quyền ở spec 5.3, nhãn tiếng Việt
- Test: `test/tier.test.js`, `test/wallet-rule.test.js`, `test/integration/card-model.test.js`

**Interfaces — Produces:**
- Model:
  - trường đúng theo spec 5.2;
  - TTL: `expireAt: {type: Date, expires: 0}`, giống `ForgotPassword`;
  - `Card` có index `{cardId: 1}` unique và partial unique `{ownerId: 1, cardType: 1}` khi `isCurrent: true`.
- `cardLogHelper.write({action, cardId, actorType, actorId, result, detail, req}) → Promise<void>`: lấy `ip` từ `req.ip`; không bao giờ ném lỗi ra ngoài.
- `tierHelper.tierOf(totalSpent) → {code, label, percent}`
- `tierHelper.discountFor(totalSpent, subTotal) → number`
- `walletRule.checkOnlineTopup({balance, pendingSum, amount}) → null | string`
- `walletRule.checkCashTopup({amount, staffTodaySum}) → null | string`
- `test/helpers/db.js`:
  - `connect()`: `mongoose.connect(process.env.TEST_DATABASE)`
  - `reset()`: xoá mọi collection
  - `close()`
  - `const enabled = !!process.env.TEST_DATABASE`

- [ ] **Step 1: Viết test**

```js
// tier.test.js
test('boundaries', () => { assert.equal(T.tierOf(9_999_999).code, 'standard'); assert.equal(T.tierOf(10_000_000).code, 'silver'); assert.equal(T.tierOf(30_000_000).code, 'gold'); assert.equal(T.tierOf(80_000_000).code, 'platinum'); });
test('discount rounding', () => assert.equal(T.discountFor(30_000_000, 1_234_567), 61_728));

// wallet-rule.test.js
test('online min', () => assert.ok(W.checkOnlineTopup({balance:0, pendingSum:0, amount:9_999})));
test('online cap includes pending', () => { assert.equal(W.checkOnlineTopup({balance:40_000_000, pendingSum:5_000_000, amount:5_000_000}), null); assert.ok(W.checkOnlineTopup({balance:40_000_000, pendingSum:5_000_000, amount:5_000_001})); });
test('cash daily cap', () => { assert.equal(W.checkCashTopup({amount:5_000_000, staffTodaySum:15_000_000}), null); assert.ok(W.checkCashTopup({amount:5_000_001, staffTodaySum:15_000_000})); });

// integration/card-model.test.js (skip khi !enabled)
test('only one current card per owner+type', async () => { /* tạo 2 Card isCurrent = true cùng ownerId + cardType → lần 2 lỗi E11000; isCurrent = false → OK */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail**

  Run: `npm test`

- [ ] **Step 3: Cài đặt model, helper và quyền**

- [ ] **Step 4: Chạy test, xác nhận pass**

  Run: `npm test && TEST_DATABASE="<mongo test db>" npm run test:integration`

  Expected: PASS. Nếu không có Mongo test thì integration báo skip.

- [ ] **Step 5: Kiểm quyền mới hiển thị**

  Mở `/admin/setting/role/create`. Expected: 9 checkbox quyền thẻ mới xuất hiện.

- [ ] **Step 6: Commit** — `feat(card): card data models, permissions, tier and wallet rules`

---

### Task 4: Tách helper thanh toán và `markOrderPaid`

Phải giữ nguyên hành vi của luồng thanh toán hiện tại.

**Files:**
- Create: `helpers/zalopay.helper.js`, `helpers/vnpay.helper.js`, `helpers/order-payment.helper.js`
- Modify: `controllers/client/order.controller.js` (4 hàm `paymentZaloPay`, `paymentZaloPayResultPost`, `paymentVNPay`, `paymentVNPayResult` chuyển sang dùng helper)
- Test: `test/payment-helper.test.js`, `test/integration/order-payment.test.js`

**Interfaces — Produces:**
- `zalopay.createOrder({appUser, amount, description, redirectUrl, callbackPath}) → Promise<string|null>`: trả `order_url`
- `zalopay.verifyCallback(body) → {valid, data}`
- `vnpay.buildPaymentUrl({txnRef, amount, orderInfo, returnPath, ipAddr}) → string`
- `vnpay.verifyReturn(query) → {valid, txnRef, success}`: `success` = `vnp_ResponseCode == '00'`
- `orderPayment.markOrderPaid(filter, method) → Promise<boolean>`:
  - `findOneAndUpdate({...filter, paymentStatus:'unpaid'}, {paymentStatus:'paid'})`, nguyên tử;
  - khi có chuyển trạng thái và đơn có `customerId`: `Customer.totalSpent += total`, item có `ticketStatus` `'none'` hoặc chưa có → `'pending'`;
  - trả `true` chỉ ở lần chuyển trạng thái đầu tiên.

- [ ] **Step 1: Viết test**

```js
test('vnpay url verifies itself', () => { /* set VNPAY_SECRET/CODE/URL giả; url = buildPaymentUrl(...); query = parse(url) + vnp_ResponseCode = '00' ký lại theo đúng thuật toán → verifyReturn(query).valid && success */ });
test('vnpay tampered amount invalid', () => { /* đổi vnp_Amount → valid == false */ });
test('zalopay callback mac', () => { /* ZALOPAY_KEY2 giả; body {data, mac = HmacSHA256(data, key2)} → valid; mac sai → !valid */ });
// integration
test('markOrderPaid only once', async () => { /* đơn unpaid có customerId, total 1 000 000 → gọi 2 lần: true rồi false; totalSpent == 1 000 000; items[0].ticketStatus == 'pending' */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  Chuyển nguyên văn thuật toán ký đang có trong `order.controller.js` sang helper. Callback/return của đơn hàng gọi `markOrderPaid({_id: orderId, phone, deleted: false}, 'zalopay'|'vnpay')`.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Kiểm hồi quy thủ công**

  Đặt một đơn VNPay sandbox. Expected: vẫn chuyển hướng sang VNPay; khi quay về, đơn ở trạng thái `paid` như trước.

- [ ] **Step 6: Commit** — `refactor(payment): extract ZaloPay/VNPay helpers and idempotent markOrderPaid`

---

### Task 5: Card Operation engine, sync planner, endpoint `/card-api`

**Files:**
- Create:
  - `helpers/card-op.helper.js`, `helpers/card-sync.helper.js`, `helpers/ticket.helper.js` (phần chọn item)
  - `controllers/client/card-api.controller.js`, `routes/client/card-api.route.js`
- Modify: `routes/client/index.route.js` (mount `/card-api` **trước** `settingMiddleware`)
- Test: `test/card-sync.test.js`, `test/integration/card-op.test.js`

**Interfaces — Produces:**
- `cardOp.createOp({cardId, type, params, actorType, actorId}) → Promise<CardOperation>`
- `cardOp.signOp({opId, challengeHex, actorType, actorId}) → Promise<{apdu}>`
  - ném `CardOpError` với `code` ∈ `OP_NOT_FOUND | OP_FORBIDDEN | OP_STATE | CARD_STATE`
  - actor phải khớp, trừ op `actorType: 'system'` (op do sync tạo, ai ký cũng được)
  - credit/debit: CardTransaction → `sent`
- `cardOp.confirmOp({opId, responseHex, sw, actorType, actorId, req}) → Promise<{ok, message, result}>`
  - chiếm op bằng `findOneAndUpdate({_id, status:'prepared'}, {status:'confirming'})`
  - hiệu ứng theo bảng spec 6.3; ghi `CardLog`
- `cardOp.applyReceipt({card, tx, responseHex}) → Promise<boolean>`: 6 điều kiện kiểm biên nhận ở spec 6.3; dùng chung cho credit, debit và GET_RECEIPT
- `cardSync.planNextSync({card, cardState, sentTx, pendingCredit, pendingDeleteItem, pendingWriteItem})`
  - hàm **thuần**
  - trả `{kind:'receipt', txRef}` | `{kind:'op', type, params}` | `null`
- `cardSync.loadSyncContext(card) → Promise<ctx>`
- Endpoint (body/response JSON):

| Endpoint | Body | Response |
|---|---|---|
| `POST /card-api/sync/next` | `{cardId, cardState, challenge}` | `{code:'success', step: null \| {kind:'receipt', txRef, apdu} \| {kind:'op', opId, apdu}}` |
| `POST /card-api/sync/confirm` | `{opId, response, sw}` | |
| `POST /card-api/sync/receipt` | `{cardId, txRef, response, sw}` | |
| `POST /card-api/op/sign` | `{opId, challenge}` | `{apdu}` |
| `POST /card-api/op/confirm` | `{opId, response, sw}` | |

  `/sync/next` tự ký op luôn bằng `challenge` được gửi kèm.

- [ ] **Step 1: Viết `card-sync.test.js` (thuần)**

```js
const card = { cardId:'11'.repeat(16), status:'active', cardType:'customer' };
test('sentTxComesFirst', () => assert.deepEqual(P.planNextSync({card, cardState:2, sentTx:{txRef:'ab'.repeat(8)}, pendingCredit:{}}), {kind:'receipt', txRef:'ab'.repeat(8)}));   // Review Focus #1
test('revoked → terminate', () => assert.deepEqual(P.planNextSync({card:{...card, status:'revoked'}, cardState:2}), {kind:'op', type:'set-state', params:{state:0x7f}}));
test('locked server, active card → lock', () => assert.equal(P.planNextSync({card:{...card, status:'locked'}, cardState:2}).params.state, 0x03));
test('active server, locked card → unlock', () => assert.equal(P.planNextSync({card, cardState:3}).params.state, 0x02));
test('terminated card → nothing', () => assert.equal(P.planNextSync({card:{...card, status:'revoked'}, cardState:0x7f}), null));
test('priority credit > delete > write', () => { /* có đủ cả 3 → 'credit'; bỏ credit → 'delete-ticket'; bỏ tiếp → 'write-ticket' */ });
test('staff card skips wallet/tickets', () => assert.equal(P.planNextSync({card:{...card, cardType:'staff'}, cardState:2, pendingCredit:{txRef:'x'}}), null));
test('locked card gets no credit', () => assert.equal(P.planNextSync({card:{...card, status:'locked'}, cardState:3, pendingCredit:{txRef:'x'}}), null));
```

- [ ] **Step 2: Viết `integration/card-op.test.js`**

  Thẻ giả: dùng `crypto.generateKeyPairSync` RSA-1024 làm khoá thẻ; lưu modulus vào `Card`; biên nhận ký bằng khoá này theo `M_rcpt`.

```js
test('credit confirm updates ledger', async () => { /* tx pending-card 500 000 → createOp credit, signOp (apdu parse: INS 51, payload = txRef ‖ 0007A120) → tx 'sent' → confirm với biên nhận counter 1, balanceAfter 500 000 → tx done, card.balance 500 000, txCounter 1 */ });
test('doubleConfirmAppliesOnce', async () => { /* gửi confirm như trên 2 lần song song (Promise.all) → đúng 1 ok; balance 500 000 */ });   // Review Focus #2
test('wrongCounterRejected', async () => { /* biên nhận counter 2 → ok false, tx 'sent', balance 0 */ });
test('forgedReceiptRejected', async () => { /* ký bằng khoá khác → ok false */ });
test('otherActorCannotSign', async () => { /* op actorType customer A; signOp với customer B → OP_FORBIDDEN */ });  // Review Focus #3
test('receiptRecoveryAppliesOnce', async () => { /* tx debit 'sent' cho đơn X → POST sync/receipt với biên nhận hợp lệ → đơn paid; gửi lại lần 2 → không đổi, totalSpent tăng đúng 1 lần */ });  // Review Focus #1
test('sw failure marks op failed', async () => { /* confirm sw 6F20 → op failed; credit tx quay lại 'pending-card' */ });
```

- [ ] **Step 3: Chạy test, xác nhận fail**

  Run: `npm test` và `npm run test:integration`

- [ ] **Step 4: Cài đặt engine, planner, controller và route**

  Payload cho từng type:
  - `set-state`: rỗng
  - `reset-pin`: `encryptResetPin(cardId, params.newPin)`
  - `credit` / `debit`: `walletPayload(tx.txRef, tx.amount)`
  - `*-ticket`: `encodeTicket` / `ticketKey` từ `Order.items[params.itemIndex]`
  - `commit-write`: `sha256(params.dataHex) ‖ len2`

  Khi confirm, SW ≠ `9000`:
  - op → `failed`;
  - credit: tx về `pending-card`;
  - debit: tx `failed` **chỉ khi** SW là `6F10` / `6F20` / `6F21` / `6982`. Các SW khác giữ `sent` để sync khôi phục.

  Endpoint `sync/next`: nếu `card` không tồn tại hoặc `status ∈ {issuing, failed}` → `step: null`.

- [ ] **Step 5: Chạy test, xác nhận pass**

- [ ] **Step 6: Commit** — `feat(card): signed card operation engine and sync planner`

---

### Task 6: `card-client.js` trên trình duyệt và hộp nhập PIN

**Files:**
- Create: `public/assets/js/card/card-client.js`
- Create: `views/admin/partials/card-pin-modal.pug`, `views/client/partials/card-pin-modal.pug` (cùng markup: `[card-pin-modal]`, input `type=password inputmode=numeric maxlength=6`, nút Huỷ/Xác nhận)
- Modify: `views/admin/layouts/default.pug`, `views/client/layouts/default.pug`
  - include modal
  - `script window.CARD_AGENT_URL = "#{cardAgentUrl}"`
  - nạp `card-shared.js` rồi `card-client.js`
- Test: `test/card-client.test.js`

**Interfaces — Produces:**

`CardClient.create({agentUrl, fetch, askPin}) → client`. Trên trình duyệt có sẵn `window.cardClient`. Client gồm các hàm:
- `status() → Promise<object|null>`
- `transmit(apdus) → Promise<[{data, sw}]>`
- `cmd(ins, p1, p2, bytes?) → Promise<Uint8Array>`: SW ≠ 9000 → ném `CardError{sw, message: swMessage(sw)}`
- `openSession({syncBase = '/card-api/sync'}) → Promise<info>`
  - SELECT → INFO
  - nếu `state ∉ {CREATED, TERMINATED}`: vòng sync tối đa 10 bước
  - trả INFO mới
- `verifyPin(pin)`
- `changePin(oldPin, newPin)`: chặn PIN yếu ngay trên trình duyệt bằng `isWeakPin`
- `getChallenge() → hex`
- `runSignedOp({signUrl, confirmUrl, opId}) → server JSON`
- `writeTarget(target, bytes)`: chỉ BEGIN + WRITE, không commit
- `readTarget(target) → Uint8Array`
- `readProfile() → obj`
- `readPhotoUrl() → string` (blob URL)
- `readBalance() → {balance, counter}`
- `readTxLog() → [{type, amount, balanceAfter, counter, txRef}]`
- `readTickets() → [{status, orderCode, tourId, departure, pax}]`
- `authenticate({challengeUrl, verifyUrl, body?})`
  - POST `challengeUrl` → `{nonce}`
  - `AUTHENTICATE`
  - POST `verifyUrl` `{cardId, nonce, counter, signature, ...body}`
- `askPin(title) → Promise<string>`

- [ ] **Step 1: Viết test**

  Dùng `fetch` giả: agent giả trả theo kịch bản, server giả ghi lại body.

```js
test('openSession loops sync until null', async () => { /* /sync/next trả op 2 lần rồi null → agent nhận 2 lần GET_CHALLENGE + 2 APDU op; /sync/confirm được gọi 2 lần */ });
test('openSession stops after 10 steps', async () => { /* server luôn trả op → đúng 10 vòng rồi ném lỗi 'SYNC_LOOP' */ });
test('cmd throws CardError with message', async () => { /* agent trả sw 63C3 → err.message == 'Sai mã PIN, còn 3 lần thử' */ });
test('runSignedOp posts challenge then response', async () => { /* thứ tự: agent GET_CHALLENGE → POST sign {opId, challenge} → agent apdu → POST confirm {opId, response, sw} */ });
test('writeTarget chunks 224', async () => { /* 500B → BEGIN Lc 2 = 01F4; WRITE P2 = 0, 1, 2 với Lc 224, 224, 52 */ });
test('agent down → friendly error', async () => { /* fetch reject → err.message chứa 'Không kết nối được Card Agent' */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  Dạng UMD giống `card-shared.js`. Trong Node, `require('./card-shared.js')`; trên trình duyệt, đọc `window.CardShared`.

  `askPin` mặc định trên trình duyệt:
  - mở `[card-pin-modal]`;
  - resolve khi bấm Xác nhận;
  - reject `PIN_CANCELLED` khi bấm Huỷ;
  - xoá giá trị input sau khi dùng.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Commit** — `feat(card): browser card client with sync loop and PIN modal`

---

### Task 7: Phát hành thẻ (A1), danh sách khách hàng, menu

**Files:**
- Create: `controllers/admin/card.controller.js` (`issue`, `issuePrepare`, `issueInitConfirm`, `issueFinish`, `issueCancel`, `opSign`, `opConfirm`), `routes/admin/card.route.js`, `validates/admin/card.validate.js`, `views/admin/pages/card-issue.pug`, `public/admin/assets/js/card-admin.js`
- Modify:
  - `routes/admin/index.route.js`: `router.use('/card', authMiddleware.verifyToken, cardRoutes)`
  - `controllers/admin/user.controller.js` + `views/admin/pages/user-list.pug`: liệt kê `Customer` cùng trạng thái thẻ hiện tại, ô tìm kiếm theo tên/email/SĐT
  - `views/admin/partials/sider.pug`: các mục "Quản lý thẻ" (`card-view`), "Check-in tour" (`card-checkin`), "Nhật ký thẻ" (`card-log-view`)

**Interfaces:**
- Consumes: Task 1, 3, 5, 6
- Produces:
  - `POST /admin/card/issue/prepare`
    - body:
      - `{ownerType:'customer', customerId?, customer?:{fullName, email, phone, dob, gender, idNumber, emergencyName, emergencyPhone, bloodType, allergies}, photoBase64, replaceOf?}`
      - hoặc `{ownerType:'staff', accountId, photoBase64}`
    - response `{code, cardId, initApdu, initialPin, profileOpId, profileHex, photoOpId}`
  - `POST /admin/card/issue/init-confirm {cardId, response, sw}`
  - `POST /admin/card/issue/finish {cardId}`
  - `POST /admin/card/issue/cancel {cardId}`
  - `POST /admin/card/op/sign`, `POST /admin/card/op/confirm`: cùng hợp đồng với `/card-api/op/*`, actor là admin
  - Hàm dùng chung trong `card-admin.js`:
    - `preparePhoto(file) → Promise<Uint8Array>`: canvas 160×200 cắt giữa, JPEG chất lượng 0.8 → 0.3 (bước 0.1) cho tới khi ≤ 10 080 byte; vẫn lớn thì báo lỗi
    - `issueFlow(formData)`

- [ ] **Step 1: Cài đặt `issuePrepare`**

  Quyền: `card-issue`. Các quy tắc phải kiểm:
  - **Khách:** email bắt buộc; không có `customerId` thì tạo Customer mới.
  - **Nhân viên:** `AccountAdmin.status === 'active'`.
  - **Một thẻ hiện hành:** đã có thẻ `isCurrent` → `"Người này đã có thẻ đang hoạt động"`, **trừ khi** `replaceOf` trỏ tới thẻ đó và thẻ đã `revoked`.
  - **Ảnh:** `photoBase64` giải mã ra JPEG (bắt đầu bằng `FFD8`), ≤ 10 080 byte; upload Cloudinary và gán vào `Customer.avatar` (dùng cấu hình trong `helpers/cloudinary.helper.js`).
  - **Thẻ:** `cardId = randomHex(16)`, PIN = `generatePin(dob)`; tạo Card `issuing` với `isCurrent: true`.
  - **Op nháp:**
    - commit-write hồ sơ: `params: {target: 1, dataHex}`, `dataHex = encodeProfile`;
    - commit-write ảnh: `params: {target: 2, dataHex}`.

- [ ] **Step 2: Cài đặt `issueInitConfirm`, `issueFinish`, `issueCancel`**

  - `issueInitConfirm`: `sw == 9000` và response đúng 128 byte → lưu `publicKeyModulus`.
  - `issueFinish`:
    - hai op commit-write phải `done`;
    - Card → `active`, `issuedBy`, `issuedAt`;
    - gửi `mailHelper.sendMail(email, "Thẻ thành viên của bạn", <PIN ban đầu + hướng dẫn đổi PIN>)`;
    - nếu là thẻ nhân viên: `cardRequired = true`;
    - ghi log `issue`.
  - `issueCancel`: Card → `failed`, `isCurrent: false`; ghi log.

- [ ] **Step 3: Cài đặt `card-issue.pug` và `issueFlow`**

  Form có: chọn loại thẻ; với khách, chọn khách cũ hoặc nhập mới; với nhân viên, chọn tài khoản; ảnh có xem trước.

  `issueFlow` trình tự:
  1. `openSession()` và yêu cầu `state == CREATED`.
  2. `prepare`.
  3. `transmit(initApdu)`.
  4. `init-confirm`.
  5. `verifyPin(initialPin)`.
  6. `writeTarget(1, profileHex)` → `runSignedOp(profileOpId)`.
  7. `writeTarget(2, photo)` → `runSignedOp(photoOpId)`.
  8. `finish`.
  9. Hiển thị PIN ban đầu một lần.

  Bất kỳ bước nào lỗi → gọi `cancel` và hiển thị lỗi kèm hướng dẫn reset thẻ (sim: nút "Reset thẻ ảo" gọi `/v1/sim/reset`).

- [ ] **Step 4: Kiểm thủ công** (agent `--sim`, tài khoản admin có quyền `card-issue`)

  1. Phát hành thẻ khách mới.
     Expected:
     - hiện PIN ban đầu;
     - email được gửi;
     - `cards` có bản ghi `active` với modulus 256 hex;
     - `card-logs` có `issue`.
  2. Phát hành tiếp cho cùng khách đó. Expected: báo lỗi "đã có thẻ".
  3. Dùng ảnh 5 MB. Expected: tự nén xuống ≤ 10 080 byte.
  4. Tắt agent giữa chừng. Expected: Card → `failed`; reset slot sim rồi phát hành lại được.
  5. Vào `/admin/user/list`. Expected: thấy khách và trạng thái thẻ.

- [ ] **Step 5: Commit** — `feat(card): admin card issuance and customer list`

---

### Task 8: Đăng nhập admin bằng thẻ nhân viên và step-up (A0)

**Files:**
- Create: `helpers/admin-token.helper.js`, `helpers/card-auth.helper.js`
- Modify:
  - `controllers/admin/account.controller.js`: `loginPost` dùng `adminToken.issue`; thêm `loginCardChallenge`, `loginCardVerify`
  - `routes/admin/account.route.js`: 2 route `/login-card/challenge` và `/login-card/verify`
  - `middlewares/admin/auth.middleware.js`
  - `controllers/admin/card.controller.js`: `stepUpChallenge`, `stepUpVerify`
  - `routes/admin/card.route.js`
  - `views/admin/pages/login.pug` và JS đăng nhập trong `public/admin/assets/js/script.js`: xử lý `code:'card-required'`
- Test: `test/integration/admin-auth.test.js`

**Interfaces — Produces:**
- `adminToken.issue(res, {account, cardId?, stepUpAt?, remember}) → void`: giữ nguyên thời hạn và cookie flags của code cũ
- `cardAuth.issueNonce({purpose, accountId?}) → Promise<string>`
- `cardAuth.verify({purpose, cardId, nonce, counter, signature, accountId?}) → Promise<{card} | {error}>`
  - nonce phải tồn tại, chưa dùng, đúng `purpose` và `accountId`; đánh dấu dùng **nguyên tử**
  - chữ ký `M_auth` hợp lệ
  - Card `active`
  - ghi CardLog `auth`; `counter-anomaly` khi `counter > txCounter` mà không có tx `sent`
- `req.stepUpAt` (Date | undefined)
- `stepUp.isFresh(req) → bool`: ≤ 5 phút; đặt trong `admin-token.helper.js`

- [ ] **Step 1: Viết `admin-auth.test.js`**

  Gọi trực tiếp middleware với `req`/`res` giả, DB test.

```js
test('revokedStaffCardLogsOut', async () => { /* account cardRequired, Card staff revoked; token chứa cardId đó → res.redirect('/admin/account/login') và clearCookie('token') */ });  // Review Focus #4
test('cardRequired token without cardId rejected', async () => { /* token kiểu cũ (không có cardId) → redirect */ });
test('legacy account without card still works', async () => { /* cardRequired false → next() được gọi */ });
test('nonce single use', async () => { /* verify 2 lần cùng nonce (chữ ký hợp lệ bằng khoá thẻ giả) → lần 2 trả error */ });
test('nonce wrong purpose', async () => { /* nonce 'login-customer' dùng cho 'login-staff' → error */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  **`loginPost`**, sau khi kiểm mật khẩu và trạng thái:
  - `cardRequired` và **không** có Card staff `active` → `{code:'error', message:'Thẻ nhân viên đã bị khoá hoặc thu hồi. Liên hệ quản trị viên.'}`.
  - `cardRequired` và có thẻ → cookie `preToken` (5 phút, httpOnly, sameSite strict) và `{code:'card-required'}`.
  - Ngược lại → `adminToken.issue` như cũ.

  **`loginCardVerify`**:
  - đọc `preToken`;
  - `cardAuth.verify({purpose:'login-staff', accountId})`;
  - thẻ phải là `staff` và `ownerId` = account;
  - `adminToken.issue({cardId, stepUpAt: now})`, xoá `preToken`.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Kiểm thủ công**

  1. Phát hành thẻ nhân viên cho chính mình (Task 7) → đăng xuất → đăng nhập. Expected: hiện hộp nhập PIN; đúng PIN thì vào được dashboard.
  2. Nhập sai PIN. Expected: thông báo "còn x lần".
  3. Rút thẻ (`/v1/sim/slot` sang slot trống). Expected: báo lỗi rõ ràng.

- [ ] **Step 6: Commit** — `feat(card): staff card login and step-up authentication`

---

### Task 9: Danh sách, chi tiết, khoá/mở/thu hồi, nhật ký (A2, A3, A4, A10)

**Files:**
- Modify: `controllers/admin/card.controller.js` (`list`, `detail`, `statusPost`, `log`), `routes/admin/card.route.js`, `public/admin/assets/js/card-admin.js`
- Create: `views/admin/pages/card-list.pug`, `card-detail.pug`, `card-log.pug`
- Test: `test/card-status.test.js`

**Interfaces — Produces:**
- `cardStatus.nextStatus(current, action) → string | null`: hàm thuần, đặt trong `helpers/card-op.helper.js`
  - `lock`: `active` → `locked`
  - `unlock`: `locked` → `active`
  - `revoke`: `active` / `locked` / `issuing` → `revoked`
  - các trường hợp khác → `null`
- `POST /admin/card/status {cardId, action, reason, refunded?}`
- Trang chi tiết có các vùng `[card-actions]` để Task 10 và 11 gắn nút

- [ ] **Step 1: Viết `card-status.test.js`**

```js
test('transitions', () => { assert.equal(S.nextStatus('active','lock'), 'locked'); assert.equal(S.nextStatus('locked','unlock'), 'active'); assert.equal(S.nextStatus('revoked','unlock'), null); assert.equal(S.nextStatus('failed','revoke'), null); });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt `nextStatus`. Chạy test, xác nhận pass.**

- [ ] **Step 3: Cài đặt `statusPost`**

  - **Quyền:** lock/unlock cần `card-lock`; revoke cần `card-revoke` **và** `isFresh(req)`. Step-up hết hạn → `{code:'step-up-required'}`, JS tự chạy step-up rồi gửi lại request.
  - **Thu hồi:**
    - lý do bắt buộc;
    - `balance > 0` mà không có `refunded: true` → lỗi `"Thẻ còn số dư, hãy xác nhận đã hoàn tiền hoặc dùng Cấp lại thẻ"`;
    - `refunded` → tạo CardTransaction debit `source: 'refund'`, `status: 'done'`, rồi `balance = 0`;
    - đặt `isCurrent = false`.
  - **Nhật ký:** ghi CardLog. Response kèm gợi ý "Cắm thẻ để đồng bộ"; nút "Đồng bộ ngay" gọi `openSession()`.

- [ ] **Step 4: Cài đặt `list`, `detail`, `log`**

  - **`list`** (`card-view`): lọc `status` / `cardType` / từ khoá (tên chủ thẻ, cardId), 20 bản ghi mỗi trang theo pattern trang tour list.
  - **`detail`:**
    - thông tin thẻ và chủ thẻ;
    - số dư server cùng các credit đang chờ;
    - CardTransaction mới nhất trước;
    - các item vé của chủ thẻ;
    - 50 log gần nhất.
  - **`log`** (`card-log-view`): lọc `cardId` / `action` / khoảng ngày, chỉ xem, không có nút xoá.

- [ ] **Step 5: Kiểm thủ công**

  1. Khoá thẻ khi thẻ đang cắm → bấm "Đồng bộ ngay". Expected: `GET_PUBLIC_INFO` trả state `03`.
  2. Mở khoá rồi đồng bộ. Expected: state `02`.
  3. Thu hồi khi step-up đã quá 5 phút. Expected: hiện yêu cầu step-up trước.
  4. Thu hồi thẻ đang cắm rồi đồng bộ. Expected: state `7F`; mọi thao tác sau đó báo "Thẻ đã bị thu hồi".
  5. Thu hồi thẻ nhân viên của một tài khoản khác. Expected: tài khoản đó bị đá ra ở request kế tiếp.

- [ ] **Step 6: Commit** — `feat(card): card list, detail, lock/unlock/revoke and audit log`

---

### Task 10: Reset PIN (A5) và nạp tiền mặt (A8)

**Files:**
- Modify: `controllers/admin/card.controller.js` (`resetPinPost`, `topupCashPost`), `routes/admin/card.route.js`, `views/admin/pages/card-detail.pug`, `public/admin/assets/js/card-admin.js`
- Test: `test/integration/card-admin-ops.test.js`

**Interfaces — Produces:**
- `POST /admin/card/reset-pin {cardId}` → `{opId}`
  - quyền `card-reset-pin` + step-up
  - Card phải `active`
  - op `reset-pin` với `params.newPin = generatePin(dob)`
- Khi confirm op `reset-pin` thành công, response có `result.newPin` (lần duy nhất được trả ra); gửi email; `$unset params.newPin`
- `POST /admin/card/topup-cash {cardId, amount}` → `{txRef}`
  - quyền `card-topup` + step-up
  - thẻ khách `active`
  - `checkCashTopup` với `staffTodaySum` = tổng credit `source: 'cash'` mà `createdBy` = người này, tính từ 00:00 giờ Việt Nam
  - đồng thời phải thoả `checkOnlineTopup` (giới hạn 50 triệu)
  - tạo tx `pending-card`; sync sẽ thực hiện CREDIT

- [ ] **Step 1: Viết test**

```js
test('reset pin op hides pin after confirm', async () => { /* createOp reset-pin → confirm sw 9000 → result.newPin có giá trị; đọc lại op từ DB: params.newPin undefined */ });
test('cash topup daily cap per staff', async () => { /* 2 tx cash done hôm nay tổng 18 000 000 của staff A → topup 2 500 000 bị từ chối; staff B → OK */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt. Chạy test, xác nhận pass.**

- [ ] **Step 3: Kiểm thủ công**

  1. Cố tình sai PIN 5 lần để khoá → Reset PIN. Expected: PIN mới hiện ra; trên thẻ `mustChangePin = 1`; khách đổi PIN được; hồ sơ đọc lại vẫn đúng.
  2. Nạp tiền mặt 500 000 khi thẻ đang cắm. Expected: JS tự chạy `openSession()`; `GET_BALANCE` trên thẻ = server = 500 000; tx `done`.

- [ ] **Step 4: Commit** — `feat(card): admin PIN reset via escrow and cash top-up`

---

### Task 11: Sửa hồ sơ/ảnh trên thẻ (A7) và cấp lại thẻ (A6)

**Files:**
- Modify: `controllers/admin/card.controller.js` (`profileBuildPost`, `replacePost`, mở rộng `issueFinish`), `routes/admin/card.route.js`, `views/admin/pages/card-detail.pug`, `card-issue.pug`, `public/admin/assets/js/card-admin.js`
- Test: `test/integration/card-replace.test.js`

**Interfaces — Produces:**
- `POST /admin/card/profile/build {cardId, fields?, photoBase64?}` → `{profileOpId?, profileHex?, photoOpId?}`
  - quyền `card-edit`
  - `params.customerUpdate` lưu thay đổi; thay đổi chỉ áp vào Customer khi op `done`
- `POST /admin/card/replace {cardId, reason}` → `{redirect: '/admin/card/issue?replaceOf=<cardId>'}`
  - quyền `card-issue` + `card-revoke` + step-up
  - thu hồi với lý do `replaced`, **không** đòi `refunded`
- `issueFinish` khi có `replaceOf`, làm trong cùng luồng xử lý:
  - thẻ cũ có `balance > 0` → debit `transfer` `done` ở server cho thẻ cũ (balance về 0) và credit `transfer` `pending-card` cho thẻ mới;
  - item của khách đang `written` → `pending`;
  - thẻ mới lưu `replaceOf`.

- [ ] **Step 1: Viết test**

```js
test('replace transfers balance and tickets', async () => { /* thẻ cũ balance 700 000, 1 item written → replace → issue thẻ mới (giả lập các bước) → finish: thẻ cũ balance 0, tx transfer debit done; thẻ mới có credit pending-card 700 000; item 'pending' */ });
test('profile update applies only on done', async () => { /* build với phone mới → Customer.phone chưa đổi; confirm commit-write 9000 → đã đổi; confirm 6A80 → không đổi */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt. Chạy test, xác nhận pass.**

- [ ] **Step 3: Kiểm thủ công**

  1. Sửa SĐT và ảnh của thẻ đang cắm (khách nhập PIN). Expected: đọc lại hồ sơ và ảnh từ thẻ đều đúng bản mới.
  2. Cấp lại thẻ có số dư và vé: dùng sim slot 1 làm thẻ mới, sau đó mở phiên. Expected: số dư được chuyển lên thẻ mới, vé được ghi lại; thẻ cũ (slot 0) khi cắm vào thì bị TERMINATE.

- [ ] **Step 4: Commit** — `feat(card): on-card profile/photo update and card replacement`

---

### Task 12: Khách đăng nhập bằng thẻ, trang tài khoản thẻ, khoá thẻ qua OTP (U1, U2, U3, U7, U8)

**Files:**
- Create:
  - `middlewares/client/customer-auth.middleware.js`
  - `controllers/client/account.controller.js`, `routes/client/account.route.js`
  - `validates/client/card.validate.js`
  - `views/client/pages/account-login.pug`, `account-card.pug`, `account-card-lock.pug`
  - `public/assets/js/card-customer.js`
- Modify:
  - `routes/client/index.route.js`: `router.use(customerAuth.optional)` + mount `/account`
  - `controllers/client/card-api.controller.js`: `loginChallenge`, `loginVerify`, `logout`, `profileBuild`
  - `views/client/partials/header.pug`: nút "Đăng nhập bằng thẻ", hoặc tên khách + "Thẻ của tôi" + "Đăng xuất"

**Interfaces — Produces:**
- `customerAuth.optional`: đọc `customerToken`; hợp lệ khi thẻ `active` và chủ là khách đó; đặt `req.customer`, `req.card`, `res.locals.customer`; token sai thì xoá cookie
- `customerAuth.required`: chưa đăng nhập thì chuyển về `/account/login`
- `POST /card-api/login/challenge` → `{nonce}`
- `POST /card-api/login/verify` → cookie `customerToken` (spec 6.5), đặt `card.activatedAt` nếu chưa có
- `POST /card-api/logout`
- `POST /card-api/profile/build {phone, emergencyName, emergencyPhone}` (required) → `{opId, profileHex}`
  - chỉ 3 trường này được thay đổi, các trường khác giữ nguyên từ Customer
- Route:
  - `GET /account/login`
  - `GET /account/card` (required)
  - `GET /account/card-lock`
  - `POST /account/card-lock/otp {email}`
  - `POST /account/card-lock/confirm {email, otp}`

- [ ] **Step 1: Cài đặt middleware, login và logout**

  `account-login.pug`, trình tự:
  1. `openSession()`.
  2. Nếu `mustChangePin`: bắt nhập PIN cũ, PIN mới 2 lần → `changePin`. Đây là U1.
  3. `askPin` → `verifyPin`.
  4. `authenticate({challengeUrl:'/card-api/login/challenge', verifyUrl:'/card-api/login/verify'})`.
  5. Chuyển hướng tới `/account/card`.

- [ ] **Step 2: Cài đặt `account-card.pug` + `card-customer.js`**

  **Phần server (không cần thẻ):**
  - hạng thành viên (`tierOf`);
  - số dư server và tổng credit đang chờ;
  - bảng CardTransaction.

  **Phần thẻ** (nút "Đọc thẻ", cần PIN):
  - ảnh và hồ sơ;
  - `readBalance` + `readTxLog`. Nếu `balance` trên thẻ ≠ server → banner `"Số dư trên thẻ và hệ thống chưa khớp — đang đồng bộ"`, chạy `openSession()` rồi đọc lại;
  - danh sách vé (`readTickets`);
  - đổi PIN;
  - sửa SĐT / liên hệ khẩn cấp: `profile/build` → `writeTarget` → `runSignedOp`.

- [ ] **Step 3: Cài đặt khoá thẻ qua OTP**

  - OTP 6 số, hiệu lực 5 phút, dùng `ForgotPassword` (`email`, `otp`, `expireAt`).
  - Email không tồn tại hoặc không có thẻ `active` vẫn trả **cùng thông điệp** "Nếu email hợp lệ, mã OTP đã được gửi", để không lộ thông tin tài khoản.
  - OTP đúng:
    - Card → `locked`, `lockedReason: 'customer-reported-lost'`;
    - xoá các bản ghi OTP;
    - ghi CardLog actor `customer`;
    - email thông báo.

- [ ] **Step 4: Kiểm thủ công**

  1. Thẻ mới phát hành → đăng nhập. Expected: bị bắt đổi PIN; PIN `123456` bị từ chối; sau đó vào được trang thẻ.
  2. Đọc thẻ. Expected: hiện đúng ảnh và hồ sơ.
  3. Sửa SĐT. Expected: thẻ và Customer cùng đổi.
  4. Khoá thẻ qua OTP. Expected: phiên hiện tại bị đăng xuất ở request kế tiếp; cắm thẻ và đăng nhập lại thì sync đẩy LOCK và báo "Thẻ đang bị khoá".
  5. OTP sai hoặc hết hạn. Expected: báo lỗi, thẻ không bị khoá.

- [ ] **Step 5: Commit** — `feat(card): customer card login, card account page and OTP self-lock`

---

### Task 13: Thanh toán bằng ví thẻ, giảm giá theo hạng, tự điền (U5-debit, U9, U4)

**Files:**
- Modify:
  - `config/variable.js`: thêm `{label: "Ví thẻ thành viên", value: "card"}` vào `paymentMethod`
  - `controllers/client/order.controller.js`:
    - `createPost`: thêm `customerId`, `discount`, `ticketStatus: 'none'` cho mọi item; `paymentMethod === 'card'` mà chưa đăng nhập → lỗi
    - thêm `paymentCard`
  - `routes/client/order.route.js`: `GET /payment-card`
  - `controllers/client/card-api.controller.js`: `payPrepare`
  - `public/assets/js/script.js`, phần Order Form: `card` → `/order/payment-card?orderId=`; nút "Điền từ thẻ"
  - `views/client/pages/cart.pug`: điền sẵn họ tên và SĐT từ `customer` nếu đã đăng nhập
- Create: `views/client/pages/order-payment-card.pug`
- Test: `test/integration/card-pay.test.js`

**Interfaces — Produces:**
- `POST /card-api/pay/prepare {orderId}` (required) → `{opId, amount}`
  - đơn phải thuộc `req.customer`, `unpaid`, không `cancel`, không có debit `sent` hoặc `pending-card` cho đơn
  - `Card.balance ≥ total`, nếu không → `"Số dư ví không đủ"`
  - tạo CardTransaction debit `source: 'order'`, `orderId`, `amount = total`; tạo op `debit`; lưu `Order.cardTxRef`
- Nút "Điền từ thẻ" gọi `openSession` → `askPin` → `readProfile` rồi điền `fullName` và `phone`

- [ ] **Step 1: Viết test**

```js
test('payOtherCustomersOrderRejected', async () => { /* đơn của khách B, req.customer = A → code error, không tạo tx */ });  // Review Focus #3
test('pay prepare blocks while debit sent', async () => { /* đã có tx debit 'sent' cho đơn → error 'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ' */ });
test('createPost applies tier discount', async () => { /* customer totalSpent 30 000 000, subTotal 2 000 000 → discount 100 000, total 1 900 000 */ });
test('debit confirm marks paid and queues tickets', async () => { /* confirm biên nhận hợp lệ → order paid; items[].ticketStatus 'pending'; totalSpent tăng */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt. Chạy test, xác nhận pass.**

  Trang `order-payment-card.pug` hiển thị:
  - tổng tiền và số dư;
  - nút "Thanh toán" chạy `openSession` → `askPin` → `verifyPin` → `pay/prepare` → `runSignedOp` → chuyển hướng tới `/order/success?...`.

  Lỗi `6F10` / `6982` hiển thị bằng `swMessage`.

- [ ] **Step 3: Kiểm thủ công**

  1. Nạp 2 000 000 tiền mặt (Task 10) → đặt tour 1 500 000 bằng ví thẻ. Expected: đơn `paid`; số dư thẻ = server = 500 000; sync ghi vé (Task 15).
  2. **Mất biên nhận:** mở DevTools, chặn request `/card-api/op/confirm`, bấm thanh toán, rồi tải lại trang thẻ. Expected: sync gọi GET_RECEIPT; đơn chuyển `paid` đúng một lần; số dư đúng.
  3. Đặt đơn vượt số dư. Expected: "Số dư ví không đủ", thẻ không bị trừ.
  4. Khách hạng Gold. Expected: giỏ hàng hiển thị giảm 5%.

- [ ] **Step 4: Commit** — `feat(card): wallet payment, tier discount and card autofill`

---

### Task 14: Nạp ví online qua ZaloPay / VNPay (U5-credit)

**Files:**
- Modify:
  - `controllers/client/card-api.controller.js`: `topupPost`, `topupZaloPay`, `topupZaloPayResult`, `topupVnpay`, `topupVnpayResult`
  - `routes/client/card-api.route.js`
  - `views/client/pages/account-card.pug`: form nạp tiền
- Create: hàm `markTopupPaid(txId, source) → Promise<boolean>` trong `helpers/card-op.helper.js`
  - nguyên tử: `awaiting-payment` → `pending-card`
  - trả true chỉ ở lần chuyển trạng thái đầu tiên
- Test: `test/integration/topup.test.js`

**Interfaces — Produces:**
- `POST /card-api/topup {amount, method}` (required) → `{redirectUrl}`
  - `checkOnlineTopup` với `pendingSum` = tổng credit `pending-card` + `sent`
  - tạo tx credit `awaiting-payment`
- ZaloPay:
  - `appUser = "topup-" + txId`
  - `callbackPath = "/card-api/topup-zalopay-result"`
  - `redirectUrl = "/account/card?topup=1"`
- VNPay:
  - `txnRef = txRef`
  - `returnPath = "/card-api/topup-vnpay-result"`, sau đó chuyển hướng tới `/account/card?topup=1`
- Trang `/account/card?topup=1` tự gọi `openSession()` khi agent có thẻ, nếu không thì hiện "Cắm thẻ để nhận tiền"

- [ ] **Step 1: Viết test**

```js
test('paidTwiceCreditsOnce', async () => { /* markTopupPaid 2 lần → true, false; chỉ 1 tx pending-card */ });  // Review Focus #5
test('topup cap counts pending', async () => { /* balance 49 000 000 + pending 900 000 → nạp 200 000 bị từ chối */ });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt. Chạy test, xác nhận pass.**

- [ ] **Step 3: Kiểm thủ công**

  1. Nạp VNPay sandbox 100 000, quay về và cắm thẻ. Expected: số dư thẻ tăng 100 000.
  2. F5 trang return VNPay. Expected: không cộng thêm lần nữa.

  ZaloPay cần `DOMAIN_WEBSITE` công khai (ví dụ ngrok) để nhận callback; ghi rõ điều này trong README.

- [ ] **Step 4: Commit** — `feat(card): online wallet top-up via ZaloPay and VNPay`

---

### Task 15: Vé điện tử, check-in, huỷ đơn (U6, A9)

**Files:**
- Modify:
  - `helpers/ticket.helper.js`: `isWithinCheckinWindow`, `statusOnCancel`, `findPendingItems`
  - `controllers/admin/order.controller.js`: khi đổi `status` sang `cancel` thì gọi `ticketHelper.onOrderCancelled(order)`
- Create:
  - `controllers/admin/card-checkin.controller.js`: `page`, `lookupPost`, `usePost`
  - các route trong `routes/admin/card.route.js`: `/checkin`, `/checkin/lookup`, `/checkin/use`
  - `views/admin/pages/card-checkin.pug`
- Test: `test/ticket.test.js`

**Interfaces — Produces:**
- `isWithinCheckinWindow(departureDate, now) → bool`: giờ Việt Nam, khoảng `[ngày khởi hành − 1, hết ngày khởi hành]`
- `statusOnCancel(ticketStatus) → string`: `written` → `pending-delete`, `pending` → `none`, các giá trị khác giữ nguyên
- `onOrderCancelled(order) → Promise<void>`
- `POST /admin/card/checkin/lookup {cardId, tourId}` (`card-checkin`) → `{customer:{fullName, phone, bloodType, allergies}, items:[{orderId, itemIndex, orderCode, pax, ticketStatus}]}`
  - Card `active` loại `customer`
  - chỉ lấy item của tour đó, thuộc đơn `paid` và không `cancel`
  - ngoài cửa sổ check-in → lỗi `"Chưa tới hoặc đã qua ngày check-in"`
- `POST /admin/card/checkin/use {cardId, orderId, itemIndex}` → `{opId}`
  - item phải `written`; `pending` → lỗi `"Vé chưa được ghi lên thẻ, hãy đồng bộ trước"`

- [ ] **Step 1: Viết test**

```js
test('checkin window VN time', () => { const d = new Date('2026-12-14T17:00:00Z'); /* = 15/12 00:00 giờ VN */ assert.ok(H.isWithinCheckinWindow(d, new Date('2026-12-13T17:30:00Z'))); assert.ok(H.isWithinCheckinWindow(d, new Date('2026-12-15T16:59:00Z'))); assert.ok(!H.isWithinCheckinWindow(d, new Date('2026-12-15T17:01:00Z'))); assert.ok(!H.isWithinCheckinWindow(d, new Date('2026-12-13T16:59:00Z'))); });
test('cancel mapping', () => { assert.equal(H.statusOnCancel('written'), 'pending-delete'); assert.equal(H.statusOnCancel('pending'), 'none'); assert.equal(H.statusOnCancel('used'), 'used'); });
```

- [ ] **Step 2: Chạy test, xác nhận fail. Cài đặt. Chạy test, xác nhận pass.**

  Trang check-in:
  - chọn tour có ngày khởi hành nằm trong cửa sổ check-in;
  - bảng khách đã đặt: tên, SĐT, số khách, trạng thái vé, giờ check-in;
  - nút "Quét thẻ":
    1. `openSession`, khách nhập PIN;
    2. `readPhotoUrl` + `readProfile` + `readTickets`;
    3. `lookup`;
    4. hiển thị ảnh lớn, tên, nhóm máu, dị ứng và vé tương ứng;
    5. bấm "Xác nhận check-in" → `use` → `runSignedOp(/admin/card/op/*)` → bảng cập nhật.

- [ ] **Step 3: Kiểm thủ công**

  1. Đơn đã `paid` của khách → cắm thẻ, mở trang thẻ. Expected: `READ_TICKETS` có vé VALID; item → `written`.
  2. Check-in. Expected: vé → USED trên thẻ; item → `used`, có `checkedInBy`.
  3. Check-in lần 2. Expected: báo "Vé đã sử dụng".
  4. Admin huỷ một đơn có vé `written` → cắm thẻ. Expected: vé bị xoá khỏi thẻ, item → `deleted`.

- [ ] **Step 4: Commit** — `feat(card): e-tickets on card, tour check-in and cancellation cleanup`

---

### Task 16: Thống kê dashboard (A11) và nghiệm thu toàn bộ

**Files:**
- Modify: `controllers/admin/dashboard.controller.js`, `views/admin/pages/dashboard.pug`
- Modify: `smartcard/README.md` (mục "Chạy toàn hệ thống")

**Interfaces — Produces:**
- `res.locals.cardStats = {byStatus: {active, locked, revoked}, walletRevenueMonth, checkinRate: [{tourName, departureDate, written, used}]}`
  - `walletRevenueMonth` = tổng debit `source: 'order'` `done` trong tháng hiện tại (giờ Việt Nam)
  - `checkinRate` = các tour khởi hành trong 7 ngày tới hoặc 7 ngày qua
  - chỉ tính khi tài khoản có `card-view`

- [ ] **Step 1: Cài đặt aggregate và khối hiển thị** (3 thẻ số liệu + 1 bảng, dùng style dashboard hiện có)

- [ ] **Step 2: Chạy toàn bộ test**

  Run: `npm test && npm run test:integration && (cd smartcard && ./gradlew test)`

  Expected: 0 fail. Integration chỉ báo skip khi không có `TEST_DATABASE`.

- [ ] **Step 3: Nghiệm thu end-to-end** (agent `--sim`, ghi kết quả vào README)

  1. Admin (chưa có thẻ) phát hành thẻ nhân viên cho chính mình (slot 0) → đăng xuất → đăng nhập bằng mật khẩu + thẻ.
  2. Phát hành thẻ khách (slot 1), PIN email về.
  3. Khách đăng nhập, đổi PIN, nạp tiền mặt 3 000 000 (admin, step-up bằng slot 0 rồi đổi sang slot 1).
  4. Khách đặt tour bằng ví thẻ → `paid` → vé ghi lên thẻ.
  5. Check-in ngày khởi hành (sửa `departureDate` của tour về hôm nay) → vé USED.
  6. Khách báo mất qua OTP → admin cấp lại thẻ (slot 2) → số dư và vé chuyển sang → cắm slot 1 thì thẻ bị TERMINATE.
  7. Sai PIN 5 lần trên slot 2 → admin reset PIN → khách đổi PIN.
  8. Dashboard hiển thị số liệu khớp; trang nhật ký có đủ các bước trên.

- [ ] **Step 4: Commit** — `feat(card): dashboard card statistics and end-to-end acceptance notes`
