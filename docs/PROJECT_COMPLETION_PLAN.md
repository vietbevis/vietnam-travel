# Kế hoạch hoàn thiện — Vietnam Travel

**G1 đã nghiệm thu · Checkpoint `6902f24` · G2 và G2.1 đã nghiệm thu · 28/11/2026**

Chủ dự án đã xác nhận chốt G1, gồm 6/6 nhóm G1.8, 4/4 nhóm G1.9 và phần checkbox. Đã triển khai G2 trên checkpoint local với quyền và policy hiện hành. Chủ dự án xác nhận manual PASS 6/6 nhóm G2 và 2/2 nhóm G2.1. [Tracker](PROJECT_FEATURE_TRACKER.md) · [Báo cáo G2](G2_REPORT.md)

## Checkpoint Giai đoạn 1

| Lát | Trạng thái | File, kiểm thử, quyết định và việc tiếp theo |
|---|---|---|
| G1.1 | Đã nghiệm thu trong phạm vi G1 | `routes/admin`, `routes/client`, `middlewares/http-route.middleware.js`, `middlewares/admin/permission.middleware.js`. Guard trước upload, trang đích theo quyền, 401 JSON, lỗi Express, UI-04/05/07. Mapping trên dữ liệu thật chờ duyệt. |
| G1.2 | Đã nghiệm thu trong phạm vi G1 | `profile.controller.js`, `setting.controller.js`, `admin-token.helper.js`, `image-upload.middleware.js`, `tour-rich-text.helper.js`. Chỉ sửa trường được phép, thu hồi phiên sau đổi quyền/thông tin xác thực, kiểm nhóm quyền và quản trị viên cuối. Thêm một dependency parse5 được khóa phiên bản. Chưa kiểm Cloudinary thật. |
| G1.3 | Đã nghiệm thu trong phạm vi G1 | `controllers/{admin/tour,client/order}.controller.js`, `public/assets/js/script.js`. DTO checkout, kiểm ngày/điểm xuất phát, điều kiện xóa/restore cùng guard tại thời điểm ghi. G1.6 bổ sung sở hữu guest và chống tạo đơn lặp. |
| G1.4 | Đã nghiệm thu trong phạm vi G1 | `admin-otp.helper.js`, `account.controller.js`, `auth.middleware.js`, `scripts/admin-card-recover.js`. Giới hạn OTP, hash mới, reset-only, JWT phiên bản và transaction audit. Giữ `--force` hiện có. |
| G1.5 | Đã nghiệm thu trong phạm vi G1 | `admin-pagination.helper.js`, `list-pagination.pug`, `category.controller.js`, Admin JS. Áp dụng cho danh mục và giữ các trang còn lại cho G2–G5. |
| G1.6 | Đã nghiệm thu trong phạm vi G1 | Kiểm kê Role chỉ đọc, ánh xạ và rollback trên fixture, guest cookie, checkout intent 24 giờ, tra đơn khi mất phản hồi. Có script khởi động/dừng fixture riêng và regression mới. |

G5 sẽ triển khai thông báo Admin N01. G6 sẽ triển khai lịch sử đơn của khách đã xác thực bằng thẻ N02. Console N03 đã được nghiệm thu ở phạm vi hiện có. N04 giữ nghiệp vụ đối soát hiện tại, mọi quy trình ngoại lệ mới chờ duyệt riêng.

Mốc đã duyệt G1.1–G1.5 giữ 869 PASS. G1.6 có kết quả theo suite riêng và hướng dẫn khởi động fixture. Chủ dự án đã xác nhận chốt G1. Giữ mốc ưu tiên các kịch bản Smart Card cho buổi báo cáo 05/12/2026. [Báo cáo G1.6](PROJECT_TEST_REPORT.md#hồi-quy-g16) · [Hướng dẫn nghiệm thu](MANUAL_TEST_GUIDE.md#g16--môi-trường-nghiệm-thu-riêng)

### Ma trận đã duyệt và ánh xạ Role

| Tiền tố hoặc route | Xem | Ghi hoặc thao tác riêng |
|---|---|---|
| Dashboard và biểu đồ | `dashboard-view` | Biểu đồ chỉ đọc qua POST, cùng quyền |
| Danh mục | `category-view` | `category-create`, `category-edit`, `category-delete`, bulk theo thao tác |
| Tour | `tour-view`, form tạo/sửa theo quyền thao tác | `tour-create`, `tour-edit`, `tour-delete`, trash/restore/hard delete `tour-trash` |
| Đơn | `order-view` | `order-edit`, `order-delete`; quyền nghiệp vụ thẻ/receipt vẫn giữ |
| Profile | Phiên Admin hợp lệ, phạm vi hồ sơ bản thân | Đổi mật khẩu cần xác nhận mật khẩu hiện tại |
| Card, khách, step-up | Quyền card hiện hữu, danh sách khách `card-view` hoặc `card-issue` tạm giữ | Quyền theo từng thao tác, thẻ/chủ/step-up theo policy hiện tại |
| Liên hệ | `contact-view` | Xóa liên hệ vào G5 và cần quyền riêng |
| Website | `website-view` | `website-edit` |
| Tài khoản | `account-admin-view` | `account-admin-create`, `account-admin-edit` |
| Role | `role-view` | `role-create`, `role-edit`, giới hạn quyền gán theo người thao tác |
| Upload ảnh nội dung | — | `tour-create` hoặc `tour-edit` cho TinyMCE, upload Avatar/cấu hình theo quyền của form |

Kiểm kê chỉ đọc thấy 6 Role đang hoạt động và một quản trị viên đủ điều kiện cấu hình với quyền qua fallback. Chế độ strict hiện có 0 quản trị viên đủ quyền tường minh. Sau phê duyệt riêng, lưu bản chụp Role, cấp quyền mới theo bảng, xác nhận quản trị viên thật và các vai trò giới hạn, thử `ADMIN_LEGACY_PERMISSION_FALLBACK=0`, rồi mới bỏ code fallback. Quy trình rollback và tiêu chí dừng đã thử trên fixture. [Bản đồ Role](G1_6_ROLE_MAPPING.md)

### Guest access và idempotency

- **Quyền xem và bắt đầu thanh toán.** Guest đặt tour với cookie host-only HttpOnly, SameSite Lax và Secure trên HTTPS, hết hạn sau 30 ngày. Hash của nonce được gắn vào đơn. Thành viên dùng `customerId` từ phiên thẻ. URL chỉ mang ID và dấu quay về gateway. `DOMAIN_WEBSITE` cần trùng origin đã dùng đặt tour. Trang trung gian cho phiên thẻ Strict chỉ hiển thị nút mở đơn. Callback ký xác minh định danh, tiền và trạng thái độc lập với cookie.
- **Tiếp tục đơn.** Trong cùng trình duyệt, nút **Kiểm tra đơn** khôi phục kết quả theo intent sau khi mất phản hồi. Đơn guest vẫn thuộc phiên guest ban đầu. Mở lại sau đăng nhập cần quay về phiên guest trên chính trình duyệt đó. Khôi phục khác trình duyệt và liên kết dùng một lần được hoãn tới khi có kênh liên hệ xác minh. Đơn guest lịch sử thiếu bằng chứng bị chặn.
- **Chống tạo đơn lặp.** Retry dùng cùng intent trong 24 giờ. Cùng nội dung chuẩn hóa trả đơn đã tạo, khác nội dung trả HTTP 409. Unique index theo scope và intent, ghi cùng đơn và tồn kho trong transaction. Kiểm index trước rollout. Hết hạn ngăn ghi mới, giữ bằng chứng chống lặp và tồn kho hiện có. **Bắt đầu đơn mới** dùng intent khác. [Checkout](../controllers/client/order.controller.js) · [Mô hình đơn](../models/order.model.js)

## Thứ tự và mốc 05/12/2026

1. Làm G1 trước các thay đổi Admin/Client, ưu tiên quyền, dữ liệu và checkout. Tách các P0 thành lát nhỏ để kiểm tra khác biệt và review.
2. Chạy hồi quy Smart Card với mã nguồn hiện tại song song với việc chuẩn bị nghiệm thu. Sau các guard liên quan của G1, ưu tiên lát demo G4 gồm SC-DEMO 01–07, login/step-up, hủy hoàn ví và check-in trước ngày báo cáo 05/12/2026. Các lát đó vốn đã có nghiệp vụ, cần bằng chứng sản phẩm và sửa lỗi có căn cứ.
3. Tiếp tục G2 và G3 khi guard và dữ liệu đã rõ. Branch công việc Dashboard có thể chuẩn bị fixture thu/hoàn trước khi duyệt policy doanh thu. Những việc còn lại của G4, G5, G6 và G7 thực hiện theo phụ thuộc bên dưới.

Đề xuất ưu tiên demo theo hạn người dùng cung cấp. Thay đổi ở G4 tránh phụ thuộc vào hoàn thiện toàn bộ Dashboard, CRUD hoặc phần đề xuất thông báo/lịch sử.

## G1 · Bảo mật và nền tảng dùng chung

| Công việc | Phạm vi và tái sử dụng | Trình tự và nghiệm thu |
|---|---|---|
| G1.1 Guard backend và lỗi Express | `routes/admin`, `middlewares/admin/auth.middleware.js`, `config/permission.js`, `index.js`. Từ guard/async wrapper ở `routes/admin/category.route.js`, giữ policy `admin-token` và các nhánh signed operation. | Lập ma trận route/permission theo vai trò và scope. Thêm fixture guest, role giới hạn, role đủ quyền. Đặt guard trước upload/ghi DB, kiểm status HTML/JSON, lỗi I/O và không đổi hành vi callback cổng. Chốt quyền mới và kế hoạch map Role cũ trước cấp quyền. |
| G1.2 Hồ sơ, role, tài khoản và upload | `controllers/admin/{profile,setting,upload,tour}.controller.js`, validator, multer, rich-text. Tái dùng allowlist `accountFormData`, verifier token hiện tại và validator từng luồng. | Chỉ ghi trường thuộc nghiệp vụ. Bảo vệ admin cuối và chống vượt quyền. Đổi mật khẩu có điều kiện xác thực, đối chiếu hành vi phiên. Upload chọn format/giới hạn và thứ tự kiểm tra, nội dung HTML giữ các thẻ hợp lệ. Kiểm dữ liệu được phép, field dư, file lỗi, lỗi provider và failure sau một phần thao tác. |
| G1.3 Bảo vệ dữ liệu và checkout | Permanent delete/restore tour, `createPost`, success và gateway entry. Giữ transaction và giá/tồn kho lấy từ DB; tách shape đưa vào Order khỏi schema đọc item cũ. | Chốt quan hệ được bảo toàn kể cả đơn xóa mềm và vé lịch sử. Chốt access proof cho guest và ownership cho khách. Kiểm rollback đặt nhiều tour, DB failure, lịch sử tour không còn hiển thị và trạng thái vòng đời chỉ khởi tạo từ server. |
| G1.4 Phiên, OTP và recovery CLI | `helpers/admin-token.helper.js`, admin OTP, `scripts/admin-card-recover.js`, môi trường. Dùng pattern hỗ trợ session/transaction ở card-op và customer OTP. | Kiểm tra cookie HTTPS/local, CSRF phù hợp từng entry, rate limit, redaction và thu hồi phiên. Ghi CLI recovery và audit trong transaction, recheck card/account, chốt cách vô hiệu phiên và cấp lại khi current card còn tồn tại. Test dry run, từ chối, audit fail, thao tác đồng thời và phục hồi quyền bằng thẻ. |
| G1.5 Thành phần danh sách | `category.list`, `category-list.pug`, `public/admin/assets/js/script.js`. Dùng chuẩn `.section-4/5/6/7`, `.table-2`, badge hiện có. | Dùng whitelist kích cỡ 5/10/20/50/100, mặc định 10 trừ ngoại lệ có lý do, thứ tự ổn định với tie-breaker, clamp sau đếm, giữ URL khi paginate và đưa về trang 1 khi đổi lọc. Dùng lại component khi có từ hai caller, giữ no-JS fallback bằng GET ở trang cần. |
| G1.6 Ownership, idempotency và Role | Guest và thành viên, checkout với 24 giờ retry, thanh toán, ánh xạ quyền tường minh. | Regression và Chromium fixture đã chạy, nghiệm thu thủ công chờ chủ dự án. Trình kế hoạch mapping demo riêng nếu cần. |

**Điều kiện nghiệm thu G1** Chủ dự án xác nhận các ca tay G1-A01–A07, G1-C01, G1-UI và các ca guest/idempotency trên fixture. Thay đổi dữ liệu demo, rollout Role và các chính sách lưu giữ dữ liệu cần duyệt riêng.

### G1.7 · Sửa sau nghiệm thu G1.6

| Cụm | Thiết kế và thứ tự | Điểm kiểm chứng |
|---|---|---|
| A · Baseline | Giữ cây làm việc trên HEAD `2fcc368`. Dùng launcher replica set tách riêng, Agent jCardSim và gateway mock. | Lưu trạng thái Git, chạy Node, Mongo, Java, Pug và chụp các lỗi giao diện quan sát được. |
| B · Tiền, dữ liệu và quyền | Chuẩn hóa VND trước upload/lưu. Dùng giá từ server, giữ chỗ ví có thời hạn và chỉ hoàn chỗ khi có kết quả an toàn. Giữ guard Role, OTP, receipt và quyền sở hữu. Lưu ảnh cũ một cách tường minh, dùng trình soạn thảo local đi qua sanitizer. | Kiểm đơn thiếu tiền/đồng thời/mất receipt, hết hạn giữ chỗ, giá Mongo, form và preview trên browser, OTP sai và Role giới hạn. |
| C · Toàn bộ Admin và Client | Giữ Pug, branding, CSS và helper hiện có. Rà từng route, gom danh mục vào menu có thể cuộn, dùng paging từ dữ liệu thực và cùng cách xác nhận thao tác. Giữ check-in một vé theo khóa chip. | Render route qua HTTP, Chromium ở sáu kích thước, xác nhận xóa, quyền, trang lỗi, nhật ký và modal PIN. |
| D · N03 | Console riêng trên loopback. Chỉ đọc trạng thái và chuyển slot qua endpoint cố định. Agent khóa chuyển slot trong một lô APDU. | Test offline/PCSC/slot sai/Origin/Host, vòng 0–3, reload và ba tab. Nghiệm thu thao tác đổi slot giữa các giao dịch đã kết thúc. |
| E · Bàn giao | Đối chiếu 27 lỗi, browser, hồi quy và bằng chứng của chủ dự án. | [Báo cáo G1.7](G1_7_REPORT.md) và [hướng dẫn nghiệm thu lại](MANUAL_TEST_GUIDE.md#g17--nghiệm-thu-lại). |

Giữ thời hạn 24 giờ của checkout intent. Với đơn ví mới, thời hạn giữ chỗ là 20 phút từ khi tạo đơn và được kiểm tra lại ở bước chuẩn bị, ký lệnh và giải phóng chỗ. Lệnh debit đang chờ biên nhận giữ chỗ để đối soát. Quy tắc này không đổi thời hạn của đơn guest, tiền mặt hoặc gateway. Chủ dự án nghiệm thu G1.7 trước khi duyệt mốc tiếp theo.

### G1.8 · Sửa sau nghiệm thu G1.7

| Cụm | Phạm vi và phụ thuộc | Điểm kiểm chứng |
|---|---|---|
| Đơn và ví | Sửa listener và method form, giữ policy hủy, hoàn kho, credit và receipt. Giỏ tự tìm lần đặt cũ theo cùng scope/intent. | Click modal và nút Cập nhật trong Chromium. Đối chiếu kho, đơn, Mongo, chip và phiên khác. |
| Ảnh và mô tả | Giữ FilePond và bố cục form. Ảnh lưu đọc theo URL và xóa bằng hành động tường minh có đối chiếu ảnh hiện tại. Khôi phục TinyMCE và sanitizer. | Preview sáu viewport, lưu lại album, thử lỗi tải. Test editor có cấu hình và ô HTML khi thiếu cấu hình. |
| Hồ sơ, vé và Console | Hồ sơ khách ghi phần liên hệ trên chip qua PIN, phần địa chỉ/ảnh web qua phiên thẻ. Check-in xử lý từng vé bằng engine hiện có. Console tiếp tục dùng trạng thái Agent. | So Mongo/chip, trạng thái chưa rõ sau mất confirm, reset thông tin cá nhân, tab độc lập và nhật ký. |

Chủ dự án đã xác nhận 6/6 nhóm G1.8 trong luồng thường. Bằng chứng của đợt trước nằm trong [báo cáo G1.8](G1_8_REPORT.md).

### G1.9 · Kết quả nghiệm thu và chuẩn bị chốt G1

- Chủ dự án xác nhận 4/4 nhóm G1.9. Lượt chuẩn bị chốt G1 rà kích thước, căn lề và thao tác checkbox trên Admin/Client.
- **REMOVED_BY_OWNER** áp dụng cho biên nhận check-in có chữ ký để tự đối soát và khóa chuyển slot giữa các lô APDU của N03. Hai yêu cầu rời phạm vi triển khai và không chuyển sang G4. Các guard check-in, khóa theo lô và Console hiện có được giữ.
- Khách tự sửa thông tin định danh và đổi email thuộc **G4.6**. Chủ dự án xác nhận chốt G1 và duyệt triển khai G2. [Báo cáo G1.9](G1_9_REPORT.md) · [Hướng dẫn rà checkbox](MANUAL_TEST_GUIDE.md#rà-checkbox-trước-khi-chốt-g1)

## G2 · Quản lý dữ liệu Admin

**G2 đã được chủ dự án nghiệm thu 6/6 nhóm trước bản sửa.** Chủ dự án đã nghiệm thu 2/2 bản sửa cuối UI-G2-001 và FUNC-G2-001. G2.3 giữ ẩn đơn lẻ theo policy G1 và bulk khôi phục. [Báo cáo](G2_REPORT.md#g21--hai-thay-đổi-cuối) · [Hướng dẫn](MANUAL_TEST_GUIDE.md#g21--nghiệm-thu-hai-thay-đổi-cuối)

| Phạm vi | Xem thùng rác | Quyền thao tác thùng rác |
|---|---|---|
| Danh mục | category-trash | Khôi phục cần category-trash và category-edit. Xóa vĩnh viễn cần category-trash và category-delete. |
| Tour | tour-trash | Khôi phục và xóa hẳn đủ điều kiện dùng tour-trash theo policy G1. |
| Đơn hàng | order-trash | Khôi phục cần order-trash và order-edit. Bản ghi phục hồi chỉ đọc trong Admin và giữ chốt deleted cho nghiệp vụ. |

- **G2.1 Danh mục.** Khôi phục kiểm tổ tiên và tập đã xác minh. Xóa vĩnh viễn chỉ áp dụng cho danh mục trong trash khi không còn con hoặc tour tham chiếu. Kiểm cả bản ghi đã xóa mềm trong cùng transaction và khóa cây. Bulk chỉ ghi khi toàn bộ tập đủ điều kiện.
- **UI-G2-001.** Bỏ bộ đếm chung. Giữ checkbox 18 × 18 px, chọn một phần, chọn tất cả trên trang và bulk có xác nhận.
- **G2.2 Tour.** Giữ form Pug, City, danh mục, lịch trình và album. Nối bộ lọc, bulk và trash đến dữ liệu thật. Chốt form về giá giảm và ngày khởi hành, validate số tiền/tồn/vị trí và field quan hệ. Tách xóa mềm, khôi phục và xóa hẳn. Kiểm tour đã có đơn/đã xóa mềm, race đặt tour và lịch sử snapshot.
- **Backlog chuyển từ BUG-G17-006.** Tìm kiếm, lọc theo trạng thái/danh mục/người tạo/ngày, reset, page size 5/10/20/50/100 và bulk có quyền/xác nhận. Dùng lại mẫu danh mục. Kiểm giá demo cũ bằng lượt chỉ đọc riêng để xác minh ảnh hưởng parser lịch sử.
- **G2.3 Đơn.** Dùng query/filter backend hiện có, chuyển mẫu UI theo danh mục và giữ nút xác nhận cho bulk hoặc hủy/hoàn. Bổ sung log thay đổi nếu được duyệt, giữ CAS hủy/hoàn và cardTxRef. Trash restore phục hồi bản ghi, giữ trạng thái nghiệp vụ đã hủy và không tái trừ kho hoặc cấp vé. Chạy lại `order-card-refund`, `order-payment`, `card-pay`, `ticket-checkin`.

**Gate G2** Chủ dự án đã nghiệm thu 6/6 nhóm G2 và 2/2 nhóm G2.1, cho phép checkpoint local và triển khai G3.

## G3 · Dashboard và quản lý khách hàng

- **G3.1 Chỉ số.** Chốt metric dictionary với chủ dự án. Ghi thời điểm settlement tin cậy cho giao dịch mới trong cùng transaction. Lịch sử có bằng chứng đáng tin cậy mới đưa vào bucket theo tháng. Hiển thị nhóm thiếu mốc cho phần dữ liệu còn lại. Truy vấn aggregate theo ngày VN từ server, dùng Cash/Wallet ledger theo nguồn, giữ riêng nạp ví/chi tiêu/hoàn/đối soát. Dùng helper `monthBoundsVN` và dữ liệu Order, Tx, Card, Customer. Kiểm tháng 28/29/30/31 ngày, tháng rỗng, chuyển năm, unpaid, cancel, refund pending/done, hỏng callback và nhận tiền hai lần.
- **G3.2 Khách.** Giữ layout/badge của `user-list.pug`, dùng `tier.helper`, chỉ tải người trong trang và thẻ hiện hành liên quan. Bổ sung scope quyền khách, nhãn ngày tham gia, hạng, chi tiêu, tab lịch sử có phân trang ở chi tiết. Test tên/điện thoại, khách không/thẻ cũ/thẻ khóa/thẻ hiện hành và đúng giới hạn dữ liệu hiển thị.

**Gate G3** Biểu đồ và số liệu đối chiếu fixture nghiệp vụ thay vì tổng giả. Số dư ví và chi tiêu chỉ xuất phát từ các luồng được phép. Quyền dashboard và chart được test riêng.

## G4 · Smart Card

| Lát | Tái sử dụng và thứ tự | Kiểm thử/điều kiện chấp nhận |
|---|---|---|
| G4.1 Luồng demo cơ bản | Bắt đầu từ tài liệu 01–05, 15, 21–22. Giữ CSS, sidebar, modal, `CardClient`, applet, công cụ kiểm PIN hiện có và bảng `ERROR_MESSAGES`. | SC-DEMO 01–07 trên browser + Agent + jCardSim test. Ghi trước/sau bằng mã trạng thái và đối chiếu số liệu đã che thông tin nhạy cảm. |
| G4.2 Phát hành và Auth | Chuẩn hóa riêng field văn bản, giữ validation dữ liệu nhị phân/chữ ký. Tận dụng `issuePrepare/Finish/Cancel`, JWT pre-auth, step-up và policy per operation. | Lỗi từng trường, slot cũ/trống, mất kết nối từng bước, sai thẻ nhân viên và tự phát hành buộc đăng nhập lại. Kiểm chọn đúng slot trên Console hiện có. |
| G4.3 Ví, hoàn tiền và đối soát | Giữ `card-op`, `card-sync`, unique refund, receipt và transaction. Hoàn thiện nhãn quyền hạn và trạng thái chuỗi hoàn sau cấp lại. Đồng bộ Client/Admin với `wallet-rule`. | Giá trị nhận/ghi chip, reconciliation và cap held được trình bày rõ. Test đồng thời, mất confirm, cap, cấp lại, chống hoàn/trừ hai lần, callback già và audit rollback. Sandbox ngoài luồng mock riêng. |
| G4.4 Vé và check-in | Dùng `ticket.helper`, `card-checkin`, template và thống kê hiện tại. Nối thêm lọc theo chuyến/ngày/mã đơn/khách. | Một vé có thể đại diện nhiều khách. Kiểm đúng thẻ/đơn/ngày, lặp, vé hủy hoặc chưa trả, check-in song song hủy. |
| G4.5 Danh sách/chi tiết/nhật ký | Tái dùng list G1, `card-badge.pug`, `card-admin.css`, template của `da858a9`. Giữ hai trục status server/PIN. | Status VIP/khóa/PIN chưa xác định hiện đúng dữ liệu, chi tiết log read-only, không render bí mật, tổng và trang đúng. |
| G4.6 Khách tự sửa định danh và đổi email · BUG-G17-003 / MEM-04 | Mở rộng hồ sơ khách đang có theo chính sách PIN khi đổi ngày sinh, ghi định danh đúng thẻ và xác minh email mới qua OTP. Duyệt quy trình khi mất quyền truy cập email cũ và bảo toàn khóa thẻ mất. | Kiểm hai tab, phiên/thẻ cũ, mất kết quả ghi, UTF-8/giới hạn byte, email chuẩn hóa duy nhất, OTP sai/hết hạn/dùng lại và báo mất sau đổi email. [Điều kiện kỹ thuật G4](G1_9_REPORT.md#hồ-sơ-định-danh-và-email-chuyển-sang-g4) |

**Gate G4** Java/Agent, unit Node và integration đều có log; QA browser theo các kịch bản Smart Card. Việc kiểm thẻ PC/SC, email thật, sandbox và demo hiện hữu được ghi riêng khi có xác nhận.

## G5 · Admin còn lại

- Nối bộ lọc/page và case duplicate cho liên hệ. Chốt xóa riêng/bulk và retention trước khi nối nút xóa.
- Làm việc theo G1 cho website settings, account/role/profile và Auth. Giữ thuộc tính giao diện đã hoạt động. Kiểm ảnh CDN với mock trước, cập nhật cấu hình thấy ở Client và Admin, không vô hiệu quản trị viên cuối hoặc bỏ qua `cardRequired`.
- Kiểm nav, tab, focus và 404/403 trên desktop/mobile. Triển khai N01 theo quyền người nhận cho các sự kiện đã duyệt, gồm unread, đọc, đánh dấu tất cả và chống trùng.

## G6 · Client

- Thống nhất Home/Category/Search/Detail với rule hiển thị tổ tiên active, ngày/giá/số lượng hợp lệ. Nối trạng thái rỗng, lỗi và trang thật. Giữ Pug, CSS, product mixin.
- Rà giỏ, tăng/giảm/xóa, autofill, gửi đơn lỗi/retry và điều hướng sau success. Giữ giỏ khi lỗi có thể phục hồi, xác minh trình duyệt sau khi loại nạp lặp script, kiểm từ trang chi tiết đến cổng bằng fixture/mock.
- Triển khai N02 cho khách đăng nhập bằng thẻ để xem đơn, thanh toán, hoàn tiền và vé thuộc sở hữu. Tái sử dụng scope ownership G1.6. Khôi phục guest ở thiết bị khác chỉ tiếp tục sau khi có kênh liên hệ xác minh.

## G7 · Nghiệm thu toàn hệ thống

Chạy `npm.cmd test` với Agent test riêng, `npm.cmd run test:integration` với Mongo test guard, `gradlew.bat :applet:test :agent:test`, và ma trận browser theo kích thước màn hình, keyboard, console, quyền và lỗi mạng. Dùng hướng dẫn [Admin/Client](MANUAL_TEST_GUIDE.md) và [27 tài liệu Smart Card](huong-dan-test-the/README.md). Dùng fixture cho cạnh tranh, lỗi DB và retry. Chốt bằng chứng thủ công với chủ dự án. Mỗi giai đoạn cập nhật báo cáo, log/test, tracker và vị trí code. Giữ nhãn chuẩn V3, quy tắc không tăng DONE với UI hoặc test sai lớp.

## Quyết định nghiệp vụ cần duyệt

- Định nghĩa doanh thu, mốc ghi nhận, kỳ hạch toán refund/cash refund, cách hiển thị dữ liệu cũ thiếu ngày thanh toán và nguồn số liệu.
- Ghi Role thật theo ma trận đã duyệt, lịch xác nhận quản trị viên có quyền tường minh và tắt fallback.
- Trải nghiệm xóa hẳn và khôi phục G2, hạn giữ đơn chưa thanh toán, quy trình xác minh để phục hồi guest ở trình duyệt khác.
- Chính sách khôi phục Admin, nhận dạng người chạy, xử lý thẻ hiện hành, audit và vòng đời phiên; cách xử lý giao dịch đối soát và thông báo.

Nếu cần migration, trước khi thao tác dữ liệu thật lập backup và kiểm restore trên bản sao, kiểm index/duplicate, đề xuất rollout tương thích dữ liệu cũ và rollback. Việc ghi DB thật hoặc chạy recovery script cần phê duyệt riêng theo V3.
