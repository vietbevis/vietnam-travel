# Plan 03 — Báo cáo Task 2: E2E qua Card Agent jCardSim

Ngày: 2026-11-10. Workspace `D:\vietnam-travel`, nhánh `feature/smartcard`.
BASE: `bbf3f2c201c35501ee5af494e9731723b65d8c24` (Task 1).

## Phạm vi và kết quả

Tạo `test/card-e2e.test.js` với đúng năm test, chạy HTTP/APDU thật qua `http://127.0.0.1:31999`, agent báo `mode=sim`, `reader=jCardSim`, `slot=0`. Không mock giao thức. Không sửa helper, applet, agent hoặc chức năng website.

| Bài E2E | Kết quả | Nội dung kiểm chứng |
|---|---|---|
| Issue → change PIN → authentication | PASS | SELECT/CREATED, INIT với modulus 128B, đổi PIN, xác thực PIN, counter 0 và chữ ký AUTHENTICATE hợp lệ; nonce bị sửa không hợp lệ. |
| Signed lock/unlock | PASS | Challenge mới cho từng lệnh ký; trạng thái LOCKED chặn VERIFY bằng 6985; unlock về ACTIVE và xác thực lại thành công. |
| Credit/debit và receipt | PASS | Nạp 1.500.000, trừ 400.000; kiểm chữ ký và cardId/type/txRef/amount/balance/counter của cả hai receipt; số dư cuối 1.100.000, counter 2; DEBIT xóa phiên PIN. |
| Reset PIN bằng escrow | PASS | Ciphertext và lệnh ký dùng fixture; PIN mới hợp lệ, PIN cũ bị từ chối, mustChangePin được bật và bộ đếm thử được reset. |
| Profile write/commit/read | PASS | Hồ sơ UTF-8 228B đi qua hai chunk 224B + 4B; COMMIT ký hash/length; đọc lại đúng độ dài và byte gốc, giải mã đúng chín trường. |

Trước **mỗi** bài: kiểm `mode=sim`, reset slot 0, chọn slot 0, kiểm lại status, SELECT và xác minh thẻ CREATED trắng. Năm bài chạy tuần tự. Không chạy hai tiến trình E2E cùng lúc vào slot 0.

`AGENT_URL` chỉ nhận HTTP loopback không credentials; request không theo redirect. Chỉ khi biến không được khai báo (`undefined`) mới SKIP với lý do rõ, không gọi mạng. Giá trị rỗng hoặc agent lỗi thì FAIL, không chuyển thành SKIP hoặc mock. Timeout mỗi request 10 giây, mỗi bài 30 giây.

## Kiểm thử và TDD

| Lệnh / chế độ | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Baseline Task 1 trước triển khai: `npm.cmd test` | 46 | 0 | 0 |
| E2E riêng, không có `AGENT_URL` | 0 | 0 | 5 |
| E2E riêng, có agent sim thật | 5 | 0 | 0 |
| Toàn suite không có `AGENT_URL` | 46 | 0 | 5 |
| Toàn suite có agent sim thật | 51 | 0 | 0 |

Implementer và coordinator đã chạy độc lập toàn suite ở cả hai chế độ; kết quả trùng nhau, exit 0. `node --check test/card-e2e.test.js` và kiểm diff với `core.whitespace=cr-at-eol` đạt.

Áp dụng Superpowers TDD: viết test trước mọi sửa production. Task này bổ sung test cho giao thức đã được triển khai; **lần chạy live đầu tiên GREEN 5/5**, không cần sửa production. Review sau đó phát hiện lỗi SKIP với cấu hình rỗng; đã kiểm RED trước sửa và GREEN sau sửa bằng cùng phép kiểm child process: cấu hình `AGENT_URL=''` trước sửa exit 0/SKIP 5, sau sửa exit 1/FAIL 5/SKIP 0 như mong đợi. Đây là kiểm cấu hình âm, không phải năm E2E thất bại trên agent hợp lệ. Khi thật sự thiếu biến, exit 0/SKIP 5 vẫn được giữ.

Lệnh PowerShell để chạy lại (agent sim đang chạy):

```powershell
$env:AGENT_URL = 'http://127.0.0.1:31999'
node --test test/card-e2e.test.js
npm.cmd test

# Kiểm chế độ bỏ qua E2E:
Remove-Item Env:AGENT_URL -ErrorAction SilentlyContinue
npm.cmd test
```

## Khóa test, dữ liệu và thay đổi có sẵn

- Test gán đường dẫn tuyệt đối tới `smartcard/test-vectors/server-test-key.pem` và master từ vectors; không nạp `.env` hoặc khóa dev thật.
- Không log PIN/master/private key/raw APDU; lỗi chỉ chứa metadata an toàn. Không thay vectors, dependency hoặc database.
- Hai file Gradle UTF-8 được giữ ngoài commit, hash khớp trước/sau:
  - agent: `C399240D30E8C759EE0AD6994B83405168D31BFE94911D12385EEC1309297F7D`.
  - applet: `9236B4E4ED6B30E821D80A3AEE6915DC56ADD523970C852BA31BAF0C1B6FEB04`.
- Sau suite, slot 0 còn thẻ fixture ACTIVE và hồ sơ 228B; lần chạy sau sẽ reset lại. Các slot 1–3 không bị reset.

## Node 25.9.0 và yêu cầu Node 26

Runtime đã chạy: **Node v25.9.0**, V8 `14.1.146.11-node.25`, OpenSSL `3.5.5`, Undici `7.24.4`. Không cài/nâng runtime.

Các API dùng trong test (`node:test`, Buffer, `node:crypto`, `fetch`, `AbortSignal.timeout`) đã có trên Node 25.9.0; tài liệu xác nhận fetch ổn định từ Node 21 và AbortSignal.timeout có từ Node 17.3/16.14. [Globals Node 25.9.0](https://nodejs.org/download/release/v25.9.0/docs/api/globals.html#fetch), [test runner](https://nodejs.org/download/release/v25.9.0/docs/api/test.html).

Node 26.0.0 đổi V8 lên 14.6 và Undici lên 8.0.2. Đây là khác biệt có thể ảnh hưởng HTTP/runtime; cần chạy lại cùng suite khi nâng Node. [Release chính thức Node 26.0.0](https://nodejs.org/en/blog/release/v26.0.0).

Các thay đổi crypto DEP0182 (GCM short tag), DEP0203/0204 (WebCrypto CryptoKey) không trực tiếp trùng đường code đang dùng: helper dùng KeyObject/Buffer và AES-ECB. Đây là **suy luận đối chiếu source**, không phải kết quả chạy Node 26. [Tài liệu deprecations tại tag v26.0.0](https://github.com/nodejs/node/blob/v26.0.0/doc/api/deprecations.md#dep0182-short-gcm-authentication-tags-without-explicit-authtaglength).

**Node 26 runtime: NOT_RUN.** Không thấy API bắt buộc Node 26 trong Task 2; chưa xác nhận tương thích runtime 26 hoặc toàn bộ website/dependencies. Giữ nguyên thuật toán/giao thức theo spec.

## Review và lỗi phát hiện

Review độc lập lần đầu xác nhận năm luồng giao thức đạt, nhưng yêu cầu sửa một lỗi Important tại điều kiện SKIP: biến `AGENT_URL` được khai báo rỗng vẫn khiến CI xanh do bỏ qua E2E. Đã thay điều kiện truthiness bằng kiểm `undefined`, giữ nguyên năm test và toàn bộ giao thức. Re-review kết luận **finding ADDRESSED, Spec PASS / Task quality Approved**, không phát hiện lỗi mới hoặc observation ngoài scope. Không phát hiện lỗi helper/applet trong năm luồng live.

Coordinator chạy lại sau fix: toàn suite có agent **51 PASS / 0 FAIL / 0 SKIP**; không có biến **46 PASS / 0 FAIL / 5 SKIP**; syntax check PASS. Kết quả này xác nhận bản sửa cuối, không chỉ bản trước review. Chỉ staging/commit bốn file Task 2 được liệt kê bên dưới; hai file Gradle có sẵn vẫn ngoài commit.

Phiên làm việc bị gián đoạn bởi hạn mức sử dụng của bộ duyệt tự động; đã khôi phục đúng từ fix round 1. Agent không còn chạy khi tiếp tục, nên coordinator khởi động lại `AgentMain --sim` bằng JDK 17, compiled classes và hai JAR jCardSim/Gson đã có trong Gradle cache. Không tải/cài công cụ hoặc sửa build script; wrapper mặc định trỏ tới `C:\.gradle` không tồn tại nên không dùng wrapper để chạy lại.

## File thay đổi và bước tiếp theo

- Tạo: `test/card-e2e.test.js` và báo cáo này.
- Cập nhật: checklist Task 2 trong Plan 03 và `docs/superpowers/HANDOFF.md`.
- Chỉ commit Task 2; không push/merge. Task 3 chưa triển khai.
- Giới hạn: đây là E2E **giao thức Node ↔ Card Agent ↔ jCardSim**, chưa phải E2E nghiệp vụ website/MongoDB/trình duyệt hoặc thẻ thật.
- Task tiếp theo khi được giao: Task 3 — model, quyền, nhật ký, hạng thành viên và quy tắc ví.
