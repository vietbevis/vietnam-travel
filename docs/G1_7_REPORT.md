# Báo cáo G1.7 · Vietnam Travel

**Mốc nghiệm thu 26/11/2026.** Nhánh `feature/smartcard`, HEAD `2fcc368`, có sẵn hai commit cục bộ chưa push và cây làm việc G1.6 đang chỉnh sửa. Bản G1.7 nằm trong cùng cây làm việc. Thay đổi đã có được giữ. Không commit, push, deploy hoặc chạy migration Role. Các lần ghi dữ liệu kiểm thử dùng Mongo/Agent fixture và mock gateway. Dừng ở G1.7 để chủ dự án nghiệm thu.

## 27 hạng mục

`FIXED_TESTED` chỉ áp dụng cho hành vi đã kiểm trong cột bằng chứng. `PARTIAL` còn nhánh nghiệm thu hoặc điều kiện vận hành. `ACCEPTED_AS_IS` giữ quyết định của chủ dự án. Các ca tay G1.6 là đầu vào, không được tính lại thành kết quả G1.7.

| ID | Mức | Nguyên nhân / xử lý | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| 001 | P2 | Category GET chọn phản hồi text, Dashboard render layout. Hợp nhất trang từ chối, trang đích qua `/admin/start`, giữ 403 JSON và guard. `permission.middleware.js`, `category.route.js`, `no-permission.pug`. | Baseline và Chromium sau sửa, Viewer paste URL, JSON 403, sidebar chỉ hiện quyền được cấp. Mongo Role hồi quy. | FIXED_TESTED |
| 002 | P2 | Avatar rỗng hoặc URL không tải được. Mixin avatar dùng chữ cái từ tên có sẵn, preview có thông báo và thử lại. Ảnh đối chiếu chân dung chip giữ nguồn riêng. | Admin Chromium trên hồ sơ, danh sách và ảnh 404 với fixture. | FIXED_TESTED |
| 003 | P1 | FilePond tải ảnh đã lưu theo luồng file upload. Render ảnh đã lưu bằng trình duyệt, FilePond chỉ nhận file mới. | Chromium với FilePond 4.32.7 và fixture mock. Lưu ảnh Profile, reload, thay mới và lưu giữ khi không upload. | FIXED_TESTED |
| 004 | P2 | Form buộc sửa chức vụ khi hồ sơ legacy để trống. PATCH chỉ gửi trường chỉnh sửa, giữ validation các trường nghiệp vụ và dữ liệu khác. | Đổi Role với chức vụ trống và giữ tên, HTTP/Mongo account settings. | FIXED_TESTED |
| 005 | P2 | Checkbox quyền ngoài phạm vi còn tương tác được. Render quyền có thể cấp, khóa quyền ngoài phạm vi, giữ quyền có sẵn và guard subset backend. | Chromium Role giới hạn, Mongo mapping/overgrant và đổi quyền hợp lệ. | FIXED_TESTED |
| 006 | P2 | Tự đổi Role bị guard, còn form không phản hồi. Pug dùng local tên `self` còn gây 500 do trùng tùy chọn compile. Đổi tên local, hiện lý do và giữ guard tự sửa, admin cuối, session version. | Chromium trang Role của mình, kiểm Role-only, suite rollback và quyền Admin. | FIXED_TESTED |
| 007 | P0 | `parseInt` cắt `1.000.000` ở dấu chấm. Parser nghiêm ngặt VND nguyên dùng ở form và validator trước upload/lưu. Giá mới trống dùng giá gốc, zero giữ nguyên. | RED ghi 1/nhận dữ liệu lỗi. GREEN Node, HTTP/Mongo lưu 1.000.000, Client detail, checkout và VNPay mock gửi đúng số tiền quy đổi theo API. Rà nguồn giá ví từ đơn server. | FIXED_TESTED |
| 008 | P2 | Các trường tiền nhập theo kiểu number và xử lý khác nhau. Dùng `vnd-money.js` cho sáu giá tour, nạp quầy, nạp online. Hoàn tiền lấy số đã xác thực từ debit, chỉ hiển thị giá trị. | Chromium gõ/paste và chèn/xóa ở giữa, VND trống và 0, trường numeric ở 360 px; Node parse rác/âm/overflow; browser tiền tour/online/cash. | FIXED_TESTED |
| 009 | P1 | Ảnh cũ đi qua đường FilePond đọc blob và edit không phân biệt giữ/xóa. Preview riêng, danh sách thứ tự có revision, bù xóa chỉ asset mới với lỗi chắc chắn. | Chromium ảnh đa nguồn, giữ/thêm/xóa và reload. Unit mô phỏng lỗi upload một phần, tranh chấp revision và kết quả DB chưa rõ. HTTP từ chối MIME/signature sai và >5 MB. | FIXED_TESTED |
| 010 | P1 | Tour edit phụ thuộc Tiny Cloud và FilePond, lỗi Promise không có phản hồi đầy đủ. Form xử lý trạng thái gửi, chỉ ghi trường thay đổi, dùng revision ảnh, phản hồi lỗi tại form. | Chromium đổi tên, tải lại và ảnh giữ nguyên; dữ liệu Mongo và checkout HTTP; test tranh chấp tồn. | FIXED_TESTED |
| 011 | P1 | Tiny Cloud bị giới hạn domain trong nghiệm thu. Editor local dùng công cụ soạn thảo của trình duyệt và HTML allowlist theo sanitizer. Hỗ trợ định dạng, bảng, link, ảnh. | Chromium lưu/mở lại định dạng khi chặn CDN, suite sanitizer. Thao tác editor trên Firefox/Safari chưa kiểm. | FIXED_TESTED |
| 012 | P1 | Delete list và bulk trash gửi PATCH ngay. SweetAlert2 xác nhận riêng xóa mềm, vĩnh viễn và số bản ghi; khóa trong lúc xử lý; giữ guard trash, tham chiếu và khôi phục. Ẩn CTA liên hệ/tài khoản/Role chưa có route. | Chromium xác nhận xóa hẳn gọi đúng một PATCH, hủy không gọi API. Mongo trash gồm bulk all-or-nothing, tour có đơn xóa mềm và danh mục không hợp lệ. | FIXED_TESTED |
| 013 | P1 | Account layout thiếu wrapper thông báo, lỗi OTP không hiện. Phản hồi inline chung cho sai/hết hạn/đã dùng/quota, có đường gửi lại; giữ reset-only. | Chromium lỗi và gửi lại; fixture HTTP mã sai/đúng/replay, cookie reset-only HttpOnly; Mongo thời hạn, quota và tài khoản có/không thẻ. | FIXED_TESTED |
| 014 | P2 | Express fallback `Cannot GET` khi Client không có route. Thêm Client 404 trong layout và dùng cho slug không thấy; bỏ qua API/asset theo loại đường dẫn. | Chromium 404 cả hai site, HTTP status đúng; Admin trở về trang hợp lệ. | FIXED_TESTED |
| 015 | P2 | Loop bật với ít slide và nạp asset lỗi làm dừng script. Tính số slide theo breakpoint rộng nhất, rewind khi ít, bỏ bản sao banner; fallback cuộn cục bộ. | Chromium nạp Swiper 11 thật, 0/1/2/3/5 slide, resize trong ma trận, không có Loop Warning. | FIXED_TESTED |
| 016 | P1 | Flex header kết hợp logo, nav và phần thẻ không co vừa ở 360 px. Ưu tiên nút thao tác, logo co, menu và bảng cuộn trong vùng riêng. | Trước 398 px ở 360, sau 360. Chromium 46 đường dẫn/trạng thái × 6 độ rộng, không tràn trang. Samsung A55 thật chưa chạy. | FIXED_TESTED |
| 017 | P2 | CTA Điền từ thẻ ở ngoài scope biến CSS. Cấp biến cho nút, thêm icon, giữ đúng form và cơ chế signed read. | CSS/DOM và hồi quy autofill; cần xác nhận touch nếu demo bằng máy thật. | FIXED_TESTED |
| 018 | P2 | Mỗi danh mục là một item ngang. Menu `Danh mục tour` dùng danh sách có cuộn, giữ thứ tự và cấp con, đóng bằng Escape/click ngoài. | 12 danh mục thật ở sáu độ rộng. Bài kiểm DOM Chromium thêm dữ liệu 0/1/12/30 mục và tên dài. | FIXED_TESTED |
| 019 | P1 | Modal PIN nằm ngoài CSS variables của `.card-account`. Phạm vi biến và CSS nút bao modal, giữ PIN 6 số và xử lý lỗi. | Chromium kiểm màu hai nút, giao tiếp PIN thật với jCardSim theo luồng thẻ; unit keyboard/cancel/weak PIN. | FIXED_TESTED |
| 020 | P2 | Hộp thoại native và các nhánh fetch không thống nhất. Wrapper SweetAlert2 dùng chung, inline khi CDN lỗi và giữ fail-closed khi cần xác nhận. Request helper kiểm status, JSON, timeout. | Rà callsite JS/Pug, Chromium xác nhận/hủy, Node form và card ops. Ca mất phản hồi theo từng nguồn ở các mục nghiệp vụ. | FIXED_TESTED |
| 021 | P1 | Cookie Strict không đi theo điều hướng cross-site từ gateway, topup đi thẳng vào trang cần phiên. Landing topup/booking và mục tiêu login cố định, ownership kiểm lại. | Chromium hai gateway/mock topup và booking, cookie Strict, cùng phiên; Mongo callback, ownership, settlement và phiên khác. | FIXED_TESTED |
| 022 | P1 | Tạo đơn giữ kho trước khi kiểm khả năng trả, chỉ báo ở trang thanh toán. Kiểm giá/giảm/số dư và giữ chỗ trong transaction có cùng write lock. Thời hạn đơn ví mới 20 phút, kiểm khi ký; debit chưa có kết quả giữ chỗ. | RED tạo đơn dù thiếu/sai cạnh tranh. Mongo khi thiếu/vừa đủ/cạnh tranh/clock expiry/lost receipt; browser và Mongo đúng số dư chip. | FIXED_TESTED |
| 023 | P2 | Landing sơ sài. Card rõ hành động theo mục tiêu, trạng thái công khai chỉ nói đã quay lại. Trạng thái thanh toán do server xác minh ở tài nguyên có quyền. | Chromium VNPay/ZaloPay qua mock, ảnh return mobile ở log Card. | FIXED_TESTED |
| 024 | P1 | Client chưa có hành động đồng bộ đầy đủ. Bảng tiền/vé/pending theo thẻ hiện hành. Dùng planner/engine có receipt và phạm vi khách hàng. | Chromium + jCardSim kiểm nạp, hoàn, ghi/xóa vé, nhầm slot, so Mongo–chip và rớt confirm sau credit. Ca chuyển thẻ giữa các lô hoặc hết dung lượng ở cùng chuỗi browser cần nghiệm thu riêng. | FIXED_TESTED |
| 025 | P2 | Quét chọn vé đầu tiên và gắn `used` với chữ thiếu vé. Thêm thống kê/tìm kiếm/chọn từng vé và so mã đơn, tour, ngày, số khách. Vé có lệnh đã ký chưa xác nhận được giữ để đối soát. | Browser chọn vé và chặn hủy đã dùng. RED/green unit ngày/pax/key trùng, Mongo 28 ca check-in/refund gồm chưa rõ kết quả. Sau reload nếu mất kết quả chip, hệ thống chặn hủy và chờ nhân viên đối soát. | PARTIAL |
| 026 | P1 | Trang resume có bước freshness trả JSON. GET HTML trình bày yêu cầu, xác thực trước bằng thẻ nhân viên cùng phiên, rồi đổi thẻ trắng. | HTTP Mongo cho expired step-up, logic resume `finish`, cấp đúng người. Chromium nhầm slot và sau đó cấp lại cùng tiền/vé. Chưa có browser một chuỗi đợi step-up hết hạn thật trước khi resume. | PARTIAL |
| 027 | Kiểm invariant | Giữ lịch sử Client theo thẻ hiện hành đã được chấp nhận. Giao dịch nguồn `transfer` có nhãn riêng; số dư và vé đi qua giao dịch chuyển thẻ, điều kiện giữ nguyên vé dùng/hủy. | Mongo replacement, dashboard-card và refund sau thay thẻ. Audit thẻ cũ giữ lại. | ACCEPTED_AS_IS |

**N03 · Console hiện có.** Agent trả 409 khi một lô APDU đang thực thi. Người thao tác đợi cả hai tab hoàn tất giao dịch trước khi đổi. Dùng `http://[::1]:3304/` để tách hostname cookie khỏi trang fixture `127.0.0.1`. Agent 32033 mặc định, 31999 chọn qua `--demo`. UI chỉ có trạng thái và chuyển slot. Sau nghiệm thu G1.9, yêu cầu khóa giữa các lô APDU và phần biên nhận check-in để tự đối soát của 025 có trạng thái **REMOVED_BY_OWNER**. [Quyết định G1.9](G1_9_REPORT.md#yêu-cầu-đã-rút)

## Inventory Admin và Client

Ma trận Chromium dùng route Express thật với Pug, DB có seed và các trạng thái HTTP thật. Sáu độ rộng là 320/360/390/768/1024/1440 px. Với các route theo ID, kiểm một bản ghi fixture theo quyền phù hợp. `.superpowers/g17/site-browser-verified.log` có đường dẫn theo từng lần tải và kết quả. Ảnh chụp theo nhóm lỗi được giữ trong thư mục log. Form thao tác bảo mật có hồi quy riêng.

| Trang hoặc route | Trước → sau | Bằng chứng |
|---|---|---|
| Admin `/`, `/start`, header, sidebar, logout | Chuyển trang theo quyền giữ nguyên. Bỏ badge thông báo giả, menu mobile có trạng thái và Escape. | Viewer về danh mục, Chromium header; hồi quy Admin session/logout. |
| `/dashboard`, `POST /dashboard/revenue-chart` | Dữ liệu tổng và biểu đồ thật giữ nguyên. Bỏ dòng đơn mẫu, thêm đường dẫn danh sách theo quyền. Có phản hồi khi chart chưa tải. | Chromium Chart.js, chặn theo quyền, dashboard Mongo. |
| `/category/list`, `/create`, `/edit/:id` | Giữ lọc/tìm/reset/paging đã nghiệm thu, đồng bộ 403 và xác nhận xóa. | Chromium ba trang, Viewer, suite Admin Category. |
| `/tour/list`, `/create`, `/edit/:id`, `/trash` | Bỏ filter/bulk giả chưa có backend, thay số trang giả bằng đếm thật. Form sửa tiền/ảnh/editor; xác nhận soft/hard/bulk. | Chromium và Mongo giá, form, trash, Cloudinary mock. |
| `/order/list`, `/edit/:id` | Giữ filter hiện hữu. Form khả dụng khi offline thư viện validate, xác nhận hủy/hoàn, báo vé đang chờ đối soát. | Chromium sáu kích thước, test giao dịch Mongo cùng stock và receipt. |
| `/user/list`, `/contact/list` | Ảnh và trạng thái khách, empty state, liên hệ phân trang dữ liệu thật. Điều khiển xóa liên hệ chưa có API được rút khỏi màn hình. | Chromium sáu kích thước và role denial. |
| `/setting/list`, `/website-info` | Giữ hiển thị theo quyền và cấu hình logo/tên. Form ảnh dùng chung preview và lỗi nhất quán. | Chromium sáu kích thước, Node/Mongo website settings; chưa ghi cấu hình demo. |
| `/setting/account-admin/list`, `/create`, `/edit/:id` | Dữ liệu trang thật, avatar fallback, giải thích guard tự sửa, Role-only không ép chức vụ. | Chromium render và PATCH, Mongo session/last admin. |
| `/setting/role/list`, `/create`, `/edit/:id` | Guard visible/disabled, không có 500 từ Pug self, phân trang và permission thật. | Chromium role giới hạn và role của chính mình, test subset/mapping. |
| `/profile/edit`, `/change-password` | Preview ảnh và fallback, đổi mật khẩu qua form local. | Chromium render/save ảnh, hồi quy profile/change password. |
| `/account/login`, `/register`, `/register-initial`, `/forgot-password`, `/otp-password`, `/reset-password` (Admin) | Form account có phản hồi được khi CDN không đến, OTP có hướng dẫn, chế độ reset-only giữ nguyên. | Chromium sáu kích thước, OTP trên browser/HTTP/Mongo, unit PIN/auth. |
| `/card/list`, `/detail/:cardId` (Admin) | Giữ paging 20 của danh sách thẻ. Chi tiết phân nhóm ví, vé và đối soát, dùng nhãn số dư khả dụng/số dư ghi nhận. | Chromium danh sách, integration chi tiết và RBAC, browser Smart Card khi có thẻ fixture. |
| `/card/issue`, `/issue?replaceOf=…`, `/card/checkin`, `/card/log` (Admin) | Resume có UI, check-in chọn vé, nhật ký không render JSON thô. Log lọc người/thao tác/kết quả/ngày và paging mặc định 10. | Chromium render, Mongo signed ops/RBAC/filter/dữ liệu thật; các bước live fixture theo mục kiểm thử. |
| Admin 403/404 và invalid ID/API | 403/404 HTML theo layout, JSON giữ theo content negotiation. Route API được kiểm theo nhóm nghiệp vụ. | Chromium và HTTP/mongo guard. |
| Client `/`, header, footer, newsletter | Header gom danh mục. Footer dùng logo/cấu hình, bỏ link trỏ `#` không có route. Gợi ý từ tour thật; bỏ số promo và bài mẫu không có chức năng. | Chromium 12 mục, responsive, menu bằng phím, Swiper 11, before/after. |
| `/category/:slug`, `/search`, `/tour/detail/:slug` | Danh sách có empty state, nội dung HTML qua sanitizer, tour/danh mục không tìm thấy dùng 404. | Chromium dữ liệu có/rỗng và viewport. Lọc nâng cao G2–G6 giữ theo kế hoạch. |
| `/cart`, `POST /cart/detail`, `/order/checkout-session`, `/order/create`, `/order/checkout-status` | Checkout nút thao tác có thông báo, giỏ có xác nhận bỏ tour, bỏ coupon chưa có nghiệp vụ và thông tin chuyển khoản minh họa. Giữ cơ chế đối chiếu intent. | Chromium render, suite guest/member, ca mất phản hồi trong mục test. |
| `/order/payment-{vnpay,zalopay,card}`, `/order/processing`, `/order/success`, gateway callbacks | Bảo vệ ownership, đường về chuyển tiếp và thông báo trạng thái. | Chromium 2 gateway, Mongo callback/owner/idempotency và ví. |
| `/account/login`, `/account/card`, `/account/card/return`, `/account/card-lock` (Client) | Thành viên giữ card, nhóm dữ liệu server/chip, vé và pending. Luồng báo mất và OTP giữ guard. | Chromium guest/member, Agent thật + jCardSim; hồi quy customer auth/OTP. |
| Client 404, modal PIN và API thẻ | Layout trang lỗi, focus và màu nút PIN, giữ endpoint và quyền theo luồng. | Chromium 404/PIN, Node/Mongo card client/sync/api. |

G2–G7 bao gồm filter/bulk chưa có nghiệp vụ của Tour/Admin, thống kê mới, xóa liên hệ và lịch sử tổng hợp. Các mục này được kiểm kê và giữ phạm vi theo roadmap. Ca chưa có ảnh/mutation riêng gồm PC/SC, giao diện Safari/Firefox, thẻ vật lý, gateway/SMTP/Cloudinary thật, role mapping và môi trường demo thật.

## Kết quả kiểm thử

Baseline G1.7 chạy trước sửa trên cây làm việc G1.6. Node 229/229, Mongo 356/356, Java 266 Applet + 30 Agent, Pug 61/61. Ảnh baseline ghi nhận 403 dạng text và overflow 398 px trên viewport 360, 2272 px trên viewport 1024. [Kết quả mốc G1.6](PROJECT_TEST_REPORT.md#hồi-quy-g16)

| Suite | Lệnh và phạm vi | Kết quả cuối | Log |
|---|---|---|---|
| Node | `$env:AGENT_URL='http://127.0.0.1:32034'; npm.cmd test` với Agent jCardSim riêng cho test | 244 PASS, 0 FAIL, 0 SKIP | `.superpowers/g17/node-verified.log` |
| Mongo | `node .superpowers/phase1/run-integration.cjs` chạy `npm.cmd run test:integration` tuần tự, replica set riêng 27018 và DB `vietnam-travel-smartcard-test` | 363 PASS, 0 FAIL, 0 SKIP | `.superpowers/g17/mongo-verified.log` |
| Java | Gradle 9.7 offline `:applet:test :agent:test --rerun-tasks`, đọc lại JUnit XML | 266 Applet + 31 Agent PASS, 0 FAIL, 0 SKIP | `.superpowers/g17-simulator/java-green.log` |
| **Bốn suite** | Node, Mongo, Applet, Agent | **904 PASS, 0 FAIL, 0 SKIP** · +23 so với baseline | Các log phía trên |
| Pug | Node gọi `pug.compileFile` cho tất cả file dưới `views` | 65/65 compile | `.superpowers/g17/pug-final.log` |
| HTTP + Chromium | `node .superpowers/g17/site-browser.cjs --reuse-fixture` sau lượt xác nhận xóa | 46 đường dẫn/trạng thái, 276 phép kiểm viewport, 0 lỗi liên quan. Chart.js, SweetAlert2 11.26.25, Swiper 11.2.10 nạp từ file CDN đã tải vào thư mục fixture. | `.superpowers/g17/site-browser-verified.log` |
| Browser Admin và HTTP | Tour, profile/ảnh, Role, OTP và FilePond thật từ cache, gọi HTTP bằng fixture | PASS theo nhóm trên các log. 4 ảnh form/Role/OTP, kiểm ảnh sai/chữ ký/dung lượng, giá và quy đổi VNPay | `.superpowers/g17-admin/{browser-final,http-final,filepond}.log` |
| Browser khách và UI | `node .superpowers/g17/guest-and-ui.cjs`, `node .superpowers/g17/vnd-and-fallback.cjs` | PASS mất phản hồi sau khi Mongo commit, kiểm lại cùng đơn, 1 lần trừ kho, chặn browser khác. PASS VND/caret/paste, fallback khi thiếu SweetAlert, audit có log và card detail ở 6 độ rộng | `.superpowers/g17/{guest-and-ui,vnd-and-fallback}.log` |
| Browser thẻ | Fixture `a60251f9cbb8ab05`, Chromium, Mongo, Agent và jCardSim. Gateway/mail/Cloudinary mock | 17 mốc PASS. Có phát hành Admin/khách, PIN, cash, online, debit, hai gateway, pending sync, check-in, hoàn trước/sau cấp lại, khóa/mở, reset PIN, thu hồi và audit. So số dư/counter Mongo–chip. | `.superpowers/g17-card/browser-a60251.log` |
| Browser khôi phục credit | Ngắt HTTP confirm sau khi Agent đã ghi chip | PASS số dư/counter server chưa đổi khi mất confirm, tải receipt lần sau, xác nhận đúng một lần | `.superpowers/g17-card/browser-recovery.log` |
| N03 browser | Đứng riêng và ba tab cùng fixture | PASS 0→1→2→3→0, hủy, reload, không mất card state, Agent offline/restart, PC/SC read-only và 6 độ rộng | `.superpowers/g17-simulator/{browser,three-tabs}.log` |

Browser thẻ dùng giao diện cho phát hành, đăng nhập, PIN, thanh toán ví, quay lại cổng, chọn vé, đồng bộ và cấp lại. Các thao tác quản trị cash/hủy đơn/khóa/reset PIN/thu hồi và tạo checkout trong cùng kịch bản dùng request HTTP đã xác thực từ Chromium. Gọi checkout qua nút giỏ và lost response được kiểm riêng ở browser guest. Các điểm RED/green nằm ở `.superpowers/g17-admin` (giá/form), `.superpowers/g17-card` (giữ chỗ và resume), `.superpowers/g17/checkin-*.log` (khóa vé, refund) và `.superpowers/g17-simulator` (Agent busy). Phép kiểm 403, 404 và xóa qua browser diễn ra với dữ liệu fixture. Đối chiếu cấu hình carousel với [tài liệu API của Swiper](https://swiperjs.com/swiper-api).

Một lượt trung gian có 9 lỗi Node ở fixture VM login và mock step-up. Lượt đó dùng chung Agent 32033 với fixture browser, nên trạng thái slot của lượt browser đang thử được loại khỏi bằng chứng cuối. Node cuối dùng Agent riêng 32034. Chromium Smart Card bắt đầu lại trên fixture mới và hoàn tất chuỗi 17 mốc. Lượt Mongo đầu có 3 lỗi test render do Pug xuất thuộc tính marker hai lần trong HTML và test đọc nhãn tiếng Anh cũ. Đã sửa handler/mixin và cập nhật fixture/assertion theo nhãn và guard mới, giữ các kỳ vọng nghiệp vụ. Log lượt giữa được giữ ở `node-final.log`, `mongo-final.log`. Số test mới gồm parser/ảnh tour, check-in/refund, ví/return/sync/replacement, Console HTTP và Agent busy. Các hàm test cũ thay shape fixture cho trường mới, không hạ điều kiện kiểm quyền hoặc số dư.

Các kiểm thử browser chạy Chromium headless trên website, Mongo replica set và Agent jCardSim, mock gateway/mail/ảnh. Kiểm tra Java agent riêng không dùng dữ liệu thẻ fixture browser. Log nằm dưới `.superpowers/g17`, `.superpowers/g17-admin`, `.superpowers/g17-card` và `.superpowers/g17-simulator`, được Git bỏ qua.

## Tệp và quyết định

| Cụm | Tệp và mục đích |
|---|---|
| Admin form | `validates/admin/tour.validate.js`, `controllers/admin/{tour,account,profile,setting}.controller.js`, `middlewares/admin/image-upload.middleware.js`, `helpers/cloudinary.helper.js`, JS/CSS form và các trang Pug tương ứng. Tiền, ảnh, rich text, Role và OTP. |
| Layout toàn site | `routes/{admin,client}/index.route.js`, guard quyền, layout/partial/mixin/view Admin/Client, `public/assets/js/{script,ui-notice,vnd-money}.js`, CSS Client/Admin. Menu, bảng, trạng thái, thông báo và CTA. |
| Tiền, checkout, bàn giao thẻ | `controllers/client/{order,account,card-api}.controller.js`, route Client, `helpers/{card-op,wallet-hold,order-stock}.helper.js`, `models/order.model.js`, `index.js`, `controllers/admin/{order,card}.controller.js`. Giao dịch, thời hạn giữ chỗ, return, sync và cấp lại. |
| Vé và audit | `controllers/admin/card-checkin.controller.js`, `helpers/card-presentation.helper.js`, `public/admin/assets/js/card-admin.js`, Pug nhật ký/chi tiết/check-in. Khóa vé theo dữ liệu thật, thông tin đối soát có phạm vi. |
| Console | `scripts/simulator-console.cjs`, `scripts/simulator-console/`, Agent Java, test Node và JUnit. Công cụ độc lập và guard busy. |
| Kiểm thử và tài liệu | `test/g17-*.test.js`, `test/simulator-console.test.js`, regression liên quan và docs kế hoạch/tracker/audit/guide. |

Danh sách trạng thái toàn worktree và số dòng theo tệp được ghi ở `.superpowers/g17/final-status.log` và `.superpowers/g17/final-diff-stat.log`. Baseline tương ứng nằm ở `baseline-status.log`, `baseline-diff-stat.log`. Tệp G1.6 chưa track cũng có mặt trong danh sách.

Worktree ban đầu có 91 mục thay đổi. Worktree bàn giao gồm 129 tệp theo dõi đã sửa, 1 tệp theo dõi đã bỏ (cấu hình Tiny Cloud cũ) và 45 tệp chưa track. Các con số gồm cả công việc G1.6 có sẵn.

- Editor local dùng lệnh editing của trình duyệt và sanitizer phía máy chủ. Tiny Cloud key được loại khỏi luồng form. Asset CDN còn dùng cho carousel, màu sắc/icon, chart và SweetAlert2. Nếu SweetAlert2 không tải được, UI báo lỗi và chặn thao tác cần xác nhận.
- Khoản giữ chỗ 20 phút chỉ áp dụng đơn ví mới. Khoản đã ký chờ receipt được giữ tới khi có kết quả; kiểm thử chạy theo clock fixture. Các đơn legacy giữ điều kiện hiện có.
- Bù xóa media áp dụng cho upload tour mới có public ID xác minh được và lỗi chắc chắn. Nếu DB hoặc nhà cung cấp mất phản hồi, kiểm dữ liệu trước khi retry. Live Cloudinary, sandbox thật và hành vi bù xóa khi nhà cung cấp offline chưa nghiệm thu.
- Check-in hiển thị một vé/lần. Khóa chip hiện có dùng mã đơn và tour; ngày/số khách được so với chip trước khi cho chọn. Trường hợp kết quả đã ký bị mất và không còn được xác thực phải đi qua đối soát, không tự hoàn hoặc cấp lại.
- Lịch sử Client giữ theo thẻ mới. Dashboard giữ phạm vi chỉ số đã có và test source transfer không tính thành doanh thu nạp ví.
- Dữ liệu giá demo cũ chưa được quét trong lượt G1.7. Báo cáo ghi nhận lỗi parser và bằng chứng fixture. Không suy đoán tour nào đã bị lưu sai giá.

**Đề xuất trạng thái G1.7** Chờ chủ dự án nghiệm thu theo [hướng dẫn retest](MANUAL_TEST_GUIDE.md#g17--nghiệm-thu-lại). Giữ trạng thái các nhóm chưa có bằng chứng hoặc còn giới hạn vận hành. Chưa duyệt G2.
