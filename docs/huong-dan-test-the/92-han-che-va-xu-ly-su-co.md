# 92. Hạn chế đã biết và xử lý sự cố

Tài liệu này gom các hành vi "có vẻ lỗi" nhưng là hạn chế thiết kế hoặc môi trường demo, cùng bảng triệu chứng - nguyên nhân - cách xử lý. Mỗi mục đã đối chiếu với mã nguồn (cập nhật sau các bản sửa: thông báo tiếng Việt ở admin, hoàn tiền khi hủy đơn, đăng nhập lại sau khi tự phát hành thẻ NV, script khôi phục). Điều không xác minh được ghi "(chưa xác minh)".

## A. Hạn chế và điểm bất nhất (rút từ mã nguồn)

| # | Hạn chế | Chi tiết (đã xác minh trong mã) |
|---|---|---|
| 1 | **Hủy đơn đã trả ví thẻ có vé đã check-in** | Hủy đơn ví thẻ nay được hỗ trợ và hoàn tiền tự động ([11](11-huy-don-xoa-ve.md)); riêng đơn có vé `used` bị từ chối: "Đơn có vé đã check-in, không thể huỷ và hoàn tiền tự động. Vui lòng xử lý thủ công." Đơn trả bằng tiền mặt/chuyển khoản/cổng đã `paid` vẫn không tự hoàn: "Đơn đã thanh toán cần xử lý hoàn tiền và đối soát riêng." Thẻ khách bị khóa, đang phát hành hoặc không còn thẻ hiện hành cũng chặn hoàn tiền (xem bảng lỗi ở 11) |
| 2 | ~~Trang admin hiện mã lỗi thô~~ **Đã sửa** | Mọi form admin nay hiển thị câu tiếng Việt qua `CardAdmin.errorMessage` (bản đồ ~83 mã, xem [91](91-bang-ma-loi.md) mục 2b); mã lạ hiện câu mặc định kèm mã trong ngoặc |
| 3 | ~~PIN admin không kiểm DDMMYY~~ **Đã sửa** | Admin nay kiểm cả ngày sinh DDMMYY khi đổi PIN lần đầu, ngay trong modal: "PIN quá yếu (không dùng 6 số giống nhau, dãy số liên tiếp hoặc ngày sinh DDMMYY). Vui lòng nhập mã khác." (nếu thẻ mới chặn đọc hồ sơ 6985, kiểm lại ngay sau khi đổi) |
| 4 | **Sai PIN không được hỏi lại trong hộp** | Chỉ PIN yếu và PIN nhập lại không khớp được hỏi lại ngay trong hộp. Sai PIN: hộp đóng, hiện "Sai mã PIN, còn N lần thử", người dùng bấm thao tác lại |
| 5 | **Phát hành thẻ NV cho chính mình làm admin phải đăng nhập lại** | Hoàn tất phát hành đặt `accounts-admin.cardRequired = true`. Giao diện tự đăng xuất và chuyển về `/admin/account/login?notice=card-required` ("Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên. Vui lòng đăng nhập lại bằng mật khẩu và thẻ."). Phiên chỉ có mật khẩu còn sót: trang bị xóa cookie và chuyển về đăng nhập, XHR/JSON nhận 403 `CARD_RELOGIN_REQUIRED` cùng câu đó |
| 6 | **Step-up cần thẻ NV hoạt động khớp phiên** | `/step-up/challenge` và `/step-up/verify`: không có thẻ NV `active` hiện hành: 403 `STAFF_CARD_REQUIRED`; token gắn thẻ khác thẻ hiện hành: 403 `STAFF_CARD_CHANGED`; cắm sai thẻ khi xác thực: 403 `STAFF_CARD_MISMATCH` (câu đầy đủ ở [91](91-bang-ma-loi.md) mục 3a). Không còn `OP_FORBIDDEN` thô |
| 7 | **Hạn mức tiền mặt: form và Joi đều 20.000.000** | Form `max="20000000"`, Joi `cash: max(20000000)` và quy tắc `checkCashTopup`: tối thiểu 10.000, tổng mỗi nhân viên mỗi ngày tối đa 20.000.000 ("Vượt hạn mức tiền mặt 20.000.000 VNĐ mỗi nhân viên mỗi ngày."). 50.000.000 là **trần số dư ví**: "Số dư và tiền chờ nạp vượt hạn mức 50.000.000 VNĐ." (nạp online) và chip `6F11` |
| 8 | **Reset PIN và nạp tiền mặt phải cắm lại thẻ khách sau step-up** | Sau step-up (cắm thẻ NV), giao diện báo lỗi chủ ý "Đã xác thực nhân viên. Hãy cắm lại đúng thẻ đang xem rồi bấm lại thao tác; ..." (`SWITCH_TARGET_CARD`); không tự tiếp tục |
| 9 | **Agent khởi động lại làm chip ảo mất, DB vẫn còn bản ghi** | Chế độ `--sim` giữ thẻ trong bộ nhớ. Chip về trắng, nhưng `cards`, `card-transactions`... còn nguyên: phát hành lại báo `CURRENT_CARD` "Người này đã có thẻ đang hoạt động"; thẻ NV mất thì admin bị kẹt (mục B) |
| 10 | **Agent chặn Origin** | Chỉ origin trong `allowedOrigins` (`http://localhost:3002`) được phép; mở web bằng `127.0.0.1:3002` thì 403 `{"error":"origin"}` (trình duyệt: "Không kết nối được Card Agent") |
| 11 | **ZaloPay callback cần DOMAIN_WEBSITE công khai** | `zalopay.helper.js`: `callback_url = DOMAIN_WEBSITE + callbackPath`; localhost không nhận callback từ ZaloPay. Cần tunnel (ngrok) và đặt `DOMAIN_WEBSITE` |
| 12 | **Khóa VNPay trống** | `vnpay.helper.js` yêu cầu `VNPAY_CODE`, `VNPAY_SECRET`, `VNPAY_URL`, `DOMAIN_WEBSITE` đều khác rỗng, nếu không không tạo được URL. Đã xác nhận trong `.env`: `VNPAY_CODE` và `VNPAY_SECRET` **đều là chuỗi rỗng**, nên nạp VNPay không chạy được trên máy này (gặp `GATEWAY_UNAVAILABLE`). Kết quả VNPay trả về `DOMAIN_WEBSITE`, nên cũng cần địa chỉ truy cập được |
| 13 | **Token không bị thu hồi phía server khi đăng xuất** | Đăng xuất chỉ xóa cookie; JWT khách/admin vẫn hợp lệ đến hết hạn nếu bị sao chép, trừ khi thẻ/tài khoản mất hiệu lực |
| 14 | **Nhật ký: lọc "Thao tác" khớp chính xác** | Placeholder "Ví dụ: card.lock" không phải action thật ([18](18-nhat-ky-the.md)) |
| 15 | **Lỗi bộ lọc trả JSON 400** | Lọc sai ở danh sách thẻ/nhật ký trả JSON `INVALID_INPUT`, không render trang |
| 16 | **README gốc ghi cổng 3000** | Môi trường test dùng **3002** |
| 17 | **Đọc thẻ chỉ đọc** | "Đọc thẻ" không ghi vé; F5 trang kết quả nạp online có thể vẫn "Đang chờ cổng thanh toán xác nhận…" (chưa xác minh) |
| 18 | **Credit vượt trần 50.000.000 bị giữ** | Không ký lệnh; ở `pending-card` chờ đối soát thủ công, log `card-sync-credit-held`; chưa có màn hình xử lý `reconciliation` ([16](16-dong-bo-doi-soat-bien-nhan.md)) |
| 19 | **Mất thẻ NV cuối cùng/duy nhất** | Không có giao diện phục hồi; dùng script khôi phục ở mục B (`npm run card:recover-admin`) |
| 20 | **Khách seed không đặt đơn được** | Khách seed có số điện thoại `0000000001` mà giỏ hàng từ chối (regex số điện thoại hợp lệ, xem [08](08-dat-tour-thanh-toan-vi-the.md)). Tạo khách mới có số thật (ví dụ `0912345678`) ở [03](03-phat-hanh-the-khach-hang.md) rồi dùng khách đó để đặt đơn |
| 21 | **Khoản hoàn vượt trần ví bị giữ** | Hủy đơn khi số dư + credit chờ + tiền hoàn vượt 50.000.000: vẫn hủy được, khoản hoàn `pending-card` bị giữ (`card-sync-credit-held`) tới khi ví còn chỗ hoặc đối soát thủ công |
| 22 | **Hoàn tiền chỉ về thẻ hiện hành `active`** | Khách không có thẻ, thẻ khóa hoặc đang phát hành: hủy bị từ chối (không đổi gì); phải mở khóa/cấp lại thẻ trước |

## B. Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trình duyệt báo "Không kết nối được Card Agent"; `curl` trả `{"error":"origin"}` | Mở web bằng `127.0.0.1` hoặc origin không nằm trong `allowedOrigins` | Dùng `http://localhost:3002`; `curl` thêm `-H 'Origin: http://localhost:3002'` |
| 403 `{"error":"host"}` | Header Host sai (không phải `127.0.0.1:31999` hoặc `localhost:31999`) | Gọi đúng host:port |
| 503 `{"error":"no-card"}` | Slot không có thẻ | Đổi slot: `curl -X POST -H 'Origin: http://localhost:3002' -H 'Content-Type: application/json' -d '{"slot":N}' http://127.0.0.1:31999/v1/sim/slot` |
| 400 `{"error":"bad-request"}` khi đổi slot | JSON sai hoặc slot ngoài 0..3 | Dùng `{"slot":0}` đến `{"slot":3}` |
| 404 `not-found` ở `/v1/sim/slot` | Agent không chạy `--sim` | Chạy Agent với `--sim` |
| Sau khi **khởi động lại Agent** (hoặc `/v1/sim/reset`), phát hành lại báo `CURRENT_CARD` "Người này đã có thẻ đang hoạt động" | Chip trống nhưng DB còn thẻ `active` | Thu hồi/cấp lại trong admin theo quy tắc số dư; hoặc xóa dữ liệu demo ở các collection `cards`, `card-transactions`, `card-operations`, `card-issuance-requests`, `card-logs`, `card-nonces` (chỉ dùng DB demo `vietnam-travel-smartcard-demo`) |
| Đăng nhập admin hỏi thẻ nhưng chip đã mất (Agent restart) hoặc thẻ NV bị khóa/thu hồi/mất | `accounts-admin.cardRequired = true` mà không còn thẻ NV hoạt động | Dùng script khôi phục (xem **Script khôi phục tài khoản admin** bên dưới), hoặc dùng admin khác có `card-reset-pin`/`card-revoke` rồi phát hành lại |
| Đăng nhập mật khẩu xong báo "Thẻ nhân viên đã bị khoá hoặc thu hồi. Liên hệ quản trị viên." | `cardRequired` nhưng không còn thẻ NV `active` hiện hành | Như dòng trên: admin khác mở khóa/cấp lại, hoặc sửa `cardRequired=false` |
| Sau khi phát hành thẻ NV cho chính mình: bị đăng xuất, hoặc XHR trả 403 `CARD_RELOGIN_REQUIRED` | Token cũ không có `cardId` nhưng tài khoản `cardRequired` | Bình thường: đăng nhập lại bằng mật khẩu rồi thẻ ([02](02-dang-nhap-admin-bang-the.md)); trang đăng nhập hiện thông báo `card-required` |
| Step-up báo `STAFF_CARD_REQUIRED` / `STAFF_CARD_CHANGED` / `STAFF_CARD_MISMATCH` | Không có thẻ NV hoạt động / phiên gắn thẻ NV cũ / cắm sai thẻ NV khi xác thực | Phát hành thẻ NV (nếu chưa có) / đăng xuất và đăng nhập lại bằng thẻ mới / cắm đúng thẻ đã đăng nhập |
| Step-up xong nhưng Reset PIN / nạp tiền không chạy | Phải cắm lại thẻ khách | Đổi slot về thẻ khách rồi bấm lại |
| Hết 5 phút giữa các bước: "Thao tác đã hết hạn hoặc đã thay đổi trạng thái. Hãy tải lại trang và thử lại." (`OP_STATE`) | Op/step-up hết hạn | Làm lại thao tác (op mới) |
| Nạp online không chạy | VNPay thiếu cấu hình (`VNPAY_CODE`, `VNPAY_SECRET` rỗng) hoặc ZaloPay cần `DOMAIN_WEBSITE` công khai | Dùng nạp tiền mặt ([06](06-nap-tien-mat-tai-quay.md)); với ZaloPay dùng tunnel công khai |
| Không nhận email PIN/OTP | SMTP lỗi hoặc email khách giả | PIN ban đầu/PIN reset vẫn hiện một lần trên màn hình; đổi email khách thành email đọc được |
| Tour không xuất hiện ở check-in | Ngày khởi hành ngoài cửa sổ check-in ("Chưa tới hoặc đã qua ngày check-in") | Sửa ngày tour **trước** khi đặt ([10](10-check-in-tour.md)) |
| Đồng bộ báo 429 | Hơn 60 yêu cầu/phút cho cặp cardId + IP | Chờ 1 phút |
| Phát hành quá 5 phút: `ISSUE_EXPIRED` | Yêu cầu phát hành hết hạn | Hủy yêu cầu / reset thẻ ảo, phát hành lại |
| Lẫn admin và khách trên cùng trình duyệt | `/sync/next` ưu tiên `customerToken`; cookie dùng chung origin | Dùng hai hồ sơ trình duyệt hoặc cửa sổ ẩn danh |
| PIN thẻ bị khóa | 5 lần sai | Admin Reset PIN ([15](15-sai-pin-khoa-pin-reset-pin.md)) |
| Hủy đơn ví báo "Đơn đang có giao dịch ví thẻ chưa đối soát; hãy để khách cắm thẻ đồng bộ trước" | Debit đã ký/gửi chưa có biên nhận | Khách cắm thẻ đồng bộ rồi hủy lại ([11](11-huy-don-xoa-ve.md)) |
| Hủy đơn ví báo "Đơn có vé đã check-in, không thể huỷ và hoàn tiền tự động. Vui lòng xử lý thủ công." | Có mục vé `used` | Không tự hoàn; xử lý thủ công (không có gì bị thay đổi) |
| Tx `sent` mãi | Gián đoạn lúc debit/credit | Cắm thẻ, đăng nhập lại để chạy bước `receipt` ([16](16-dong-bo-doi-soat-bien-nhan.md)) |
| Ảnh không lưu được | Cloudinary lỗi: 502 `PHOTO_UPLOAD` ("Không thể lưu ảnh; chưa phát hành thẻ.") | Kiểm tra cấu hình Cloudinary; thử ảnh khác |

### Script khôi phục tài khoản admin kẹt thẻ (`scripts/admin-card-recover.js`)

Dùng khi tài khoản admin có `cardRequired = true` nhưng không còn thẻ NV hoạt động (chip ảo mất, thẻ bị thu hồi/khóa, mất thẻ) và không có admin khác để cấp lại. Script chỉ đổi `cardRequired` về `false` cho **một** tài khoản (theo email), không đụng thẻ hay PIN. Chạy ở thư mục gốc dự án, cần biến `DATABASE` trong `.env`.

```bash
# 1) Chạy thử (dry run), mặc định: chỉ in tài khoản, danh sách thẻ NV và có đủ điều kiện hay không, KHÔNG ghi gì
npm run card:recover-admin -- admin@example.com

# 2) Thực hiện thật: thêm --yes (nên kèm --reason để ghi vào nhật ký)
npm run card:recover-admin -- admin@example.com --yes --reason "Mất thẻ NV, không còn admin khác"

# 3) Tài khoản vẫn còn thẻ NV đang hoạt động: script từ chối, trừ khi thêm --force
npm run card:recover-admin -- admin@example.com --yes --force --reason "Tắt cardRequired có chủ đích"
```

- Tương đương: `node scripts/admin-card-recover.js <email> [--yes] [--force] [--reason "lý do"]`. Không có email: in "Thiếu email tài khoản admin." và cách dùng.
- Từ chối khi: không tìm thấy tài khoản ("Không tìm thấy tài khoản admin đang hoạt động (chưa xóa) với email này."), tài khoản không bật `cardRequired` ("Tài khoản không bật cardRequired; không cần khôi phục."), hoặc còn thẻ NV hoạt động mà không có `--force` ("Tài khoản vẫn còn thẻ nhân viên đang hoạt động; không cần khôi phục. Dùng --force nếu thật sự muốn tắt cardRequired.").
- Dry run in: "Chạy thử (dry run): chưa thay đổi gì. Thêm --yes để đặt cardRequired=false cho tài khoản này."
- Thành công (có `--yes`): in "Đã tắt cardRequired và ghi Nhật ký thẻ (admin-card-recover)." rồi hướng dẫn: (1) đăng nhập trang admin chỉ bằng email + mật khẩu, (2) vào Phát hành thẻ -> Nhân viên phát hành thẻ NV mới cho chính tài khoản (việc này bật lại `cardRequired`; sau đó tự đăng xuất và đăng nhập lại bằng thẻ, xem [01](01-phat-hanh-the-nhan-vien.md)), (3) từ lần sau dùng thẻ mới.
- Nhật ký thẻ (`/admin/card/log`, lọc "Thao tác" = `admin-card-recover`): `actorType system`, `actorId cli`, chi tiết có `email`, `reason`, `force`, danh sách thẻ trước đó.

## C. Không xác minh được

Hành vi cổng VNPay/ZaloPay thật (khóa VNPay đã xác nhận trống); gửi email thật; tải ảnh Cloudinary; chế độ đầu đọc thật (PC/SC); nhãn chính xác ở trang nhóm quyền; chi tiết SW từng INS ở [91](91-bang-ma-loi.md); script khôi phục mới chỉ chạy thử (dry run) với email không tồn tại, chưa chạy `--yes` trên DB thật.

## Liên quan

[91](91-bang-ma-loi.md) | [00](00-tong-quan.md) | [90](90-kich-ban-end-to-end.md)
