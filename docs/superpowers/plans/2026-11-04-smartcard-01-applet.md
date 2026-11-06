# Applet Thẻ Thành viên Du lịch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Applet Java Card `TravelCardApplet` triển khai đầy đủ giao thức ở spec mục 3. Toàn bộ chức năng được kiểm thử bằng jCardSim và xuất test vector cho web.

**Architecture:** Một applet chia thành các lớp theo trách nhiệm:

| Lớp | Trách nhiệm |
|---|---|
| `TravelCardApplet` | dispatch + ma trận chặn lệnh |
| `PinGuard` | PIN, DEK, escrow |
| `ServerAuth` | challenge + kiểm chữ ký server |
| `CardKeys` | RSA của thẻ |
| `SecureStore` | hồ sơ / ảnh mã hoá |
| `Wallet` | ví + log + biên nhận |
| `TicketStore` | vé |
| `U32` | số học 32-bit trên byte[] |

Mọi bộ nhớ được cấp phát trong constructor.

**Tech Stack:** Java Card 3.0.4 API (classic), Gradle 9.7 (Kotlin DSL), JUnit 5.11.4, jCardSim `com.klinec:jcardsim:3.0.5.11`, ant-javacard (đóng gói CAP).

**Spec:** `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md`. Mục 3 là nguồn sự thật cho mọi byte.

## Global Constraints

- **Package / AID:** package `vn.travel.card`. Package AID `F054524156454C00`, applet AID `F054524156454C01`, CLA `0x80`.
- **Mã nguồn applet:**
  - compile `--release 8`;
  - **không dùng kiểu `int`, `long`, `String`, collection, hay bất kỳ API Java SE nào**; chỉ `byte`/`short` và `javacard.*` / `javacardx.crypto.*`;
  - không cấp phát (`new`) ngoài constructor và `install`.
- **Thuật toán:**
  - `KeyPair.ALG_RSA_CRT` 1024-bit
  - `Signature.ALG_RSA_SHA_256_PKCS1`
  - `Cipher.ALG_AES_BLOCK_128_CBC_NOPAD` / `ALG_AES_BLOCK_128_ECB_NOPAD`
  - `MessageDigest.ALG_SHA_256`
  - `RandomData.ALG_SECURE_RANDOM`
- **Hằng số:** `CHUNK = 224`, `PROFILE_MAX = 448`, `PHOTO_MAX = 10080`, `TICKET_SLOTS = 5`, `LOG_SIZE = 10`, `BALANCE_MAX = 50 000 000` (`0x02FAF080`), `PIN_TRIES = 5`, `PIN_LEN = 6`.
- **Bố cục:** dữ liệu vào/ra và SW phải khớp spec mục 3.3 và 3.4 **từng byte**.
- **Tính nguyên tử:** mọi thay đổi số dư / counter / log / vé / trạng thái nằm trong `JCSystem.beginTransaction()…commitTransaction()`.
- **Commit message:** tiếng Anh, tiền tố `feat(applet):` / `test(applet):` / `build(applet):`.

## Review Focus

1. **Gửi lại nguyên văn một lệnh đã ký** (replay) → lần 2 phải trả `6F21`, không được thực hiện lại. Test ở Task 4.
2. **Lệnh ký cho thẻ khác** (cardId trong `M_cmd` khác) → `6F20`, và challenge vẫn bị huỷ. Test ở Task 4.
3. **Deselect rồi select lại** → trạng thái PIN và DEK trong RAM phải mất, đọc dữ liệu trả `6982`. Test ở Task 3.
4. **Biên dữ liệu ảnh:**
   - đúng `10080` byte → OK;
   - `10081` → `6A84`;
   - COMMIT khi chưa ghi đủ chunk → `6A80` và target vẫn rỗng.

   Test ở Task 6.
5. **Biên số học tiền:**
   - credit tới đúng `50 000 000` → OK, thêm 1 → `6F11`;
   - nhớ qua byte (`0x00FFFFFF + 1`) đúng;
   - debit lớn hơn số dư → `6F10`, số dư và counter không đổi.

   Test ở Task 7.

---

## Cấu trúc file

```
smartcard/settings.gradle.kts                 include("applet", "agent")
smartcard/gradle/wrapper/…, gradlew           wrapper 9.7.0
smartcard/applet/build.gradle.kts
smartcard/applet/src/main/java/vn/travel/card/
  CardConst.java        INS, SW, state, cardType, kích thước
  U32.java              add/sub/compare 32-bit trên byte[]
  CardKeys.java         RSA keypair, sign, modulus
  PinGuard.java         OwnerPIN, salt, encDekPin, encDekEscrow, escrowKey, DEK transient
  ServerAuth.java       server pubkey, challenge transient, verifySigned
  SecureStore.java      profile/photo mã hoá theo chunk, phiên ghi + SHA-256
  Wallet.java           balance, txCounter, log vòng, biên nhận
  TicketStore.java      5 slot vé
  TravelCardApplet.java install/select/deselect/process, ma trận chặn
smartcard/applet/src/test/java/vn/travel/card/
  CardHarness.java      wrapper jCardSim
  TestServer.java       khoá server test, ký M_cmd, escrow
  *Test.java
smartcard/test-vectors/server-test-key.pem    RSA-1024 PKCS#8 — CHỈ DÙNG TEST
smartcard/test-vectors/vectors.json           sinh ở Task 9
```

---

### Task 1: Khung Gradle, harness, applet rỗng

**Files:**
- Create: `smartcard/settings.gradle.kts`, `smartcard/applet/build.gradle.kts`, wrapper
- Create: `smartcard/applet/src/main/java/vn/travel/card/CardConst.java`, `TravelCardApplet.java`
- Create: `smartcard/applet/src/test/java/vn/travel/card/CardHarness.java`, `TestServer.java`, `SkeletonTest.java`
- Create: `smartcard/test-vectors/server-test-key.pem`
- Modify: `.gitignore` (thêm `smartcard/**/build/`, `smartcard/.gradle/`, `smartcard/tools/`)

**Interfaces:**
- Produces (`CardHarness`, dùng ở mọi task sau):
  - `static CardHarness fresh()`: cài và select applet ở CREATED
  - `ResponseAPDU send(int ins, int p1, int p2, byte[] data)`: CLA 0x80, Le 256
  - `byte[] ok(int ins, int p1, int p2, byte[] data)`: assert SW 9000, trả data
  - `void assertSw(int expectedSw, int ins, int p1, int p2, byte[] data)`
  - `void reselect()`: select applet khác hoặc rỗng rồi select lại
  - `static final byte[] CARD_ID` = 16 byte `0x11`
  - `static final String PIN = "482915"`
- Produces (`TestServer`):
  - `static byte[] modulus()`: 128B
  - `static byte[] sign(byte[] msg)`: SHA256withRSA
  - `static byte[] escrowKey(byte[] cardId)`: HMAC-SHA256(`ESCROW_MASTER`, cardId)[0..15]
  - `static final byte[] ESCROW_MASTER` = 32 byte `0x5A`

- [ ] **Step 1: Sinh khoá server test**

  Run: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:1024 -out smartcard/test-vectors/server-test-key.pem`

  Expected: file bắt đầu bằng `-----BEGIN PRIVATE KEY-----`.

- [ ] **Step 2: Tạo Gradle multi-project và wrapper**

  - `settings.gradle.kts`: `rootProject.name = "smartcard"`, `include("applet")`. Dòng `"agent"` thêm ở plan 02.
  - `applet/build.gradle.kts`:
    - plugin `java`
    - `tasks.compileJava { options.release = 8 }`
    - `compileOnly` và `testImplementation` `com.klinec:jcardsim:3.0.5.11`
    - `testImplementation` `org.junit.jupiter:junit-jupiter:5.11.4` + `junit-platform-launcher`
    - `tasks.test { useJUnitPlatform() }`
    - test compile dùng `--release 17`

  Run: `cd smartcard && gradle wrapper --gradle-version 9.7.0`

- [ ] **Step 3: Viết `SkeletonTest` (chạy sẽ fail)**

```java
@Test void publicInfoOnBlankCard() {
  byte[] r = CardHarness.fresh().ok(0x10, 0, 0, null);
  assertEquals(21, r.length);
  assertArrayEquals(new byte[16], Arrays.copyOfRange(r, 0, 16)); // cardId = 0
  assertEquals(0x00, r[16]);  // cardType
  assertEquals(0x00, r[17]);  // state CREATED
  assertEquals(5, r[19]);     // triesRemaining
  assertEquals(0x01, r[20]);  // version
}
@Test void wrongClaIs6E00() { /* CLA 0x00, INS 0x10 → 0x6E00 */ }
@Test void unknownInsIs6D00() { /* INS 0x7E → 0x6D00 */ }
@Test void createdStateBlocksOtherCommands() { /* INS 0x20 với "482915" → 0x6985 */ }
```

- [ ] **Step 4: Chạy test, xác nhận fail**

  Run: `cd smartcard && ./gradlew :applet:test --tests vn.travel.card.SkeletonTest`

  Expected: FAIL (thiếu lớp applet).

- [ ] **Step 5: Cài đặt `CardConst` và `TravelCardApplet`**

  - `CardConst`: toàn bộ hằng ở spec 3.1, 3.3 (INS), 3.4 (SW) dưới dạng `static final short/byte`.
  - `TravelCardApplet`:
    - `install(byte[], short, byte)` → `new TravelCardApplet().register(...)`
    - `process(APDU)`: bỏ qua lệnh SELECT; kiểm CLA; gọi `checkAllowed(ins)` theo ma trận spec 3.3 (gồm cả quy tắc "chỉ thẻ khách" → `6986`); `switch(ins)`
  - Task này chỉ cài `GET_PUBLIC_INFO`. Thứ tự kiểm tra cố định:
    1. CLA sai → `6E00`.
    2. INS không có trong bảng spec 3.3 → `6D00`.
    3. Ma trận chặn (`6985` / `6986`) và yêu cầu PIN (`6982` / `6983`).
    4. Dispatch.

    INS có trong bảng nhưng chưa cài tạm trả `6D00` ở bước 4.

- [ ] **Step 6: Chạy test, xác nhận pass**

  Run lại lệnh ở Step 4. Expected: PASS 4/4.

- [ ] **Step 7: Commit**

```bash
git add .gitignore smartcard/settings.gradle.kts smartcard/gradle smartcard/gradlew* smartcard/applet smartcard/test-vectors/server-test-key.pem
git commit -m "build(applet): scaffold Java Card applet with jCardSim harness"
```

---

### Task 2: INIT — cá nhân hoá, khoá RSA, DEK, escrow

**Files:**
- Create: `CardKeys.java`, `PinGuard.java`
- Modify: `TravelCardApplet.java`
- Test: `InitTest.java`; thêm vào `CardHarness` hàm `personalize(byte cardType)`

**Interfaces:**
- Produces:
  - `CardKeys`
    - `void generate()`
    - `short getModulus(byte[] out, short off)` → 128
    - `short sign(byte[] msg, short off, short len, byte[] out, short outOff)` → 128
    - `void clear()`
  - `PinGuard`
    - `void init(byte[] buf, short pinOff, short escrowOff)`: sinh DEK + salt, bọc 2 lần, `pin.update`, `mustChangePin = 1`
    - `boolean isValidated()`
    - `AESKey dek()`: chỉ hợp lệ khi đã validated
    - `void clearSession()`
    - `byte triesRemaining()`
    - `boolean mustChangePin()`
    - `void wipe()`
  - `CardHarness.personalize(byte cardType)`
    - gửi INIT với `CARD_ID`, `cardType`, `TestServer.modulus()`, `PIN`, `TestServer.escrowKey(CARD_ID)`
    - trả card modulus 128B và lưu vào field `cardModulus`

- [ ] **Step 1: Viết `InitTest`**

```java
@Test void initReturnsModulusAndActivates() {
  CardHarness c = CardHarness.fresh();
  byte[] mod = c.personalize((byte) 0x01);
  assertEquals(128, mod.length);
  byte[] info = c.ok(0x10, 0, 0, null);
  assertArrayEquals(CardHarness.CARD_ID, Arrays.copyOfRange(info, 0, 16));
  assertEquals(0x01, info[16]); assertEquals(0x02, info[17]); assertEquals(1, info[18]);
}
@Test void initOnlyOnce()            { /* personalize rồi INIT lần 2 → 0x6985 */ }
@Test void initWrongLength()         { /* 166 byte → 0x6700 */ }
@Test void initRejectsNonDigitPin()  { /* PIN "48291A" → 0x6A80, state vẫn CREATED */ }
@Test void initRejectsBadCardType()  { /* cardType 0x03 → 0x6A80 */ }
@Test void pubkeyMatchesInit()       { /* sau khi đổi PIN (Task 3) mới gọi được; tạm để @Disabled, bật ở Task 3 */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

  Run: `./gradlew :applet:test --tests vn.travel.card.InitTest`

  Expected: FAIL (`6D00`).

- [ ] **Step 3: Cài đặt INIT**

  Trình tự:
  1. Kiểm `Lc == 167`.
  2. Kiểm PIN chỉ gồm chữ số.
  3. Kiểm `cardType ∈ {1, 2}`.
  4. Lưu `cardId` và `cardType`.
  5. Đặt modulus cho `RSAPublicKey` server (exponent `010001`).
  6. Gọi `CardKeys.generate()` và `PinGuard.init`.
  7. Chuyển state sang ACTIVE.
  8. Trả modulus của thẻ.

  Bước 4–7 nằm trong một transaction. Riêng `generate()` chạy trước transaction để tránh làm tràn commit buffer.

- [ ] **Step 4: Chạy test, xác nhận pass** (5 pass, 1 disabled)

- [ ] **Step 5: Commit** — `feat(applet): personalize card with RSA keypair, DEK and escrow`

---

### Task 3: VERIFY_PIN, CHANGE_PIN, đóng phiên khi deselect

**Files:**
- Modify: `PinGuard.java`, `TravelCardApplet.java` (`deselect()` gọi `pinGuard.clearSession()`)
- Test: `PinTest.java`; bật lại `InitTest.pubkeyMatchesInit`

**Interfaces:**
- Produces:
  - `PinGuard.verify(byte[] buf, short off)`: ném `63Cx` / `6983`; khi đúng thì mở DEK vào khoá transient
  - `PinGuard.change(byte[] buf, short oldOff, short newOff)`: bọc lại DEK, xoá `mustChangePin`, xoá cache DEK cũ
  - `CardHarness.activate()` = `personalize(0x01)` rồi `CHANGE_PIN(PIN → "715043")`; đặt field `pin = "715043"`
  - `CardHarness.verifyPin()`: VERIFY với `pin` hiện tại

- [ ] **Step 1: Viết `PinTest`**

```java
@Test void wrongPinCountsDown()        { /* sai 1 lần → 0x63C4; sai thêm 3 → 0x63C1 */ }
@Test void fifthWrongPinBlocks()       { /* sai 5 lần → lần 5 trả 0x63C0; VERIFY đúng sau đó → 0x6983; GET_PUBLIC_INFO triesRemaining = 0 */ }
@Test void correctPinResetsCounter()   { /* sai 2, đúng 1 → info triesRemaining = 5 */ }
@Test void mustChangePinGatesCommands(){ /* sau personalize: VERIFY ok, AUTHENTICATE (0x31) → 0x6985 */ }
@Test void changePinClearsFlag()       { /* activate() → info[18] == 0; VERIFY "482915" → 0x63C4; VERIFY "715043" → 9000 */ }
@Test void changePinWrongOld()         { /* old sai → 0x63C4, flag vẫn = 1 */ }
@Test void reselectDropsPinSession()   { /* activate, verifyPin, reselect, READ_DATA(0x40, 01, FF) → 0x6982 */ } // Review Focus #3
@Test void dekSurvivesPinChange()      { /* activate; bật ở Task 6: ghi hồ sơ, đổi PIN lần nữa, đọc lại đúng nội dung */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

  Run: `./gradlew :applet:test --tests vn.travel.card.PinTest`

- [ ] **Step 3: Cài đặt VERIFY_PIN / CHANGE_PIN và `deselect`**

  Cách tính KEK:

```
KEK = SHA-256(salt ‖ pin)[0..15]
DEK = AES-ECB-decrypt(KEK, encDekPin)
```

  Ghi chú cài đặt:
  - Tính KEK trên buffer transient, sau đó `Util.arrayFillNonAtomic` về 0.
  - Khi PIN sai, **không** giải mã gì cả.
  - `READ_DATA` lúc này đã phải trả `6982` khi chưa validated: kiểm tra PIN thuộc ma trận dùng chung, chạy trước khi dispatch.

- [ ] **Step 4: Chạy test, xác nhận pass** (`dekSurvivesPinChange` để `@Disabled` tới Task 6)

- [ ] **Step 5: Commit** — `feat(applet): PIN verify/change with PIN-derived KEK and session clearing`

---

### Task 4: ServerAuth — challenge, lệnh có chữ ký, SET_STATE, RESET_PIN

**Files:**
- Create: `ServerAuth.java`
- Modify: `TravelCardApplet.java`, `PinGuard.java` (thêm `resetWithEscrow`)
- Test: `ServerAuthTest.java`; thêm `CardHarness.signed(int ins, int p1, int p2, byte[] payload)` (GET_CHALLENGE → dựng `M_cmd` → `TestServer.sign` → gửi `payload ‖ sig`, trả `ResponseAPDU`)

**Interfaces:**
- Produces:
  - `ServerAuth.issueChallenge(byte[] out, short off)`
  - `ServerAuth.verifySigned(byte[] buf, short cdataOff, short lc, byte ins, byte p1, byte p2, byte[] cardId)`
    - trả `payloadLen` (`lc − 128`)
    - ném `6F21` (không có challenge), `6F20` (chữ ký sai), `6700` (`lc < 128`)
    - **luôn huỷ challenge trước khi trả về hoặc ném lỗi**
  - `PinGuard.resetWithEscrow(byte[] buf, short encPinOff)`
  - Mọi task sau gọi `verifySigned` ở bước đầu xử lý các INS "Ký"

- [ ] **Step 1: Viết `ServerAuthTest`**

```java
@Test void challengeIs16RandomBytes()    { /* hai lần GET_CHALLENGE → 16B, khác nhau */ }
@Test void lockThenUnlock()              { /* activate; signed(0x70, 0x03) → 9000; info state 0x03; VERIFY → 0x6985; signed(0x70, 0x02) → 9000; state 0x02 */ }
@Test void replayRejected()              { /* lấy APDU đã ký của SET_STATE 03, gửi 2 lần → lần 2 là 0x6F21 */ }            // Review Focus #1
@Test void otherCardIdRejected()         { /* M_cmd với cardId 0x22×16 → 0x6F20; gửi lại ngay → 0x6F21 */ }               // Review Focus #2
@Test void tamperedPayloadRejected()     { /* ký P1 = 03 nhưng gửi P1 = 7F → 0x6F20, state không đổi */ }
@Test void noChallengeRejected()         { /* reselect rồi gửi lệnh ký sẵn → 0x6F21 */ }
@Test void terminateWipes()              { /* signed(0x70, 0x7F) → 9000; info state 0x7F; GET_CHALLENGE → 0x6985; GET_CARD_PUBKEY → 0x6985 */ }
@Test void resetPinUnblocksAndForcesChange() {
  /* activate; sai PIN 5 lần; encPin = AES-ECB(TestServer.escrowKey(CARD_ID), "903172" ‖ 0x00×10)
     signed(0x22, 0, 0, encPin) → 9000; info tries = 5, mustChange = 1; VERIFY "903172" → 9000 */
}
@Test void resetPinKeepsData()           { /* @Disabled tới Task 6: ghi hồ sơ, reset PIN, verify PIN mới, đọc hồ sơ khớp */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  `verifySigned` dựng `M_cmd` theo spec 3.2: gọi `Signature.update` cho tag / challenge / cardId / header, rồi `verify(payload)` trên chữ ký.

  `SET_STATE`:
  - P1 ∉ {02, 03, 7F} → `6A86`.
  - P1 trùng trạng thái hiện tại → `9000`, không làm gì.
  - `7F` → trong một transaction: `PinGuard.wipe()`, `CardKeys.clear()`, các store `wipe()` (Task 6–8 bổ sung), state = `7F`.

  `RESET_PIN`:
  1. Giải mã `encPin` bằng `escrowKey`.
  2. Kiểm PIN chỉ gồm chữ số; sai → `6A80`.
  3. `DEK = AES-ECB-decrypt(escrowKey, encDekEscrow)`.
  4. Bọc lại DEK bằng KEK của PIN mới.
  5. `pin.update` + `resetAndUnblock`, `mustChangePin = 1`.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Commit** — `feat(applet): server-signed commands, lifecycle state and escrow PIN reset`

---

### Task 5: AUTHENTICATE và GET_CARD_PUBKEY

**Files:**
- Modify: `TravelCardApplet.java`
- Test: `AuthenticateTest.java`; bật lại `InitTest.pubkeyMatchesInit`

**Interfaces:**
- Consumes: `CardKeys.sign`, `CardKeys.getModulus`
- Produces: `CardHarness.verifyCardSig(byte[] msg, byte[] sig)`, kiểm bằng `cardModulus` qua `java.security`

- [ ] **Step 1: Viết `AuthenticateTest`**

```java
@Test void authSignsNonceCardIdCounter() {
  /* activate; verifyPin; nonce = 16B ngẫu nhiên; r = ok(0x31, 0, 0, nonce)
     r.length == 132; counter = r[0..3] == 00000000
     msg = 0x41 ‖ nonce ‖ CARD_ID ‖ counter; verifyCardSig(msg, r[4..131]) == true */
}
@Test void authNeedsPin()        { /* activate; không verify → 0x6982 */ }
@Test void authWrongLength()     { /* nonce 15B → 0x6700 */ }
@Test void staffCardCanAuth()    { /* personalize(0x02) + đổi PIN → AUTHENTICATE OK (không phải lệnh chỉ dành cho thẻ khách) */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  Dựng `M_auth` (37B) trên buffer transient, ký, trả `counter ‖ sig`. `txCounter` lấy từ `Wallet`. Task này dùng hằng 0 tạm thời; Task 7 thay bằng `wallet.counter()`.

- [ ] **Step 4: Chạy test, xác nhận pass** (gồm cả `pubkeyMatchesInit`)

- [ ] **Step 5: Commit** — `feat(applet): card authentication by RSA signature`

---

### Task 6: SecureStore — ghi/đọc hồ sơ và ảnh mã hoá

**Files:**
- Create: `SecureStore.java`
- Modify: `TravelCardApplet.java`
- Test: `SecureStoreTest.java`
  - Thêm `CardHarness.writeTarget(int target, byte[] data)`: BEGIN → WRITE từng chunk → `signed(0x43, target, 0, sha256(data) ‖ len2)`
  - Thêm `CardHarness.readTarget(int target)`: lấy độ dài qua `P2 = FF`, rồi đọc từng chunk và nối lại
  - Bật lại `PinTest.dekSurvivesPinChange` và `ServerAuthTest.resetPinKeepsData`

**Interfaces:**
- Produces: `SecureStore.begin(byte target, short totalLen)`, `writeChunk(byte target, byte index, byte[] buf, short off, short len, AESKey dek)`, `commit(byte target, byte[] buf, short hashOff, short len)`, `readChunk(byte target, byte index, AESKey dek, byte[] out, short off)` → `short`, `length(byte target)` → `short`, `wipe()`

- [ ] **Step 1: Viết `SecureStoreTest`**

```java
@Test void profileRoundTrip()          { /* 300B ngẫu nhiên → writeTarget(1) → readTarget(1) bằng nhau */ }
@Test void photoMaxRoundTrip()         { /* 10080B → round-trip OK */ }                                    // Review Focus #4
@Test void photoTooLarge()             { /* BEGIN(2, 10081) → 0x6A84; BEGIN(1, 449) → 0x6A84 */ }          // Review Focus #4
@Test void commitBeforeAllChunks()     { /* BEGIN(2, 500), ghi chunk 0, COMMIT → 0x6A80; length(2) == 0 */ } // Review Focus #4
@Test void outOfOrderChunk()           { /* BEGIN, ghi chunk 1 trước → 0x6A86 */ }
@Test void shortNonLastChunk()         { /* BEGIN(1, 300), chunk 0 dài 100B → 0x6700 */ }
@Test void hashMismatch()              { /* COMMIT với hash của dữ liệu khác → 0x6A80; length == 0 */ }
@Test void commitNeedsSignature()      { /* COMMIT với chữ ký sai → 0x6F20 */ }
@Test void readNeedsPin()              { /* reselect; READ_DATA → 0x6982 */ }
@Test void emptyTargetRead()           { /* P2 = FF → 0000; P2 = 00 → 0x6A88 */ }
@Test void badTarget()                 { /* P1 = 03 → 0x6A86 */ }
@Test void rewriteSameDataReadable()   { /* ghi cùng dữ liệu 2 lần (mỗi lần IV mới) → cả 2 lần đọc lại đều đúng */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  - **Phiên ghi** gồm `target`, `declaredLen`, `nextIndex`, `written`. Lưu các biến này trong mảng transient `CLEAR_ON_DESELECT`. `MessageDigest` dùng chung.
  - **BEGIN:** đặt `length(target) = 0` trước tiên, sinh IV mới.
  - **WRITE:**
    1. Pad chunk vào buffer transient tới bội 16.
    2. Mã hoá CBC với `IV[15] ^ index`, ghi vào `offset = index × 224`.
    3. `digest.update` trên **plaintext chưa pad**.
  - **COMMIT** (sau `verifySigned`) chỉ thành công khi đủ cả ba điều kiện:
    - `written == declaredLen == len`;
    - `nextIndex == ceil(len / 224)`;
    - `doFinal == hash`.

    Thành công thì gán `length`. Bất kể kết quả nào cũng kết thúc phiên ghi.
  - **READ:** giải mã chunk, cắt chunk cuối theo `length`.
  - `TERMINATE` gọi `secureStore.wipe()`.

- [ ] **Step 4: Chạy test, xác nhận pass** (gồm 2 test vừa bật lại)

- [ ] **Step 5: Commit** — `feat(applet): encrypted chunked profile and photo storage with signed commit`

---

### Task 7: Wallet — số dư, CREDIT, DEBIT, log, GET_RECEIPT

**Files:**
- Create: `U32.java`, `Wallet.java`
- Modify: `TravelCardApplet.java` (AUTHENTICATE dùng `wallet.counter`)
- Test: `U32Test.java`, `WalletTest.java`

**Interfaces:**
- Produces:
  - `U32`
    - `static boolean add(byte[] a, short aOff, byte[] b, short bOff, byte[] out, short outOff)`: trả false nếu tràn
    - `static boolean sub(...)`: trả false nếu âm
    - `static short compare(...)`: −1 / 0 / 1
    - `static boolean isZero(...)`
  - `Wallet`
    - `short credit(byte[] buf, short payloadOff, byte[] out, short outOff)`
    - `short debit(...)`
    - `short receipt(byte[] txRef, short off, byte[] out, short outOff)`: trả 166, ném `6A88`
    - `short balance(byte[] out, short off)`: `balance4 ‖ counter4`
    - `short log(byte[] out, short off)`
    - `void counter(byte[] out, short off)`
    - `void wipe()`
  - `CardHarness.parseReceipt(byte[] r)` → record `{type, txRef, amount, balanceAfter, counter}`, đồng thời assert chữ ký thẻ hợp lệ trên `r[0..37]`

- [ ] **Step 1: Viết `U32Test`**

  `U32` không phụ thuộc applet nên test trực tiếp bằng JUnit:

```java
@Test void carryAcrossBytes() { /* 00FFFFFF + 00000001 = 01000000 */ }                  // Review Focus #5
@Test void overflowDetected() { /* FFFFFFFF + 1 → false */ }
@Test void borrow()           { /* 01000000 − 1 = 00FFFFFF; 0 − 1 → false */ }
@Test void compareOrder()     { /* 02FAF080 so với 02FAF081 → −1 */ }
```

- [ ] **Step 2: Viết `WalletTest`**

```java
@Test void creditThenDebit() {
  /* activate; signed(0x51, txRef = 01×8, amount = 1 500 000) → receipt type 1, amount 1 500 000, balanceAfter 1 500 000, counter 1
     verifyPin; signed(0x52, txRef = 02×8, 400 000) → type 2, balanceAfter 1 100 000, counter 2
     verifyPin; GET_BALANCE → 0010C8E0 ‖ 00000002 */
}
@Test void creditUpToMax()             { /* credit 50 000 000 → OK; credit 1 → 0x6F11, counter không đổi */ }  // Review Focus #5
@Test void debitInsufficient()         { /* balance 100; debit 101 → 0x6F10; balance và counter không đổi */ } // Review Focus #5
@Test void debitNeedsPin()             { /* không verify → 0x6982 */ }
@Test void debitClearsPin()            { /* debit OK, sau đó GET_BALANCE → 0x6982 */ }
@Test void zeroAmount()                { /* credit 0 → 0x6A80 */ }
@Test void logNewestFirstAndRing()     { /* 12 lần credit 1 → READ_TX_LOG count = 10, bản ghi đầu có counter 12, bản ghi cuối có counter 3 */ }
@Test void receiptReSigned()           { /* sau credit txRef = 01×8: GET_RECEIPT(01×8) bằng receipt ban đầu ở 38 byte đầu, chữ ký hợp lệ */ }
@Test void receiptNotFound()           { /* GET_RECEIPT(09×8) → 0x6A88; txRef đã bị đẩy khỏi log vòng → 0x6A88 */ }
@Test void staffCardWalletBlocked()    { /* thẻ nhân viên: GET_BALANCE → 0x6986; CREDIT → 0x6986 */ }
@Test void authCounterTracksWallet()   { /* sau 2 lần credit: AUTHENTICATE trả counter 00000002 */ }
```

- [ ] **Step 3: Chạy test, xác nhận fail**

  Run: `./gradlew :applet:test --tests 'vn.travel.card.U32Test' --tests 'vn.travel.card.WalletTest'`

- [ ] **Step 4: Cài đặt**

  Trình tự CREDIT / DEBIT (đều sau `verifySigned`):
  1. Kiểm số tiền > 0.
  2. Tính số dư mới vào buffer transient; nếu tràn, âm, hoặc credit vượt `BALANCE_MAX` → ném SW.
  3. Trong một transaction:
     - ghi balance;
     - tăng counter (`U32.add` với 1);
     - ghi bản ghi log tại `head`, rồi `head = (head + 1) % 10`, `count = min(count + 1, 10)`.
  4. Commit.
  5. Dựng `M_rcpt` và ký **sau** commit.

  DEBIT gọi `pinGuard.clearSession()` trong khối `finally`.

  GET_RECEIPT duyệt log tìm `txRef`, rồi dựng lại `M_rcpt` từ bản ghi.

- [ ] **Step 5: Chạy test, xác nhận pass**

- [ ] **Step 6: Commit** — `feat(applet): signed wallet credit/debit with receipts and ring log`

---

### Task 8: TicketStore

**Files:**
- Create: `TicketStore.java`
- Modify: `TravelCardApplet.java`
- Test: `TicketTest.java`

**Interfaces:**
- Produces:
  - `TicketStore.write(byte[] buf, short off)`: ném `6A84`
  - `TicketStore.use(byte[] buf, short keyOff)`: ném `6A88` / `6985`
  - `TicketStore.delete(byte[] buf, short keyOff)`
  - `TicketStore.read(byte[] out, short off)` → `short`
  - `TicketStore.wipe()`
  - `CardHarness.ticket(String orderCode12, byte[] tourId12, String yyyymmdd, int pax)` → `byte[33]`

- [ ] **Step 1: Viết `TicketTest`**

```java
@Test void writeReadUse()         { /* write T1 → READ_TICKETS: count 1, status 01; use(T1 key) → status 02 */ }
@Test void duplicateWriteIdempotent() { /* write T1 hai lần → count 1 */ }
@Test void fullSlots()            { /* 5 vé VALID; vé thứ 6 → 0x6A84; use 1 vé rồi write vé mới → OK (slot USED được tái dùng) */ }
@Test void useTwice()             { /* use T1 lần 2 → 0x6985 */ }
@Test void useUnknown()           { /* → 0x6A88 */ }
@Test void deleteFreesSlot()      { /* delete T1 → count 0; delete lại → 0x6A88 */ }
@Test void readNeedsPin()         { /* → 0x6982 */ }
@Test void wrongPayloadLength()   { /* write 32B → 0x6700 */ }
@Test void terminateWipesTickets(){ /* write, TERMINATE, (state 7F) → GET_PUBLIC_INFO vẫn trả state 7F */ }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  - Mỗi slot = `status1 ‖ ticket33`. Khoá tìm kiếm = 24 byte đầu (`orderCode + tourId`).
  - `write` chọn slot theo thứ tự ưu tiên:
    1. slot đang VALID trùng khoá → `9000` ngay;
    2. slot EMPTY;
    3. slot USED.
  - Thao tác ghi đặt trong một transaction.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Commit** — `feat(applet): signed e-ticket storage`

---

### Task 9: Kiểm tra toàn bộ ma trận, test vector, đóng gói CAP

**Files:**
- Test: `GatingMatrixTest.java`, `TestVectorsExport.java`
- Create: `smartcard/test-vectors/vectors.json` (sinh ra)
- Modify: `smartcard/applet/build.gradle.kts` (task `cap`)
- Create: `smartcard/README.md`

**Interfaces:**
- Produces: `vectors.json` để plan 03 Task 1 đọc. Schema (mọi giá trị là chuỗi hex):

```json
{ "escrowMaster": "...", "cardId": "...", "cardModulus": "...", "serverModulus": "...",
  "auth":    { "nonce": "...", "counter": "...", "signature": "..." },
  "command": { "challenge": "...", "ins": "70", "p1": "03", "p2": "00", "payload": "", "message": "...", "signature": "..." },
  "receipt": { "hex": "...(166B)" },
  "resetPin":{ "newPin": "903172", "encPin": "..." },
  "escrowKey": "..." }
```

- [ ] **Step 1: Viết `GatingMatrixTest`**

  Dùng `@ParameterizedTest` cho mọi tổ hợp (state, `mustChangePin`, INS) ở spec 3.3:
  - lệnh bị chặn phải trả `6985`;
  - lệnh chỉ dành cho thẻ khách gửi vào thẻ nhân viên phải trả `6986`.

  Cách đưa thẻ về từng trạng thái:
  - **CREATED:** `fresh()`
  - **ACTIVE + must:** `personalize`
  - **ACTIVE:** `activate`
  - **LOCKED:** `activate` + SET_STATE 03
  - **TERMINATED:** SET_STATE 7F

- [ ] **Step 2: Chạy test**

  Run: `./gradlew :applet:test --tests vn.travel.card.GatingMatrixTest`

  Expected: PASS. Nếu FAIL thì sửa `checkAllowed`, **không** sửa test.

- [ ] **Step 3: Viết `TestVectorsExport`**

  Một `@Test` ghi file `../test-vectors/vectors.json`, sau đó đọc lại và assert các chữ ký trong file kiểm hợp lệ bằng `java.security`.

  Run: `./gradlew :applet:test --tests vn.travel.card.TestVectorsExport`

  Expected: PASS, file `vectors.json` tồn tại.

- [ ] **Step 4: Đóng gói CAP**

  Chuẩn bị công cụ:
  - Tải `ant-javacard.jar` (`https://github.com/martinpaljak/ant-javacard/releases/latest/download/ant-javacard.jar`) vào `smartcard/tools/`.
  - `git clone --depth 1 https://github.com/martinpaljak/oracle_javacard_sdks smartcard/tools/sdks`.

  Task Gradle `cap`:
  - `ant.taskdef(name = "javacard", classname = "pro.javacard.ant.JavaCard", classpath = tools/ant-javacard.jar)`
  - `jckit = tools/sdks/jc320v24.0_kit`, `targetsdk = tools/sdks/jc304_kit`
  - `cap(aid = F054524156454C00, output = build/travelcard.cap, sources = src/main/java) { applet(class = vn.travel.card.TravelCardApplet, aid = F054524156454C01) }`

  Run: `./gradlew :applet:cap`

  Expected: có file `smartcard/applet/build/travelcard.cap`. Nếu converter lỗi do JDK 25 thì chạy lại với JDK 17 (`sdk use java 17…`) và ghi lại trong README.

- [ ] **Step 5: Viết `smartcard/README.md`**

  Gồm:
  - cách chạy test;
  - cách build CAP;
  - cài lên thẻ thật: `java -jar gp.jar --install applet/build/travelcard.cap`;
  - xoá applet (reset thẻ hỏng giữa chừng): `java -jar gp.jar --delete F054524156454C00`;
  - cảnh báo `server-test-key.pem` chỉ dùng cho test.

- [ ] **Step 6: Chạy toàn bộ test**

  Run: `./gradlew :applet:test`

  Expected: `BUILD SUCCESSFUL`, 0 failed.

- [ ] **Step 7: Commit** — `test(applet): gating matrix, cross-language vectors and CAP build`
