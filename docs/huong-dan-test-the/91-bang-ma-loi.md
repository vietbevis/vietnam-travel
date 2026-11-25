# 91. Bảng mã lỗi

Tra cứu nhanh mã lỗi của chip (SW), trình duyệt, server và Card Agent, kèm nơi hiển thị thông báo. Nguồn: `public/assets/js/card/card-shared.js`, `public/assets/js/card-customer.js`, `public/admin/assets/js/card-admin.js`, `controllers/admin/card.controller.js`, `controllers/client/card-api.controller.js`, `controllers/admin/card-checkin.controller.js`, `helpers/card-op.helper.js`, applet `CardConst.java`, `AgentHttpServer.java`.

## 1. Mã status word (SW) của chip

Thông báo lấy từ `swMessage()` (dùng chung ở khách và admin). `63Cx` là sai PIN; ký tự cuối x là số lần còn lại.

| SW | Hằng số applet | Thông báo hiển thị | Khi nào xảy ra |
|---|---|---|---|
| 9000 | OK | Thành công | Lệnh thực hiện xong |
| 63C4..63C0 | SW_PIN_FAILED_BASE + tries | "Sai mã PIN, còn N lần thử" (N = 4..0) | `VERIFY_PIN` sai lần 1..5 (lần sai thứ 5 trả 63C0) |
| 6700 | SW_WRONG_LENGTH | Sai độ dài | Dữ liệu lệnh sai độ dài (PIN không đủ 6 byte, chữ ký/lệnh sai kích thước) |
| 6982 | SW_PIN_NOT_VERIFIED | Chưa xác thực PIN | Gọi lệnh cần PIN (READ_DATA, GET_BALANCE, DEBIT...) khi chưa `VERIFY_PIN` |
| 6983 | SW_PIN_BLOCKED | PIN đã bị khoá | PIN hết lượt thử (lần thử sau 63C0); `VERIFY_PIN` kể cả PIN đúng |
| 6985 | SW_BAD_STATE | Sai trạng thái, chưa đổi PIN hoặc vé đã dùng | Thẻ chưa `ACTIVE`, đang `mustChangePin` mà gọi lệnh khác ngoài danh sách cho phép, `USE_TICKET` vé đã dùng, `INIT` thẻ không ở CREATED |
| 6986 | SW_CARD_TYPE | Không cho phép với loại thẻ này | Lệnh ví/vé gửi tới thẻ nhân viên |
| 6A80 | SW_BAD_DATA | Dữ liệu sai | Nội dung không hợp lệ (tham số `SET_STATE`, dữ liệu ghi, hồ sơ, ngoài miền) |
| 6A84 | SW_NO_SPACE | Hết chỗ lưu trữ | Nhật ký/vé/vùng ghi đầy |
| 6A86 | SW_BAD_P1P2 | P1/P2 sai | Tham số P1/P2 ngoài khoảng cho phép |
| 6A88 | SW_NOT_FOUND | Không tìm thấy dữ liệu | `GET_RECEIPT` khi challenge đã xoay/không có giao dịch; xóa vé không tồn tại |
| 6D00 | SW_INS_NOT_SUPPORTED | Lệnh không hỗ trợ | INS lạ hoặc INS không được phép ở trạng thái hiện tại |
| 6E00 | SW_CLA_NOT_SUPPORTED | CLA sai | CLA khác 0x80 |
| 6F10 | SW_INSUFFICIENT_BALANCE | Số dư không đủ | `DEBIT` lớn hơn số dư chip |
| 6F11 | SW_BALANCE_LIMIT | Vượt hạn mức số dư | `CREDIT` làm số dư chip vượt 50.000.000 |
| 6F20 | SW_BAD_SIGNATURE | Chữ ký server sai | Lệnh ký (CREDIT, DEBIT, SET_STATE, RESET_PIN, WRITE_TICKET, COMMIT_WRITE...) không verify được hoặc hết hiệu lực |
| 6F21 | SW_NO_CHALLENGE | Chưa có challenge | Lệnh ký mà chưa `GET_CHALLENGE` hoặc challenge đã dùng/xoay |
| khác | - | "Lỗi thẻ không xác định (XXXX)" | SW không có trong bảng |

Ghi chú: cột "Khi nào xảy ra" được suy ra từ ngữ nghĩa và mã applet; trường hợp cụ thể từng INS chưa kiểm chứng từng dòng (chưa xác minh chi tiết).

### Trạng thái chip (`GET_PUBLIC_INFO`)

| Mã | Tên | Ý nghĩa |
|---|---|---|
| 0x00 | CREATED | Thẻ trắng, chưa `INIT` |
| 0x02 | ACTIVE | Đang dùng |
| 0x03 | LOCKED | Khóa (server ghi bằng `SET_STATE`) |
| 0x7F | TERMINATED | Thu hồi, không còn dùng được |

## 2. Mã lỗi phía trình duyệt (`error.code`)

### 2a. Bản đồ thông báo của trang khách (`card-customer.js`, hàm `message`)

Ưu tiên: có `error.sw` thì dùng `swMessage`; có trong bảng dưới thì dùng; `TypeError` / `AbortError` thì "Không thể kết nối. Vui lòng kiểm tra Card Agent và thử lại."; thông báo tiếng Việt (có dấu) thì hiện nguyên văn; còn lại "Không thể xử lý thẻ. Vui lòng kiểm tra Card Agent và thử lại."

| Mã | Thông báo |
|---|---|
| PIN_CANCELLED | Đã hủy nhập PIN. |
| WEAK_PIN | PIN mới quá yếu. |
| PIN_FORMAT | PIN phải gồm đúng 6 chữ số. |
| AUTH_REQUIRED | Vui lòng đăng nhập lại. |
| CARD_AUTH_INVALID | Không thể xác thực thẻ. Vui lòng kiểm tra thẻ và thử lại. |
| OP_FORBIDDEN | Bạn không có quyền thực hiện thao tác này. |
| OP_STATE | Thao tác đã hết hạn hoặc thay đổi. Vui lòng thử lại. |
| CARD_STATE | Thẻ hiện không cho phép thao tác. |
| REQUEST_TIMEOUT | Yêu cầu quá thời gian. Vui lòng kiểm tra kết nối. |
| CLIENT_STALE | Trang đã thay đổi. Vui lòng thử lại. |
| CLIENT_SUSPENDED | Trang đã tạm dừng. |
| CLIENT_DISPOSED | Trang đã đóng. |
| PIN_BUSY, PIN_MODAL_UNAVAILABLE, AGENT_HTTP, CARD_RESPONSE, SYNC_LOOP, SERVER_UNAVAILABLE, SERVER_HTTP | Không có bản dịch: rơi vào thông báo mặc định "Không thể xử lý thẻ. Vui lòng kiểm tra Card Agent và thử lại." |

### 2b. Trang admin (`card-admin.js`)

**Cập nhật:** trang admin nay **luôn hiển thị tiếng Việt**, không còn mã thô. `CardAdmin.errorMessage(error, fallback)` (xuất ra `window.CardAdmin`) chọn thông báo theo thứ tự: lỗi có `sw` dùng `swMessage`; câu tiếng Việt do server hoặc client đã gắn sẵn (ví dụ "Bạn không có quyền sử dụng tính năng này!") được giữ nguyên; nếu không thì tra bản đồ `ERROR_MESSAGES` dưới đây theo `errorCode`/`code`; `AbortError`: "Yêu cầu đã bị hủy hoặc quá thời gian. Hãy kiểm tra kết nối rồi thử lại."; `TypeError`: "Không thể kết nối. Hãy kiểm tra mạng và Card Agent rồi thử lại."; mã lạ: câu mặc định "Không thể hoàn tất thao tác thẻ. Hãy kiểm tra Card Agent, thẻ trong đầu đọc rồi thử lại." kèm mã trong ngoặc, ví dụ `(MA_LA)`. Server cũng đã truyền `errorCode` vào lỗi ném ra ở mọi form admin. Trang đăng nhập admin (`account.js`) có bản đồ dự phòng riêng, đã mở rộng tương tự.

Bản đồ `ERROR_MESSAGES` hiện tại (83 mã):

| Mã | Thông báo hiển thị |
|---|---|
| PIN_CANCELLED | Đã hủy nhập PIN; thao tác chưa được thực hiện. |
| PIN_BUSY | Đang có hộp nhập PIN khác mở. Hãy hoàn tất hoặc đóng hộp đó rồi thử lại. |
| PIN_FORMAT | PIN phải gồm đúng 6 chữ số. |
| PIN_MODAL_UNAVAILABLE | Không mở được hộp nhập PIN. Hãy tải lại trang rồi thử lại. |
| WEAK_PIN | PIN quá yếu (không dùng 6 số giống nhau, dãy số liên tiếp hoặc ngày sinh DDMMYY). Vui lòng nhập mã khác. |
| INVALID_PIN | PIN không hợp lệ. PIN phải gồm đúng 6 chữ số. |
| AUTH_REQUIRED | Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại. |
| CARD_AUTH_INVALID | Không thể xác thực thẻ. Hãy kiểm tra thẻ trong đầu đọc và thử lại. |
| OP_FORBIDDEN | Bạn không có quyền thực hiện thao tác này, hoặc thẻ đang cắm không phải thẻ của tài khoản hiện tại. |
| OP_STATE | Thao tác đã hết hạn hoặc đã thay đổi trạng thái. Hãy tải lại trang và thử lại. |
| OP_NOT_FOUND | Không tìm thấy thao tác thẻ này (có thể đã hết hạn). Hãy bắt đầu lại. |
| STEP_UP_REQUIRED | Cần xác thực lại bằng thẻ nhân viên của tài khoản hiện tại. |
| STAFF_CARD_REQUIRED | Tài khoản của bạn chưa có thẻ nhân viên đang hoạt động. Hãy phát hành thẻ nhân viên cho tài khoản này (Phát hành thẻ → Nhân viên) rồi đăng nhập lại bằng thẻ. |
| STAFF_CARD_CHANGED | Phiên đăng nhập gắn với thẻ nhân viên khác thẻ đang hoạt động (có thể thẻ đã được thay). Hãy đăng xuất và đăng nhập lại bằng thẻ nhân viên mới. |
| STAFF_CARD_MISMATCH | Thẻ đang cắm không phải thẻ nhân viên của phiên đăng nhập này. Hãy cắm đúng thẻ đã dùng để đăng nhập, hoặc đăng nhập lại bằng thẻ này. |
| RATE_LIMITED | Bạn thao tác quá nhanh. Hãy đợi giây lát rồi thử lại. |
| CARD_RELOGIN_REQUIRED | Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên. Vui lòng đăng nhập lại bằng mật khẩu và thẻ. |
| CARD_NOT_FOUND | Không tìm thấy thẻ này trên hệ thống. |
| CARD_STATE | Trạng thái thẻ hiện không cho phép thao tác này. |
| CURRENT_CARD | Đây không phải thẻ hiện hành của chủ thẻ. Hãy dùng thẻ mới nhất. |
| OWNER_STATE | Chủ thẻ hiện không ở trạng thái cho phép thao tác này. |
| INVALID_INPUT | Dữ liệu nhập không hợp lệ. Hãy kiểm tra lại các trường rồi thử lại. |
| INVALID_BODY | Dữ liệu gửi lên không hợp lệ. |
| INVALID_AMOUNT | Số tiền không hợp lệ. |
| INVALID_PHOTO | Ảnh không hợp lệ. Hãy chọn ảnh khác. |
| PHOTO_UPLOAD | Không tải được ảnh lên. Hãy chọn ảnh khác và thử lại. |
| PROFILE_TOO_LARGE | Hồ sơ quá lớn để ghi vào thẻ. Hãy rút gọn thông tin. |
| INVALID_PROFILE | Hồ sơ thẻ không hợp lệ. |
| INVALID_PROFILE_TLV | Hồ sơ trên thẻ bị lỗi định dạng. |
| INVALID_REPLACEMENT | Yêu cầu cấp lại thẻ không hợp lệ hoặc đã khác với yêu cầu trước đó. |
| INVALID_TARGET | Vùng dữ liệu thẻ không hợp lệ. |
| INVALID_CARD_TYPE | Loại thẻ không đúng. Hãy cắm đúng loại thẻ. |
| INVALID_OP_ID | Mã thao tác không hợp lệ. |
| INVALID_INIT | Dữ liệu khởi tạo thẻ không hợp lệ. |
| INVALID_PAYLOAD | Dữ liệu thao tác không hợp lệ. |
| INVALID_AUTH_PURPOSE | Mục đích xác thực không hợp lệ. |
| INVALID_ORDER_CODE | Mã đơn hàng không hợp lệ. |
| INVALID_DEPARTURE_DATE | Ngày khởi hành không hợp lệ. |
| INVALID_ESCROW_KEY | Khóa ký quỹ không hợp lệ. Hãy liên hệ quản trị. |
| INVALID_SERVER_KEY | Khóa máy chủ thẻ không hợp lệ. Hãy liên hệ quản trị. |
| CARD_SERVER_KEY_PATH_REQUIRED | Máy chủ chưa cấu hình khóa thẻ. Hãy liên hệ quản trị. |
| INVALID_APDU | Lệnh gửi thẻ không hợp lệ. |
| INVALID_APDU_DATA | Dữ liệu lệnh gửi thẻ không hợp lệ. |
| INVALID_APDU_HEADER | Tiêu đề lệnh gửi thẻ không hợp lệ. |
| INVALID_BYTE | Dữ liệu thẻ không hợp lệ. |
| INVALID_BYTES | Dữ liệu thẻ không hợp lệ. |
| INVALID_HEX | Dữ liệu thẻ không hợp lệ. |
| INVALID_HEX_LENGTH | Độ dài dữ liệu thẻ không hợp lệ. |
| INVALID_RANDOM_LENGTH | Độ dài dữ liệu ngẫu nhiên không hợp lệ. |
| INVALID_UINT32 | Dữ liệu thẻ không hợp lệ. |
| TARGET_LENGTH | Độ dài dữ liệu thẻ không hợp lệ. |
| TOPUP_LIMIT | Khoản nạp vượt hạn mức cho phép (tối đa 20.000.000 VNĐ mỗi lần và mỗi nhân viên mỗi ngày; số dư thẻ tối đa 50.000.000 VNĐ). |
| REQUEST_MISMATCH | Yêu cầu trùng mã nhưng khác nội dung. Hãy tải lại trang và tạo yêu cầu mới. |
| REQUEST_TIMEOUT | Yêu cầu quá thời gian. Hãy kiểm tra kết nối rồi thử lại; nếu đang thu tiền, hãy đối chiếu giao dịch, không thu lần nữa. |
| ISSUE_CLOSED | Yêu cầu phát hành đã đóng. Hãy bắt đầu phát hành mới. |
| ISSUE_EXPIRED | Yêu cầu phát hành đã hết hạn. Hãy bắt đầu phát hành mới. |
| ISSUE_INCOMPLETE | Phát hành chưa hoàn tất. Hãy kiểm tra trạng thái thẻ trước khi thử lại. |
| ISSUE_PREPARING | Yêu cầu phát hành đang được chuẩn bị. Vui lòng đợi giây lát rồi thử lại. |
| ISSUE_STARTED | Yêu cầu phát hành đã bắt đầu ghi thẻ. Hãy kiểm tra trạng thái thẻ trước khi thử lại. |
| REPLACEMENT_DEFERRED | Việc cấp lại thẻ đang chờ xử lý. Hãy hoàn tất từ thẻ nguồn. |
| REFUND_REQUIRED | Thẻ còn số dư; cần xác nhận đã hoàn tiền cho khách trước khi thu hồi. |
| RECONCILIATION_REQUIRED | Cần đối soát giao dịch trước khi tiếp tục. Không thu tiền lại. |
| SYNC_LOOP | Đồng bộ thẻ lặp quá nhiều lần. Hãy rút thẻ, cắm lại và thử lại. |
| CHECKIN | Không thể check-in cho vé này. |
| CHECKIN_WINDOW | Chưa đến hoặc đã quá thời gian check-in của tour này. |
| ITEM_NOT_FOUND | Không tìm thấy vé trong đơn hàng. |
| ORDER_STATE | Trạng thái đơn hàng không cho phép thao tác này. |
| TICKET_GONE | Vé không còn hiệu lực. |
| TICKET_NOT_WRITTEN | Vé chưa được ghi lên thẻ. Hãy để khách đăng nhập để đồng bộ trước. |
| TICKET_USED | Vé đã được sử dụng. |
| AGENT_HTTP | Card Agent chưa sẵn sàng hoặc khe đọc không có thẻ. |
| AGENT_RESPONSE | Card Agent trả về dữ liệu không hợp lệ. Hãy kiểm tra Card Agent. |
| AGENT_URL | Địa chỉ Card Agent không hợp lệ. |
| CARD_RESPONSE | Không đọc được thẻ. Hãy kiểm tra thẻ trong khe đọc. |
| SERVER_HTTP | Máy chủ từ chối yêu cầu. Hãy thử lại sau. |
| SERVER_REJECTED | Máy chủ từ chối thao tác thẻ. Hãy thử lại hoặc liên hệ quản trị. |
| SERVER_RESPONSE | Máy chủ trả về dữ liệu không hợp lệ. Hãy thử lại sau. |
| SERVER_UNAVAILABLE | Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại. |
| SERVER_URL | Địa chỉ máy chủ không hợp lệ. |
| CLIENT_STALE | Trang đã thay đổi. Hãy tải lại trang và thử lại. |
| CLIENT_SUSPENDED | Trang đã tạm dừng. Hãy tải lại trang và thử lại. |
| CLIENT_DISPOSED | Trang đã đóng. Hãy tải lại trang và thử lại. |
| INTERNAL | Máy chủ gặp lỗi nội bộ. Hãy thử lại sau. |

Các thông báo tiếng Việt chủ động khác của admin:

| Tình huống | Thông báo |
|---|---|
| Agent không phản hồi | Không kết nối được Card Agent |
| Hủy hộp PIN đăng nhập | Đã huỷ nhập PIN. |
| Hủy ở form trạng thái | Đã hủy xác thực; trạng thái chưa được gửi lại. |
| Cắm sai thẻ (đồng bộ) | Đang cắm thẻ khác. Hãy cắm đúng thẻ đang xem trước khi đồng bộ. |
| Cắm sai thẻ (Reset PIN) | Hãy cắm đúng thẻ đang hoạt động được xem trước khi reset PIN. |
| Cắm sai thẻ (ghi hồ sơ) | Hãy cắm đúng thẻ khách đang hoạt động. |
| Step-up: sai thẻ NV | Hãy cắm thẻ nhân viên đang hoạt động của tài khoản hiện tại để xác thực lại. |
| Step-up xong, cần làm lại | Đã xác thực nhân viên. Hãy cắm lại đúng thẻ đang xem rồi bấm lại thao tác; giữ nguyên yêu cầu tiền mặt cũ nếu có. |
| Step-up thất bại | Không thể xác thực thẻ nhân viên. |
| Huỷ confirm step-up | Đã hủy xác thực; giữ nguyên yêu cầu để đối chiếu. |

## 3. Mã lỗi server (`errorCode`)

Định dạng: `{ "code": "error", "errorCode": "...", "message": "..." }`. Riêng step-up: `{ "code": "step-up-required", "message": "..." }` (HTTP 403, không có `errorCode`). Hàm `problem` của admin chỉ trả `message` của lỗi khi có HTTP status, ngược lại: "Không thể xử lý yêu cầu thẻ.". API khách (`/card-api/*`) chỉ trả mã và message mặc định "Yêu cầu thẻ không hợp lệ hoặc không được phép." (trừ 429 và một số `userMessage`).

### 3a. API admin thẻ (`/admin/card/*`)

| errorCode | HTTP | Thông báo |
|---|---|---|
| AUTH_REQUIRED | 401 | Admin hiển thị "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." (chưa đăng nhập / JWT sai) |
| STAFF_CARD_REQUIRED | 403 | "Tài khoản của bạn chưa có thẻ nhân viên đang hoạt động. Hãy phát hành thẻ nhân viên cho tài khoản này (Phát hành thẻ → Nhân viên) rồi đăng nhập lại bằng thẻ." (step-up challenge khi tài khoản không có thẻ NV `active` hiện hành) |
| STAFF_CARD_CHANGED | 403 | "Phiên đăng nhập gắn với thẻ nhân viên cũ, không phải thẻ nhân viên đang hoạt động (có thể thẻ đã được thay). Hãy đăng xuất và đăng nhập lại bằng thẻ nhân viên mới." (token gắn `cardId` khác thẻ NV hiện hành) |
| STAFF_CARD_MISMATCH | 403 | "Thẻ đang cắm không phải thẻ nhân viên của phiên đăng nhập này. Hãy cắm đúng thẻ đã dùng để đăng nhập, hoặc đăng nhập lại bằng thẻ này." (`step-up/verify` với thẻ cắm khác `cardId` trong token) |
| CARD_RELOGIN_REQUIRED | 403 | "Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên. Vui lòng đăng nhập lại bằng mật khẩu và thẻ." (phiên chỉ có mật khẩu mà tài khoản đã bật `cardRequired`; XHR/JSON. Trang thường được chuyển về `/admin/account/login?notice=card-required` và xóa cookie) |
| OP_FORBIDDEN | 403 | Origin khác host, thẻ NV hoặc tài khoản không hợp lệ, thiếu `card-issue`. Admin hiển thị "Bạn không có quyền thực hiện thao tác này, hoặc thẻ đang cắm không phải thẻ của tài khoản hiện tại." (hoặc câu thiếu quyền của server); xem [92](92-han-che-va-xu-ly-su-co.md). Với trang GET thiếu quyền: "Bạn không có quyền sử dụng tính năng này!" |
| INVALID_INPUT | 400 / 415 | "Bộ lọc không hợp lệ." / "Ngày lọc không hợp lệ." / "Trang không hợp lệ." / "Mã thẻ không hợp lệ." / "Thông tin hồ sơ không hợp lệ." / "Thông tin trạng thái thẻ không hợp lệ; thu hồi cần có lý do." / "Cấp lại thẻ cần mã thẻ và lý do." / "Số tiền hoặc mã yêu cầu nạp không hợp lệ."; 415 khi không phải JSON |
| STEP_UP_REQUIRED (mã nội bộ; trả `code: step-up-required`) | 403 | "Hãy xác thực lại thẻ nhân viên trước khi cấp lại thẻ." (phát hành, cấp lại) / "...trước khi thực hiện thao tác." (reset PIN, nạp tiền mặt) / "...trước khi thu hồi." (thu hồi) |
| CARD_NOT_FOUND | 404 | "Không tìm thấy thẻ." |
| CARD_STATE | 409 | "Chỉ nạp tiền cho thẻ khách đang hoạt động." / "Chỉ reset PIN thẻ đang hoạt động." / "Chỉ sửa hồ sơ thẻ khách đang hoạt động." / "Không tìm thấy chủ thẻ hiện tại." / "Trạng thái thẻ đã thay đổi; hãy tải lại trang." / "Thẻ đã bị thu hồi." / "Không thể chuyển trạng thái thẻ này." / mặc định "Yêu cầu phát hành thẻ không hợp lệ hoặc đã kết thúc." |
| CURRENT_CARD | 409 | "Người này đã có thẻ đang hoạt động" |
| REPLACEMENT_DEFERRED | 409 | "Thẻ cũ còn tài sản hoặc yêu cầu cấp lại; hãy dùng Cấp lại từ thẻ nguồn." |
| ISSUE_PREPARING | 409 | "Yêu cầu đang chuẩn bị; hãy hủy yêu cầu trước khi thử lại." |
| ISSUE_EXPIRED, ISSUE_CLOSED, ISSUE_STARTED, ISSUE_INCOMPLETE, INVALID_INIT, INVALID_REPLACEMENT, OWNER_STATE | 409 | Mặc định "Yêu cầu phát hành thẻ không hợp lệ hoặc đã kết thúc." |
| REQUEST_MISMATCH | 409 | mặc định hoặc "Mã yêu cầu đã được dùng cho một khoản thu khác." (nạp tiền mặt) |
| INVALID_PHOTO | 400 | "Ảnh phải là JPEG hợp lệ và không quá 10 080 byte." |
| INVALID_PROFILE | 400 | "Hồ sơ vượt giới hạn 448 byte hoặc chứa trường không hợp lệ." |
| PHOTO_UPLOAD | 502 | "Không thể lưu ảnh; chưa phát hành thẻ." (phát hành); khi sửa hồ sơ: câu mặc định "Yêu cầu phát hành thẻ không hợp lệ hoặc đã kết thúc." |
| RECONCILIATION_REQUIRED | 409 | Cấp lại: "Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Không được cấp lại khi chưa xác nhận kết quả."; Thu hồi: "Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Hãy đồng bộ và xác nhận kết quả trước khi thu hồi; có thể khóa thẻ ngay." |
| REFUND_REQUIRED | 409 | "Thẻ còn số dư, hãy xác nhận đã hoàn tiền hoặc dùng Cấp lại thẻ" |
| TOPUP_LIMIT | 409 | "Số tiền nạp tiền mặt phải là số nguyên từ 10.000 đến 20.000.000 VNĐ mỗi lần." (400 `INVALID_INPUT`, mỗi lần tối đa 20.000.000) / "Số tiền nạp tối thiểu là 10.000 VNĐ." / "Vượt hạn mức tiền mặt 20.000.000 VNĐ mỗi nhân viên mỗi ngày." / "Số dư và tiền chờ nạp vượt hạn mức 50.000.000 VNĐ." / "Số tiền phải là số nguyên an toàn không âm." |
| OP_STATE | 409 | Admin hiển thị "Thao tác đã hết hạn hoặc đã thay đổi trạng thái. Hãy tải lại trang và thử lại." Lệnh hết hạn (5 phút) / đã đổi trạng thái; ở API khách: "Thao tác đã hết hạn hoặc thay đổi. Vui lòng thử lại." |
| OP_NOT_FOUND | 404 | Admin hiển thị "Không tìm thấy thao tác thẻ này (có thể đã hết hạn). Hãy bắt đầu lại." |
| INTERNAL | 500 | "Không thể xử lý yêu cầu thẻ." |

### 3b. API khách (`/card-api/*`)

| errorCode | HTTP | Ghi chú |
|---|---|---|
| INVALID_INPUT | 400 / 415 | Body sai schema / không phải JSON |
| AUTH_REQUIRED | 401 | Chưa đăng nhập khách ("Vui lòng đăng nhập lại." ở giao diện) |
| CARD_AUTH_INVALID | 401 | Chữ ký xác thực thẻ sai, thẻ bị khóa/thu hồi, counter bất thường (ghi `counter-anomaly`) |
| OP_FORBIDDEN | 403 | Origin khác host, op của người khác, thiếu quyền |
| OP_NOT_FOUND | 404 | Op không tồn tại |
| OP_STATE | 409 | Op hết hạn/đã đổi |
| CARD_STATE | 409 | Thẻ không cho phép thao tác |
| INVALID_PROFILE | 400 | Hồ sơ sai |
| RATE_LIMITED | 429 | "Thao tác đồng bộ thẻ quá nhanh, vui lòng thử lại sau." (60 lần/phút/cặp cardId+IP) |
| INSUFFICIENT_BALANCE | 409 | "Số dư ví không đủ" (thanh toán ví) |
| GATEWAY_UNAVAILABLE | 502 | "Không thể kết nối cổng thanh toán, vui lòng thử lại sau." |
| INTERNAL | 500 | Lỗi nội bộ |
| Mã `CardOpError` khác | 409 | Mặc định "Yêu cầu thẻ không hợp lệ hoặc không được phép." |

### 3c. Check-in (`/admin/card/checkin/*`, `card-checkin.controller.js`)

| errorCode | HTTP | Thông báo |
|---|---|---|
| FORBIDDEN | 403 | Bạn không có quyền sử dụng tính năng này! |
| INVALID_INPUT | 400 | Dữ liệu check-in không hợp lệ. |
| CARD_STATE, OWNER_STATE | 409 | Thẻ không hoạt động hoặc không phải thẻ khách hàng. |
| CHECKIN_WINDOW | 409 | Chưa tới hoặc đã qua ngày check-in |
| TICKET_USED | 409 | Vé đã sử dụng |
| TICKET_NOT_WRITTEN | 409 | Vé chưa được ghi lên thẻ, hãy đồng bộ trước |
| TICKET_GONE | 409 | Vé không còn hiệu lực trên thẻ. |
| ORDER_STATE | 409 | Đơn hàng chưa thanh toán, đã huỷ hoặc không thuộc chủ thẻ. |
| ITEM_NOT_FOUND | 404 | Không tìm thấy vé trong đơn hàng. |
| CHECKIN (mặc định) | tùy | Lỗi check-in chung |

### 3d. Trạng thái giao dịch

- `Tx.status`: `awaiting-payment`, `pending-card`, `sent`, `done`, `failed`.
- `failReason`: `expired`, `gateway`, `voided`, `moved`, `refunded`, `not-on-card`.
- `reconciliationReason`: `wallet-cap`, `card-unavailable`, `gateway-conflict`.
- `Card.status`: `issuing`, `active`, `locked`, `revoked`, `failed`.

## 4. HTTP của Card Agent (`127.0.0.1:31999`)

| Tình huống | Phản hồi |
|---|---|
| Host không phải `127.0.0.1:<port>` hoặc `localhost:<port>` | 403 `{"error":"host"}` |
| Origin không nằm trong `allowedOrigins` (ví dụ gọi từ `127.0.0.1:3002`) | 403 `{"error":"origin"}` |
| Không gửi Origin (curl) | Cho qua |
| `OPTIONS` (CORS preflight) | 204, kèm `Access-Control-Allow-Methods: GET, POST` |
| Sai phương thức (vd GET `/v1/transmit`) | 405 `{"error":"method"}` + header `Allow` |
| Không có thẻ trong slot | 503 `{"error":"no-card"}` |
| Request sai (JSON hỏng, slot ngoài 0..3, APDU sai định dạng) | 400 `{"error":"bad-request"}` |
| Đường dẫn lạ; `/v1/sim/*` khi không ở chế độ `--sim` | 404 `{"error":"not-found"}` |
| Lỗi nội bộ | 500 `{"error":"internal"}` |
| `GET /v1/status`, `POST /v1/transmit`, `POST /v1/sim/slot`, `POST /v1/sim/reset` | 200 |
| Quá 64 APDU mỗi lần transmit | Client từ chối; lô dừng ở SW khác 9000 đầu tiên |

Trình duyệt hiển thị "Không kết nối được Card Agent" (admin) hoặc "Không thể kết nối. Vui lòng kiểm tra Card Agent và thử lại." (khách) khi lỗi mạng/HTTP từ Agent.

## 5. Bảng tra nhanh theo triệu chứng

| Thấy gì | Xem |
|---|---|
| "Sai mã PIN, còn N lần thử" / "PIN đã bị khoá" | [15](15-sai-pin-khoa-pin-reset-pin.md) |
| 403 `{"error":"origin"}` | [92](92-han-che-va-xu-ly-su-co.md) mục Agent |
| Admin: "Tài khoản của bạn chưa có thẻ nhân viên đang hoạt động..." / "Phiên đăng nhập gắn với thẻ nhân viên cũ..." / "Thẻ đang cắm không phải thẻ nhân viên của phiên đăng nhập này..." / "Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên..." | [92](92-han-che-va-xu-ly-su-co.md) (mục thẻ NV và script khôi phục) |
| Hủy đơn ví: "Đơn có vé đã check-in, không thể huỷ và hoàn tiền tự động..." và các câu hoàn tiền khác | [11](11-huy-don-xoa-ve.md) |
| "Chưa xác nhận thanh toán..." | [16](16-dong-bo-doi-soat-bien-nhan.md) |
| RATE_LIMITED | [16](16-dong-bo-doi-soat-bien-nhan.md) |
| OTP lỗi/giới hạn | [12](12-khach-bao-mat-the-otp.md) |
