# Plan 03 — Báo cáo Task 1

Ngày: 2026-11-10. Workspace: `D:\vietnam-travel`. Nhánh: `feature/smartcard`.

Phạm vi: nền tảng test runner, khóa, CardShared, crypto và APDU. Task 2 chưa triển khai.

## File và chức năng

| File | Thay đổi |
|---|---|
| `package.json` | Thêm `test`, `test:integration`, `card:keygen`; không thêm dependency. |
| `.env.example`, `.gitignore` | Khai báo ba biến `CARD_*`, bỏ qua `keys/`. |
| `index.js` | Đưa `CARD_AGENT_URL` vào `app.locals.cardAgentUrl`. |
| `public/assets/js/card/card-shared.js` | UMD Node/trình duyệt; 22 INS, trạng thái, giới hạn, hex/APDU, SW tiếng Việt, TLV UTF-8 và chính sách PIN. |
| `helpers/card-crypto.helper.js` | RSA PKCS#1 v1.5/SHA-256, HMAC escrow, AES-128-ECB, sinh PIN; đọc env lazy và cache khóa theo path. |
| `helpers/card-apdu.helper.js` | Dựng lệnh ký/INIT/auth; phân tích public info/receipt; payload ví và vé với ngày UTC+7. |
| `scripts/generate-card-key.js` | Sinh RSA-1024/e65537 PKCS#8; từ chối ghi đè bằng `wx`. |
| `test/card-shared.test.js`, `test/card-crypto.test.js`, `test/card-apdu.test.js`, `test/card-keygen.test.js` | Unit test bằng `node:test`, vectors Java và kiểm CLI trong thư mục tạm. |
| Plan 03, `HANDOFF.md`, báo cáo này | Cập nhật tiến độ và bằng chứng Task 1. |

## Kiểm thử

Môi trường xác minh: Node `v25.9.0`, Yarn `1.22.22`, Windows. Plan ghi Node 26; không nâng cấp Node hoặc cài thêm công cụ trong task này.

- RED đầu tiên: `npm.cmd test` exit 1; ba module chưa tồn tại và hai test keygen chưa có script, đúng bước 2 của plan.
- GREEN ban đầu: 45 PASS, 0 FAIL.
- RED bổ sung: test ngày có năm năm chữ số phát hiện dữ liệu vượt layout `YYYYMMDD` tám byte; 45 PASS, 1 FAIL. Đã bổ sung kiểm tra định dạng.
- Kiểm lại toàn bộ `npm.cmd test`: **46 PASS, 0 FAIL, 0 SKIP** (16 APDU, 12 crypto, 16 shared, 2 keygen).
- Chữ ký server khớp từng byte với Java; xác minh auth/receipt từ vectors applet. Các test sửa message/chữ ký/sai khóa đều bị từ chối.
- `node --check index.js`: PASS.
- `git -c core.whitespace=cr-at-eol diff --cached --check`: PASS; chấp nhận CRLF đang dùng trên Windows.
- `test:integration`: **NOT_RUN**, chưa có bài test MongoDB ở Task 1. Không truy cập DB phát triển/production.
- E2E qua agent, trình duyệt thật và hồi quy thanh toán: **NOT_RUN** trong Task 1. Kiểm UMD bằng Node VM không thay thế kiểm trình duyệt thật.

## Khóa dev và bảo toàn thay đổi có sẵn

- Đã chạy `npm run card:keygen` thông qua tiến trình giữ stdout trong bộ nhớ; xác minh khóa PKCS#8 RSA-1024/e65537 tại `keys/card-server-private.pem`.
- Đã thêm ba biến `CARD_*` vào `.env`, giữ nguyên toàn bộ byte có sẵn. Không in master/PIN/private key vào log hoặc báo cáo.
- `.env` và `keys/card-server-private.pem` đều bị Git bỏ qua; không thuộc commit.
- Hai file `smartcard/agent/build.gradle.kts` và `smartcard/applet/build.gradle.kts` đã modified trước task: giữ nguyên cấu hình UTF-8, không stage/commit.
- SHA256 trước/sau của agent: `C399240D30E8C759EE0AD6994B83405168D31BFE94911D12385EEC1309297F7D`.
- SHA256 trước/sau của applet: `9236B4E4ED6B30E821D80A3AEE6915DC56ADD523970C852BA31BAF0C1B6FEB04`.

## Review

Review độc lập bằng Superpowers `subagent-driven-development` và `requesting-code-review`: **Spec Compliance PASS / Task quality Approved**. Không phát hiện Critical, Important hoặc Minor cần sửa. Reviewer đã đối chiếu diff với đặc tả và bằng chứng 46/46 test; không chạy lại suite hoặc truy cập `.env`/khóa thật.

Coordinator kiểm chứng riêng hash Gradle, danh sách file stage, Git ignore và bằng chứng sinh khóa dev. Commit chỉ chứa Task 1 và tài liệu bàn giao; giữ nhánh `feature/smartcard`, chưa push/merge.

## Giới hạn và việc tiếp theo

- `parseReceipt` phân tích dữ liệu; caller ở task sau phải xác minh chữ ký và các điều kiện cardId/txRef/amount/counter/balance theo spec 6.3.
- Cache khóa theo path; thay nội dung khóa cùng path cần khởi động lại tiến trình hoặc đổi path.
- Giữ nguyên RSA-1024 và giao thức của spec. Theo spec 3.2, `kEscrow` cùng EEPROM với DEK bọc; OwnerPIN và khả năng chống can thiệp của chip là hàng rào chính. Simulator không chứng minh khả năng bảo vệ của thẻ thật.
- Task tiếp theo: **Task 2 — test giao thức end-to-end qua agent sim**; chỉ thực hiện khi được giao tiếp.

Bằng chứng chi tiết RED/GREEN và báo cáo subagent nằm ở `.superpowers/sdd/2026-11-04-smartcard-03-web/` (Git bỏ qua). Báo cáo này lưu kết quả cần bàn giao trong repository.
