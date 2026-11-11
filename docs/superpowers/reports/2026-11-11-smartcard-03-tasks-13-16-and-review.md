# Plan 03: Task 13–16 và rà soát lại Task 1–12

Ngày: 2026-11-11. Nhánh `feature/smartcard`, từ `de8c548` (hết Task 12) đến HEAD.

## 1. Kết quả kiểm thử cuối (chạy lại toàn bộ sau commit cuối)

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| Applet (jCardSim) | `cd smartcard && ./gradlew test --rerun-tasks` | 266/266 PASS |
| Card Agent | (cùng lệnh trên) | 30/30 PASS |
| Unit + E2E jCardSim | `AGENT_URL=http://127.0.0.1:31999 npm test` | 199/199 PASS |
| Integration Mongo/HTTP | `TEST_DATABASE=mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test npm run test:integration` | 289/289 PASS |
| Nghiệm thu end-to-end trên Chrome thật (Task 16b) | xem `smartcard/README.md`, mục nghiệm thu | 15 PASS, 1 NOT_RUN (cổng sandbox thật) |

## 2. Task 13–16

| Task | Nội dung | Ghi chú |
|---|---|---|
| 13 | Thanh toán bằng ví thẻ, giảm giá theo hạng, tự điền thông tin | Mất biên nhận sau DEBIT được khôi phục bằng GET_RECEIPT; đơn `paid` đúng một lần |
| 14 | Nạp ví online qua ZaloPay/VNPay | Mỗi thẻ tối đa một giao dịch nạp online đang chờ; hạn 15 phút; trần 50 triệu tính cả giao dịch đang chờ; không cộng vượt trần chip |
| 15 | Vé điện tử, check-in, hủy đơn | Cửa sổ check-in [ngày khởi hành − 1, hết ngày khởi hành] theo giờ Việt Nam; hủy đơn là trạng thái cuối, vé đã ghi được xóa khỏi thẻ ở lần đồng bộ sau |
| 16 | Thống kê dashboard, README "Chạy toàn hệ thống", nghiệm thu toàn bộ | Nghiệm thu chạy bằng Chrome headless qua CDP, agent `--sim`, DB test, SMTP/Cloudinary MOCK |

Sau Task 16 có một lượt review toàn nhánh cho Task 13–16. Lượt này phát hiện và sửa: sửa đơn trong admin khi đang có giao dịch trừ tiền dở dang, giao dịch chưa ký khi thu hồi/cấp lại thẻ, nạp online song song, nhật ký thao tác thẻ thiếu loại thao tác.

## 3. Rà soát lại Task 1–12

Task 1–12 do người khác làm trước đó. Đã review độc lập lại toàn bộ, chia 5 nhóm. Task 11–12 không có lỗi nặng. Các lỗi đã sửa:

| Mã | Mức | Lỗi | Cách sửa |
|---|---|---|---|
| L7 | Nghiêm trọng | Giao dịch ví đã ký nhưng không vào chip (GET_RECEIPT trả 6A88) làm thẻ kẹt vĩnh viễn: không thanh toán, nạp, khóa, thu hồi được | Chứng minh từ mã applet rằng lệnh đã ký cũ không chạy được nữa sau khi challenge đổi, có test sống trên jCardSim. Chỉ chủ thẻ đã đăng nhập, hoặc admin có quyền `card-topup` + thẻ nhân viên + step-up còn hạn, mới đóng được, và phải đúng `signedOpId` trình duyệt đã thấy. Trừ tiền → `failed`; cộng tiền → trở lại chờ ký. Mỗi lần đóng có CardLog. Biên nhận hợp lệ đến muộn được ghi CardLog `releasedButApplied` để đối soát |
| L1 | Quan trọng | VNPay/ZaloPay: khách đã trả nhưng ghi nhận đơn lỗi thì bị bỏ qua, không ghi gì | Ghi dòng đối soát (mã đơn, số tiền, cổng) và hiện trang "đang xử lý"; cảnh báo khi Mongo không phải replica set |
| L2 | Quan trọng | ZaloPay từ chối số điện thoại có dấu cách | Chuẩn hóa số điện thoại; từ chối sớm số không dùng được |
| L3 | Quan trọng | Thao tác đổi trạng thái / reset PIN / nạp tiền mặt bị từ chối không có nhật ký | Ghi CardLog kèm mã lỗi |
| L4 | Quan trọng | Thông báo thiếu quyền sai câu chữ; trang GET trả JSON thô | Câu chuẩn "Bạn không có quyền sử dụng tính năng này!" và trang `no-permission` dùng chung |
| L5 | Quan trọng | Form tài khoản admin nhận nguyên `req.body`: người có quyền sửa tài khoản tắt được yêu cầu đăng nhập bằng thẻ của nhân viên khác | Chỉ nhận các trường của form |
| L6 | Quan trọng | Kiểm tra PIN trùng ngày sinh không bao giờ chạy (sai định dạng ngày) | Chuẩn hóa Date/ISO theo giờ Việt Nam |
| L8 | Quan trọng | `/sync/next` chưa đăng nhập tạo và ký thao tác mới mỗi lần gọi | Dùng lại thao tác cũ còn hạn; giới hạn 60 lần/phút theo thẻ + IP |
| L9 | Quan trọng | `/sync/next` trả 403 cứng khi phiên hết hạn | Trả `{step:null, requiresAuth:true}` |
| R16 | Gia cố | Đăng nhập admin không kiểm tra kiểu email/mật khẩu | Chỉ nhận chuỗi |

Rủi ro còn lại của L7: thông báo 6A88 và challenge do trình duyệt gửi lên không có chữ ký. Chủ thẻ (hoặc admin ví đã step-up) cố tình báo sai chỉ gây hại cho chính thẻ đó: tiền cộng thừa không tiêu được vì máy chủ từ chối mọi biên nhận sau đó của thẻ, và thẻ cần đối soát thủ công (chưa có màn hình admin cho việc này). Thẻ đang khóa hoặc bắt buộc đổi PIN trả 6985 khi đọc biên nhận, nên giao dịch kẹt chỉ được gỡ khi thẻ hoạt động lại.

## 4. Quyết định đã đưa ra khi làm (không có người hỏi lại)

1. Bước "kiểm thủ công" của Task 13–15 chuyển thành test tự động; một lượt nghiệm thu trình duyệt thật ở Task 16.
2. Logic cửa sổ check-in chỉ có một chỗ (`ticket.helper.js`).
3. Không thêm hàm `findPendingItems` trùng lặp.
4. `pay/prepare` từ chối khi đã có giao dịch trừ tiền `sent` hoặc đã ký; dùng lại giao dịch chưa ký cùng đơn/thẻ/số tiền.
5. Trần nạp online tính giao dịch đang chờ ghi thẻ; tiền khách đã trả không bị từ chối ở callback.
6. Yêu cầu nạp online có hạn 15 phút; cổng báo thất bại thì giao dịch `failed`.
7. Người có quyền `card-checkin` được ký riêng thao tác ghi vé khi quét check-in.
8. Hủy đơn là trạng thái cuối; form sửa đơn chỉ nhận các trường của form.
9. Task 16 tách 16a (thống kê, README) và 16b (nghiệm thu bằng Chrome headless).
10. `smartcard/gradlew` được đặt quyền thực thi trong git.
11. Review toàn nhánh chỉ cho Task 13–16 (Task 1–12 sau đó được rà soát lại riêng, mục 3).
12. Mỗi thẻ tối đa một giao dịch nạp online đang chờ; đồng bộ không cộng vượt trần chip.
13. Giao dịch trừ tiền chưa ký bị hủy khi thu hồi/cấp lại thẻ hoặc khi hủy đơn; giao dịch cộng tiền chưa ký được chuyển sang thẻ mới.
14. Admin không đổi được trạng thái/thanh toán của đơn đang có giao dịch trừ tiền dở dang; chuyển chưa trả → đã trả đi qua `markOrderPaid`.
15. Trả đơn của khách khác vẫn báo OP_STATE (không để lộ mã đơn tồn tại).
16. Đăng nhập admin kiểm tra kiểu dữ liệu (đưa vào đợt sửa).
17. 6A88 chỉ được coi là cuối khi chứng minh được từ mã applet và test sống.
18. `/sync/next` dùng lại thao tác cũ và có giới hạn tần suất; trường hợp phiên hết hạn trả `requiresAuth`.
19. Đóng giao dịch 6A88 chỉ cho chủ thẻ hoặc admin ví đã step-up, đúng `signedOpId`; biên nhận đến muộn được ghi nhật ký.

## 5. Việc để lại (lỗi nhỏ, không chặn)

**Thanh toán, nạp tiền**
- Đơn trả qua cổng sau khi admin đã hủy chỉ có dòng đối soát, không tự hoàn tiền.
- `x-forwarded-for` có thể là danh sách; kiểm tra Origin và giới hạn tần suất dùng `req.ip` nên phía sau proxy HTTPS cần bật `trust proxy`.
- F5 sau khi nạp đôi khi vẫn hiện "Đang chờ cổng…" dù đã cộng.
- Thiếu test: callback sau khi cấp lại thẻ, sai `app_id` ZaloPay.
- Đơn liên kết khách (không trả bằng ví) chuyển đã trả → chưa trả → đã trả chạy settlement lại, làm `totalSpent` tăng thừa.

**Vé, check-in, hủy đơn**
- Mỗi lần quét chỉ check-in được vé sẵn sàng đầu tiên; tour gom theo `tourId` nên các ngày khởi hành bị gộp.
- Đổi ngày tour không dời cửa sổ check-in của vé đã đặt.
- Nút "Đọc thẻ" của khách không ghi/xóa vé đang chờ (phải dùng đồng bộ).
- Hủy đơn là hai lần ghi riêng (trạng thái rồi item).

**Nhật ký, bảo mật**
- Sai PIN khi khách đăng nhập không ghi nhật ký; một số kết quả `/sync/receipt` và `/op/sign` thành công không có CardLog.
- Gửi lại nhiều lần một biên nhận hợp lệ đến muộn ghi nhiều dòng nhật ký (không chống trùng).
- JWT khách vẫn dùng được tới 1 ngày sau khi đăng xuất; chưa giới hạn tần suất `login/challenge`, đăng nhập mật khẩu và nonce; cookie chưa có cờ `secure`.
- Quy tắc PIN yếu chỉ kiểm ở trình duyệt (thẻ và máy chủ không thấy PIN); admin sửa ngày sinh không kiểm lại PIN hiện tại.
- Mất bước xác nhận reset PIN sau khi chip đã đổi thì PIN mới không hiển thị/gửi được (reset lần nữa để khôi phục).

**Khác**
- `BALANCE_MAX` lặp lại ở vài nơi ngoài `card-shared.js`.
- Khách mới chưa kiểm tra trùng email/số điện thoại.
- Dữ liệu danh mục lỗi làm sập server (có sẵn từ trước, ngoài phạm vi thẻ).
- Không có màn hình admin để đối soát thẻ lệch số dư (mục 3).

## 6. Chưa kiểm chứng (NOT_RUN)

Cổng VNPay/ZaloPay sandbox thật, gửi email SMTP thật, upload Cloudinary thật, thẻ và đầu đọc thật.
