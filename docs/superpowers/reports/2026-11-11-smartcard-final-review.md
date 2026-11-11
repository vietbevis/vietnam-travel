# Audit cuối: tồn kho, settlement ví và callback muộn

Ngày 11/11/2026. Nhánh `fix/smartcard-final-review`, baseline `ae0230b0aaa7fba7f744af17321d2e16a4b6aefb`.

Đã đọc HANDOFF, đặc tả, báo cáo Task 13–16 và kiểm caller/model thực tế trước khi sửa. Dùng Superpowers systematic-debugging, test-driven-development, writing-plans, executing-plans, requesting-code-review và verification-before-completion. Kế hoạch: `../plans/2026-11-11-smartcard-final-review.md`.

## 1. Phát hiện xác nhận và bản sửa

| Vấn đề | Bằng chứng code cũ | Cách sửa |
|---|---|---|
| Oversell/mất tồn kho | Nhiều request mua chỗ cuối; item trùng/tour sau hết chỗ/lưu Order lỗi làm mất tồn kho | `controllers/client/order.controller.js:createPost`: reserve `$gte` + `$inc`, tất cả tour và `Order.save({session})` cùng transaction; lỗi rollback hoàn toàn, không bù kho bằng snapshot cũ. Tổng số lượng/giá trị phải nguyên an toàn. |
| Admin ghi paid ví không có debit | Admin đánh paid, đổi bank → card hoặc wrapper settlement card thành công khi không receipt | `controllers/admin/order.controller.js:editPatch` chặn thao tác đó và đổi nhãn đơn đã trả ví. Wrapper từ chối card; `helpers/order-payment.helper.js:settleLinked` kiểm debit done/receipt ký đúng, liên kết order/card/owner/amount/counter/balance. Engine ghi Card/Tx/receipt trước settlement, cùng transaction. |
| Callback muộn vượt trần/mất dấu tiền | Hai expired callbacks cùng xếp credit; fresh callback thẻ không khả dụng vẫn xếp credit; success sau gateway failure không lưu nghĩa vụ | `helpers/card-op.helper.js:markTopupPaid`: lock Card chung với cash/sign/receipt/lifecycle, kiểm lại nghĩa vụ ví; Tx/audit commit cùng nhau. Khoản không được credit lưu bền vững để đối soát. |

### Quyết định đối soát

- Thêm trạng thái `reconciliation`, `paymentReceivedAt`, `reconciliationReason` (`wallet-cap`, `card-unavailable`, `gateway-conflict`). Đây là tiền đã nhận nhưng chưa được phép ghi ví, không phải credited/refunded.
- Hạn mức tính balance + credit pending-card/sent + failed đã ký + reservation online còn hạn, loại chính candidate. Khoản vượt trần không vào queue credit.
- Callback đúng chữ ký/identity/amount được ACK khi nghĩa vụ đã lưu; replay không tạo credit/nghĩa vụ/audit nghiệp vụ lần hai. Audit lỗi rollback để retry.
- Timeout/lỗi tạo URL giữ Tx gốc `failed/gateway`, thay vì xóa identity mà callback muộn cần dùng.
- Callback sau khóa/thu hồi/cấp lại giữ nghĩa vụ trên thẻ nguồn, không tự chuyển sang thẻ mới. Reconciliation chặn thu hồi/cấp lại bỏ qua tiền này.
- Success sau gateway failure giữ để đối soát, không tự cộng ví. Failure/expiry không ghi đè khoản đã nhận.
- Trang khách hiện “Đã nhận tiền — chờ đối soát”; VNPay return này không tự chạy credit và nhắc không thanh toán lại.

Cập nhật quyết định 5/19 của báo cáo Task 13–16: tiếp nhận tiền muộn không đồng nghĩa tự đưa mọi khoản vào pending-card. Chưa triển khai tự refund/chuyển tiền hoặc UI giải quyết nghĩa vụ; không được sửa status để bỏ qua đối soát. Metadata/audit không lưu PIN, MAC, khóa hay token.

## 2. Regression RED → GREEN

| Nhóm | RED code cũ | GREEN sau sửa |
|---|---|---|
| Tồn kho | 4 FAIL: chỗ cuối đồng thời, item trùng, tour sau hết chỗ, save Order lỗi | 11/11 `createPost` PASS |
| Settlement | 3 FAIL: admin paid ví, đổi nhãn sang card, wrapper thiếu receipt | 48/48 card-pay + order-payment PASS |
| Callback | 4 FAIL: quá cap, expired callbacks cạnh tranh, fresh callback thẻ không khả dụng, success sau failure | 29/29 topup PASS trước bổ sung fault injection |
| UI đối soát | 1 FAIL: thiếu thông báo nhận tiền/chờ đối soát | PASS, không tự mở phiên thẻ |

Bổ sung: direct settlement trong session với receipt thiếu/giả; lỗi CardLog → rollback → retry đúng một lần; cash/callback cạnh tranh; reconciliation chặn revoke. Lượt mục tiêu bổ sung: 61/61 card-pay + topup và 2/2 race/lifecycle PASS. Cập nhật các assertion cũ mong xóa Tx/bỏ success muộn để kiểm nghĩa vụ nhận tiền, không nới chữ ký/amount/merchant.

Log đầy đủ tại `.superpowers/final-review/` (gitignored): `inventory-red.log`, `inventory-green.log`, `settlement-red.log`, `settlement-green.log`, `topup-red.log`, `topup-fresh-red.log`, `topup-green.log`, `reconciliation-ui-red.log`, `extra-proof.log`, `liability-green.log`, `unit-final.log`, `integration-final.log`, `java.log`.

## 3. Kiểm thử toàn bộ

| Bộ test | Lệnh PowerShell | Kết quả |
|---|---|---|
| Unit + E2E jCardSim | `$env:AGENT_URL='http://127.0.0.1:31999'; npm.cmd test` | 200/200 PASS, 0 SKIP |
| Mongo integration | `$env:TEST_DATABASE='mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test'; npm.cmd run test:integration` | 305/305 PASS, 0 SKIP, lượt cuối 77,9 giây |
| Applet + Agent Java | `smartcard\gradlew.bat -p smartcard test --rerun-tasks` | BUILD SUCCESSFUL; XML: 266 applet + 30 agent PASS |

Node 25.9.0, Java 17, MongoDB 8.3 replica set loopback `smartcardFinalReview`; dbpath mới `.superpowers/final-review/mongo`, chỉ database `vietnam-travel-smartcard-test` qua guard. Không tải `.env`, không kết nối DB website. Agent thật `--sim`, E2E chạy APDU thật qua jCardSim; gateway transport fixture với kiểm chữ ký thật, không phải sandbox gateway thật.

Baseline: 191 unit PASS/8 SKIP trước bật agent; đã chạy lại đủ với agent. Một lượt chạy hai integration file thiếu `--test-concurrency=1` gây fixture reset đụng nhau; đã xác định orchestration và chạy lại tuần tự theo script chuẩn. Full suite dùng concurrency=1. Java có cảnh báo deprecated API/incubating report, build/test thành công; không đổi Gradle để vượt lỗi môi trường.

## 4. Review độc lập

Ba reviewer context riêng chỉ đọc source/diff/spec; kết luận không thay thế test thực thi:

- **Spec PASS**, re-review bổ sung PASS; không Critical/Important.
- **Quality PASS**, re-review bổ sung PASS. Đã thêm direct in-session receipt test, audit fault injection và sửa indent. Giữ CRLF gốc, kiểm bằng `git -c core.whitespace=cr-at-eol diff --check`.
- **Security PASS**, re-review bổ sung PASS; xác minh receipt gate, race, rollback audit, lifecycle, UI và sửa comment cũ mâu thuẫn. Không Critical/Important còn mở trong phạm vi.

## 5. Giới hạn/bàn giao

- Mọi đặt đơn mới giờ cần Mongo replica set/transaction; standalone fail closed, không fallback ghi rời. Cảnh báo startup đã cập nhật. Không cấu hình/migrate DB website trong lượt này.
- Nghĩa vụ đối soát đã lưu bền vững nhưng chưa có màn hình/quy trình tự hoàn tiền/giải phóng nghĩa vụ; cần xác minh thủ công trước xử lý.
- **NOT_RUN:** sandbox VNPay/ZaloPay thật, SMTP/Cloudinary thật, nghiệm thu lại toàn hệ thống bằng trình duyệt, thẻ/đầu đọc vật lý. Giới hạn có sẵn khác giữ theo báo cáo Task 13–16, gồm JWT/logout/cookie/rate limit và settlement lặp của đơn không trả ví khi admin đổi paid/unpaid.
- Không sửa `.env`, `keys/`, dữ liệu website, dependency hoặc file Gradle. Không cài thêm công cụ. Không merge/push.
- Commit riêng thay đổi audit trên nhánh fix rồi dừng; commit hash cung cấp trong bàn giao chat.
