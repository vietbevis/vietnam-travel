# Card Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chương trình Java chạy trên máy người dùng, mở HTTP ở `127.0.0.1:31999`. Agent chuyển tiếp APDU từ trình duyệt tới đầu đọc PC/SC, hoặc tới 4 thẻ ảo jCardSim khi chạy chế độ `--sim`.

**Architecture:** Gồm các thành phần:
- `CardPort` (interface): có hai bản cài đặt `PcscCardPort` (`javax.smartcardio`) và `SimCardPort` (jCardSim, cài applet từ plan 01).
- `AgentHttpServer` (`com.sun.net.httpserver`): xử lý định tuyến, CORS/Origin, JSON (Gson).
- `AgentMain`: đọc cấu hình.

Agent không chứa logic nghiệp vụ.

**Tech Stack:** Java 17 (`--release 17`), Gradle 9.7, Gson 2.11.0, jCardSim `com.klinec:jcardsim:3.0.5.11`, JUnit 5.11.4, `java.net.http.HttpClient` (dùng trong test).

**Spec:** `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md`, mục 4 (HTTP API) và 3.1 (AID).

**Phụ thuộc:** plan 01 đã xong. `SimCardPort` dùng lớp `vn.travel.card.TravelCardApplet`.

## Global Constraints

- **Mạng:** chỉ bind `127.0.0.1`, cổng mặc định `31999`.
- **Endpoint, mã HTTP, JSON:** đúng spec mục 4.
- **Origin:**
  - có header `Origin` không thuộc `allowedOrigins` → `403 {"error":"origin"}`;
  - không có header `Origin` → cho qua.
- **Header CORS (preflight `OPTIONS`):** `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Methods: GET, POST`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Private-Network: true`, kèm `Vary: Origin`.
- **Transmit:**
  - 1–64 APDU mỗi request;
  - dừng sau phản hồi đầu tiên có SW ≠ `9000`;
  - với PC/SC, tự gửi `00 C0 00 00 xx` khi gặp `61xx`.
- **Đồng bộ hoá:** mọi truy cập thẻ đi qua một khoá `synchronized` duy nhất. Không chạy hai APDU đồng thời.
- **Không ghi log dữ liệu APDU** ra console (dữ liệu chứa PIN). Chỉ log INS và SW.
- **Commit message:** tiền tố `feat(agent):` / `test(agent):`.

## Review Focus

1. **Hai tab trình duyệt cùng gửi transmit** → các batch không được xen kẽ nhau. Test ở Task 2 (`concurrentBatchesDoNotInterleave`).
2. **Rút thẻ giữa chừng (PC/SC) hoặc không có đầu đọc** → `503 {"error":"no-card"}`, không crash. Lần cắm thẻ sau phải tự kết nối lại. Test ở Task 1 (`PcscCardPort` khi không có reader) và checklist Task 3.
3. **Hex lẻ / ký tự lạ / APDU > 261 byte / 65 APDU** → `400`. Test ở Task 2.
4. **Trang web lạ gọi agent** (Origin khác) → `403`, kể cả với preflight. Test ở Task 2.
5. **Đổi slot sim giữa hai lệnh** → applet thấy như rút thẻ: phiên PIN mất, select lại. Test ở Task 1 (`switchSlotResetsSession`).

---

## Cấu trúc file

```
smartcard/agent/build.gradle.kts
smartcard/agent/agent.properties                 port=31999, allowedOrigins=http://localhost:3000, mode=pcsc
smartcard/agent/src/main/java/vn/travel/agent/
  CardPort.java          interface
  NoCardException.java
  SimCardPort.java
  PcscCardPort.java
  Hex.java
  AgentConfig.java       đọc properties + args
  AgentHttpServer.java
  AgentMain.java
smartcard/agent/src/test/java/vn/travel/agent/
  HexTest.java  SimCardPortTest.java  AgentHttpServerTest.java  AgentConfigTest.java
```

---

### Task 1: CardPort, SimCardPort, PcscCardPort, Hex

**Files:**
- Modify: `smartcard/settings.gradle.kts` (thêm `include("agent")`)
- Create: `smartcard/agent/build.gradle.kts`
  - plugin `application`, `mainClass = vn.travel.agent.AgentMain`, `release = 17`
  - `implementation(project(":applet"))`, `implementation("com.klinec:jcardsim:3.0.5.11")`, `implementation("com.google.code.gson:gson:2.11.0")`
- Create: `CardPort.java`, `NoCardException.java`, `Hex.java`, `SimCardPort.java`, `PcscCardPort.java`
- Test: `HexTest.java`, `SimCardPortTest.java`

**Interfaces:**
- Produces:
  - `CardPort`
    - `List<byte[]> transmitBatch(List<byte[]> apdus) throws NoCardException`: mỗi phần tử trả về = `data ‖ sw2byte`, dừng sau SW ≠ 9000
    - `String readerName()`
    - `boolean cardPresent()`
    - `Integer slot()`: null với PC/SC
    - `String mode()`: `"sim"` | `"pcsc"`
  - `SimCardPort`
    - `SimCardPort(int slots)`
    - `void selectSlot(int slot)`: ném `IllegalArgumentException` khi ngoài 0..3
    - `void resetSlot(int slot)`
  - `PcscCardPort(String readerNameOrNull)`
  - `Hex.decode(String) → byte[]`: ném `IllegalArgumentException` khi độ dài lẻ hoặc ký tự lạ. Không phân biệt hoa thường.
  - `Hex.encode(byte[]) → String`: chữ in hoa

- [ ] **Step 1: Viết test**

```java
// HexTest
@Test void roundTrip()  { assertEquals("80100000", Hex.encode(Hex.decode("80100000"))); }
@Test void oddLength()  { assertThrows(IllegalArgumentException.class, () -> Hex.decode("801")); }
@Test void badChar()    { assertThrows(IllegalArgumentException.class, () -> Hex.decode("80ZZ")); }

// SimCardPortTest
static final byte[] SELECT = Hex.decode("00A4040008F054524156454C01");
@Test void selectAndInfoOnBlankCard() {
  var r = new SimCardPort(4).transmitBatch(List.of(SELECT, Hex.decode("8010000000")));
  assertEquals(2, r.size());
  assertEquals("9000", swOf(r.get(1)));
  assertEquals(21, r.get(1).length - 2);
}
@Test void stopsAtFirstError() { /* [SELECT, 807E000000, 8010000000] → 2 phản hồi, phản hồi thứ 2 có SW 6D00 */ }
@Test void slotsAreIndependent() { /* slot 0 gửi INIT (dựng 167B như CardHarness), selectSlot(1) → info state 00 */ }
@Test void switchSlotResetsSession() { /* slot 0: init + VERIFY; selectSlot(1); selectSlot(0); READ_DATA (sau SELECT) → 6985 (mustChange) hoặc 6982 — kiểm SW ≠ 9000 */ } // Review Focus #5
@Test void resetSlotBlanksCard() { /* init slot 0; resetSlot(0); info state 00 */ }
@Test void pcscWithoutReaderThrowsNoCard() {
  assumeTrue(System.getenv("CI_HAS_READER") == null);
  assertThrows(NoCardException.class, () -> new PcscCardPort("does-not-exist").transmitBatch(List.of(SELECT)));
} // Review Focus #2
```

- [ ] **Step 2: Chạy test, xác nhận fail**

  Run: `cd smartcard && ./gradlew :agent:test`

  Expected: FAIL (thiếu lớp).

- [ ] **Step 3: Cài đặt**

  **`SimCardPort`**
  - Giữ `CardSimulator[4]`.
  - Mỗi slot gọi `installApplet(AID F054524156454C01, TravelCardApplet.class)`.
  - Đổi slot: gọi `reset()` trên simulator cũ, để applet nhận deselect.

  **`PcscCardPort`**
  - Gọi `TerminalFactory.getDefault().terminals()`.
  - Nếu cấu hình tên reader thì chọn reader đó, nếu không thì chọn reader đầu tiên có thẻ.
  - `connect("*")`, cache `Card`.
  - Bắt mọi `CardException` hoặc `IllegalStateException` → huỷ cache rồi ném `NoCardException`.
  - Gặp `61xx` thì gửi GET RESPONSE để lấy tiếp dữ liệu.

  **Đồng bộ:** cả hai bản cài đặt đánh dấu `transmitBatch` là `synchronized`.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Commit** — `feat(agent): card ports for jCardSim slots and PC/SC readers`

---

### Task 2: AgentHttpServer

**Files:**
- Create: `AgentConfig.java`, `AgentHttpServer.java`
- Test: `AgentConfigTest.java`, `AgentHttpServerTest.java`

**Interfaces:**
- Consumes: `CardPort`, `Hex` (Task 1)
- Produces:
  - `AgentConfig(int port, Set<String> allowedOrigins, String mode, String reader)`
    - `static AgentConfig load(Path propertiesFile, String[] args)`
    - `--sim` ghi đè `mode`; `--port=N` ghi đè `port`
  - `AgentHttpServer(AgentConfig cfg, CardPort port)`
    - `void start()`
    - `void stop()`
    - `int boundPort()`
    - `cfg.port = 0` → OS chọn cổng (chỉ dùng trong test)

- [ ] **Step 1: Viết test**

  Test khởi động server với `SimCardPort` và `port = 0`, gọi bằng `HttpClient`.

```java
@Test void configSimFlag()         { /* load(file mode=pcsc, ["--sim"]).mode() == "sim"; allowedOrigins tách dấu phẩy + trim */ }
@Test void status()                { /* GET /v1/status → 200 {"mode":"sim","cardPresent":true,"slot":0} */ }
@Test void transmit()              { /* POST {"apdus":["00A4040008F054524156454C01","8010000000"]} → responses[1].sw == "9000", data dài 42 ký tự hex */ }
@Test void transmitStopsOnError()  { /* [SELECT, "807E000000", "8010000000"] → responses.length == 2, responses[1].sw == "6D00" */ }
@Test void badRequests() {         // Review Focus #3
  /* body không phải JSON; "apdus" rỗng; 65 APDU; hex lẻ "801"; APDU dài 262 byte → mỗi trường hợp 400 {"error":"bad-request"} */
}
@Test void foreignOriginRejected() { /* header Origin: https://evil.example → 403 {"error":"origin"}; OPTIONS cùng Origin → 403 */ } // Review Focus #4
@Test void allowedOriginCors()     { /* Origin http://localhost:3000 → 200 kèm Access-Control-Allow-Origin: http://localhost:3000;
                                        OPTIONS → 204 kèm Access-Control-Allow-Private-Network: true */ }
@Test void simSlotEndpoints()      { /* POST /v1/sim/slot {"slot":2} → {"slot":2}; status.slot == 2; {"slot":9} → 400; /v1/sim/reset {"slot":2} → 200 */ }
@Test void simEndpointsAbsentInPcsc() { /* server dựng với CardPort giả có mode "pcsc" → /v1/sim/slot trả 404 */ }
@Test void noCardIs503()           { /* CardPort giả ném NoCardException → 503 {"error":"no-card"} */ }
@Test void concurrentBatchesDoNotInterleave() { // Review Focus #1
  /* CardPort giả ghi lại thứ tự APDU nhận được, mỗi APDU sleep 5ms; 2 luồng, mỗi luồng gửi batch 10 APDU có tag riêng;
     assert thứ tự ghi nhận là 10 APDU của luồng A liền nhau rồi tới 10 APDU của luồng B, hoặc ngược lại */
}
```

- [ ] **Step 2: Chạy test, xác nhận fail**

- [ ] **Step 3: Cài đặt**

  - Mỗi context gọi chung `handle(exchange)`, thứ tự xử lý: kiểm Origin → xử lý OPTIONS → định tuyến.
  - Body tối đa 64 KB.
  - Độ dài mỗi APDU phải nằm trong 4..261 byte.
  - JSON đọc/ghi bằng Gson.
  - Log ra console một dòng mỗi APDU, chỉ gồm INS và SW, ví dụ `INS=20 SW=9000`.

- [ ] **Step 4: Chạy test, xác nhận pass**

- [ ] **Step 5: Commit** — `feat(agent): localhost HTTP bridge with origin allowlist`

---

### Task 3: AgentMain, cấu hình và chạy thử

**Files:**
- Create: `AgentMain.java`, `smartcard/agent/agent.properties`
- Modify: `smartcard/README.md` (thêm mục Agent)

**Interfaces:**
- Consumes: `AgentConfig.load`, `AgentHttpServer`, `SimCardPort`, `PcscCardPort`
- Produces:
  - Lệnh chạy cho plan 03: `cd smartcard && ./gradlew :agent:run --args="--sim"`
  - Khi khởi động, in ra `Card Agent listening on http://127.0.0.1:31999 (mode=sim)`

- [ ] **Step 1: Cài đặt `AgentMain.main`**

  1. `AgentConfig.load(Path.of("agent.properties"), args)`, chạy với thư mục làm việc là `smartcard/agent`. Gradle `run` đặt `workingDir = projectDir`.
  2. Tạo port tương ứng với `mode`.
  3. `start()`.
  4. Đăng ký shutdown hook gọi `stop()`.

- [ ] **Step 2: Chạy thử ở chế độ sim**

  Run: `./gradlew :agent:run --args="--sim"` (chạy nền), sau đó:

```bash
curl -s http://127.0.0.1:31999/v1/status
curl -s -X POST http://127.0.0.1:31999/v1/transmit -H 'Content-Type: application/json' \
  -d '{"apdus":["00A4040008F054524156454C01","8010000000"]}'
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' http://127.0.0.1:31999/v1/status
```

  Expected:
  - lệnh 1 trả `{"mode":"sim",...,"cardPresent":true,"slot":0}`;
  - lệnh 2 có `"sw":"9000"` ở phản hồi thứ 2;
  - lệnh 3 in `403`.

- [ ] **Step 3: Checklist PC/SC (khi có đầu đọc thật)**

  Chạy `./gradlew :agent:run` khi không cắm thẻ, `status.cardPresent` phải là `false`. Sau đó:
  - cắm thẻ đã cài CAP → transmit SELECT + INFO trả `9000`;
  - rút thẻ → `503`;
  - cắm lại → `9000` mà không cần khởi động lại agent.

  Ghi kết quả vào README.

- [ ] **Step 4: Chạy toàn bộ test**

  Run: `./gradlew test`

  Expected: `BUILD SUCCESSFUL` cho cả `:applet` và `:agent`.

- [ ] **Step 5: Commit** — `feat(agent): runnable agent with sim and PC/SC modes`
