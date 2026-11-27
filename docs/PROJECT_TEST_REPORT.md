# Báo cáo kiểm thử baseline — Vietnam Travel

Kết quả mới và bằng chứng trước/sau nằm trong [báo cáo kiểm thử G1.7](G1_7_REPORT.md#kết-quả-kiểm-thử). Các số G0, G1.1–G1.5 và G1.6 bên dưới là kết quả theo từng mốc.

**Giai đoạn 0 · 25/11/2026 · HEAD `2fcc3684b32478d5efe2c22682d452b7c3db253c`**

## Kết quả chạy mới trên HEAD

| Bộ kiểm tra | Kết quả | Phạm vi |
|---|---|---|
| `npm.cmd test`, Agent riêng ở loopback 32013 | **214 PASS · 0 FAIL · 0 SKIP** | 206 test Node gồm unit, schema, auth/UI logic và fixture render. 8 test HTTP Agent với jCardSim thật cho giao thức, PIN, ví, vé, receipt và hồ sơ. |
| `npm.cmd run test:integration` | **336 PASS · 0 FAIL · 0 SKIP** | MongoDB 8.3 replica set mới trên loopback 27018, `vietnam-travel-smartcard-test`. Các file chạy tuần tự. Có HTTP/permission, DB, transaction, đồng thời và provider mocks. |
| Java Applet · `:applet:test` | **266 PASS · 0 FAIL · 0 SKIP** | Gradle 9.7.0 offline, build lại source Applet với JDK 17 target release 8. JUnit 5.11.4 dùng jCardSim 3.0.5.11 từ cache. |
| Java Card Agent · `:agent:test` | **30 PASS · 0 FAIL · 0 SKIP** | Gradle 9.7.0 offline, build lại Agent/test target release 17. HTTP server loopback, config, codec, simulator và PC/SC test doubles. |
| Pug `compileFile` | **60/60 PASS** | 46 page và 14 layout/partial/mixin. Kiểm cú pháp/biên dịch. |
| HTTP smoke web · route thật + Mongo fixture | **43/43 render PASS · 1 lỗi status tái hiện** | 33 đường dẫn Admin, 10 Client. Đăng nhập mật khẩu qua route thật, cookie khách được cấp bằng fixture cho các ca render. Guest bị chuyển login Admin, snapshot khách trả 401. Catch-all Admin render đúng nội dung 404 với HTTP 200. |
| Chromium + Playwright · fixture | **3 nhóm PASS · 2 lỗi UI tái hiện** | Client menu mobile 390px, danh mục filter/search/reset, sidebar thẻ 6 đường dẫn ở 1280px. Fixture Pug/JS thật, CDN bị chặn trong harness, không chạy DB nghiệp vụ qua browser. |

Kết quả của lượt Node không có Agent trên HEAD là 206 PASS, 8 SKIP. Lượt có Agent trong bảng thay thế kết quả tổng hợp này. Checkpoint trước đó trên bản sao `d3ebf52` ghi 336 Mongo integration PASS và 206 Node PASS/8 SKIP. Số liệu đó là đối chiếu lịch sử. HEAD tuy chỉ đổi định dạng ở ba schema và hai file đổi xuống dòng, vẫn được chạy lại auth/schema và toàn bộ hai suite. Các test Java và Node qua Agent cũng chạy từ mã nguồn HEAD. Phiên chạy dùng dependency có sẵn, JDK 17.0.21 và Node v25.9.0.

## Kiểm chứng theo nhóm

| Nhóm | Bằng chứng | Giới hạn |
|---|---|---|
| Hủy đơn ví, hoàn tiền | **17/17 PASS** trong `order-card-refund`. Bao gồm hủy đồng thời, unique index, hoàn kho một lần, giảm chi tiêu và đổi vé, thẻ nhận sau cấp lại, chặn thẻ không active, debit thiếu receipt, ngoại lệ phương thức khác, cap held, rollback audit, chặn vé check-in, kiểm credit gắn đúng đơn. | Integration dùng receipt ký bằng fixture để xác nhận Node/Mongo. Agent E2E riêng xác minh credit/debit receipt trên chip giả lập. Chuỗi đầy đủ hủy/hoàn đến browser + chip vẫn **NOT_RUN**. [Suite](../test/integration/order-card-refund.test.js) |
| Đặt đơn, payment và check-in | Suite Mongo gồm stock concurrent, rollback, idempotency, cập nhật order/khách/vé, kiểm quyền check-in, ca trùng và vé đã dùng. | Callback fixture/mocks. Cổng sandbox thật và tiếp nhận tiền thật **NOT_RUN**. [Order payment](../test/integration/order-payment.test.js) · [Card pay](../test/integration/card-pay.test.js) · [Check-in](../test/integration/ticket-checkin.test.js) |
| Auth, PIN và phát hành | Unit/HTTP integration gồm stale password session, preToken/step-up, lỗi tiếng Việt, issue và recovery quyết định. Applet/Agent E2E gồm tạo thẻ, đổi PIN, proof, lock/unlock, ghi hồ sơ và reset PIN. JUnit Pin/PinGuard kiểm sai và hết lượt. | Bộ SC-DEMO 01–07 qua website + Mongo + chip trên cùng phiên browser vẫn **NOT_RUN**. SMTP/Cloudinary là mock trong ca có gọi các dịch vụ đó. [Admin UX](../test/card-admin-ux.test.js) · [Admin auth](../test/integration/admin-auth.test.js) · [Agent E2E](../test/card-e2e.test.js) |
| Danh mục · TEST 09 | **14/14 PASS** trong `admin-category`. Chromium fixture xác minh bộ lọc trạng thái, tìm và reset URL. | A/B được người dùng công nhận lịch sử. Group C nghiệm thu tay và browser luồng ghi đầy đủ **NOT_RUN**. [Admin category](../test/integration/admin-category.test.js) |
| Sidebar và quyền hiển thị | **PASS** một active item ở list, detail, issue, issue cấp lại, check-in và log ở Chromium fixture. **FAIL · UI-05** vai trò fixture chỉ có `card-view` vẫn thấy CTA Phát hành thẻ, trong khi sidebar ẩn. | Ở các path ngoài list, dùng cùng phần render fixture để kiểm rule sidebar. Chưa chạy đầy đủ các form thao tác thẻ qua browser. |
| Console Client | **FAIL · UI-04** Chromium báo lỗi khai báo lặp trên login thẻ sau khi tải script hai lần. **PASS** thao tác mở menu mobile ở fixture đó. | Trạng thái CDN và console của toàn bộ trang trên mạng thật **NOT_RUN**. |
| Bảo mật phòng thủ | Đối chiếu quan hệ route → middleware → handler → schema cho SEC-01–10. Có guard chống reset nhầm DB, kiểm quyền ở suite riêng cho danh mục, đơn ví, check-in và Card API. | Các lỗ hổng được xác nhận qua đường dẫn và điều kiện trong mã nguồn. Hậu quả runtime và thao tác ghi nguy hiểm chưa được tái hiện. Recovery runbook hiện chỉ có kiểm parse/quyết định/log payload, chưa chạy CLI ghi DB tại Giai đoạn 0. [Audit](PROJECT_AUDIT.md) |

## Môi trường và giới hạn vận hành

- Mongo mới được xác nhận PRIMARY trước khi chạy. Chỉ khởi tạo replica set và dữ liệu test ở dbpath mới. Guard đối chiếu loopback, tên database và kết nối trước mỗi reset. Không dùng container demo. Sau suite, dừng tiến trình Mongo test do phiên audit tạo.
- Agent jCardSim riêng bắt đầu ở slot 0 trên cổng 32013. Test có reset slot 0 của Agent test. Agent demo 31999 và slot hiện hữu không được dùng. Dừng tiến trình Agent test sau khi chạy.
- Lần đầu Gradle wrapper bị chặn khi tạo lock/cache, và cache sao chép ở thư mục temp gặp lỗi quyền Java khi đóng JAR. Sau khi chuyển cache và bản build từ source HEAD vào thư mục audit được Git bỏ qua, chạy Gradle offline với `--rerun-tasks` thành công, 7 task chạy. Lượt javac + JUnit độc lập cũng cho cùng số lượng pass. Bộ CAP và đầu đọc/thẻ vật lý **NOT_RUN**.
- HTTP smoke dùng Mongo standalone mới trên cổng 27021 cho render, login fixture và kiểm trạng thái HTTP. Các ca transaction dùng replica set ở cổng 27018. Các trang thanh toán qua cổng và render processing không được gọi trong smoke để tránh I/O thanh toán. Chúng có kiểm tra thích hợp bằng Pug và suite mock.
- Docker API trả `permission denied`, nên trạng thái container/replica set demo **UNVERIFIED**. Cấu hình local được đối chiếu bằng các giá trị công khai cho phép. Website demo chưa được dùng để kiểm dữ liệu.
- Không gọi cổng thanh toán thật, không gửi SMTP thật, không cài dependencies và không dùng credentials của demo cho các suite. Chromium dùng fixture, chặn request ra ngoài. Chưa có xác nhận từ một vòng test responsive toàn trang hoặc nghiệm thu của chủ dự án.

Các nhóm thiếu kiểm thử gắn ID ở [tracker](PROJECT_FEATURE_TRACKER.md). Ca tay và kết quả kỳ vọng ở [hướng dẫn nghiệm thu](MANUAL_TEST_GUIDE.md). Giai đoạn 0 ghi nhận hiện trạng và kế hoạch xử lý.

## Hồi quy Giai đoạn 1 · 26/11/2026

Baseline G0 được giữ nguyên ở trên. Các lượt G1 chạy trên cây làm việc chưa commit, HEAD `2fcc368`. Mongo replica set test mới, Agent jCardSim mới trên 32013, Chromium fixture và cache Gradle offline tách khỏi môi trường demo.

| Lớp kiểm thử | Kết quả G1 |
|---|---|
| `npm.cmd test` với Agent jCardSim | 228 PASS, 0 FAIL, 0 SKIP. Giữ 8 ca qua Agent từ baseline. |
| `npm.cmd run test:integration` | **345 PASS, 0 FAIL, 0 SKIP.** Chạy tuần tự từ script npm. Các vòng trung gian lần lượt đạt 340 và 343 PASS. Vòng cuối bổ sung các ca chuẩn hóa thành viên Role và từ chối thay đổi thông tin đăng nhập không hợp lệ. |
| Gradle offline `:applet:test :agent:test --rerun-tasks` | 266 Applet PASS và 30 Agent PASS. 7 task thực thi, 0 FAIL và 0 SKIP. Source Java không đổi so với G0. |
| Pug compile | 61/61 PASS, gồm mixin phân trang mới. |
| HTTP fixture | 43/43 render PASS, guest Admin chuyển đăng nhập, API snapshot thiếu phiên trả 401, Admin catch-all trả HTTP 404. |
| Chromium/Playwright | PASS menu mobile Client, script tải một lần và không có lỗi khai báo trùng, bộ lọc/tìm/đổi page size/reset, sidebar 6 đường dẫn, CTA phát hành theo quyền. |

Tổng bốn suite Node, Mongo, Applet và Agent đạt **869 PASS, 0 FAIL, 0 SKIP**, hơn 23 ca so với baseline G0. Pug, HTTP và Chromium báo riêng. Các log chạy cuối lưu trong thư mục bỏ qua của Git `.superpowers/phase1`, gồm `node-reviewed.log`, `integration-reviewed.log` và `gradle.log`.

| Lát | Trước sửa | Sau sửa |
|---|---|---|
| G1.1 và UI | 4 FAIL có mục tiêu. Admin 404 trả 200, range chart sai được chấp nhận, script Client nạp hai lần, CTA phát hành hiển thị sai quyền. | 4 PASS sau sửa. Thêm ca trang đích của Role giới hạn, route chặn theo quyền và DB lỗi không làm request sau hỏng. |
| G1.2 | Profile ghi dữ liệu trực tiếp, đổi mật khẩu không xác minh mật khẩu hiện tại. Ba regression profile FAIL, sau đó thêm RED cho email đăng nhập phải chỉ đọc. | Profile tests PASS, gồm kiểm mật khẩu, xác nhận, phiên bản phiên và email chỉ đọc. Test rich text giữ bảng, định dạng, ảnh và link an toàn. Route upload kiểm quyền trước nhận file. |
| G1.3 | Checkout làm thay đổi đối tượng request. Regression xóa hẳn trên fixture phát hiện tour ngoài trash có thể bị xóa. | DTO/giá/City từ server, regression trash và hai ca cạnh tranh PASS. Suites thanh toán/hoàn tiền/check-in giữ kết quả. Thay dữ liệu fixture điểm xuất phát thành City thật trong Mongo test để kiểm hợp đồng mới. |
| G1.4 | Regression reset-only cho tài khoản chưa bật thẻ FAIL theo hợp đồng cũ. Lượt đầu sau sửa bộc lộ cookie reset vừa xóa đứng trước cookie mới trong HTTP response. | Chỉ cấp một reset grant, các ca legacy và OTP mới PASS. Giữ kiểm một lần, hết hạn, cạnh tranh. CLI fixture dry run, rollback audit, phiên bản phiên và thẻ còn active đều PASS. |
| G1.5 | Ca mặc định 10 và xóa mục cuối trang FAIL khi controller còn cố định 5. | Integration/phân trang và browser fixture PASS. Ca TEST 09 cũ yêu cầu rõ page size 5 để giữ cùng số lượng mong đợi. |

Chỉnh test baseline có căn cứ gồm chuyển kỳ vọng OTP Admin từ token đầy đủ sang reset-only theo duyệt G1.4, dùng mã mới từ mock SMTP thay vì đọc OTP plaintext trong DB, tạo Role và City fixture có thật trước khi xác minh input. Các assertion về tồn kho, thanh toán, đối soát, quyền, OTP có và không có thẻ, và chống ghi lặp được giữ.

Review mã nguồn qua ba lượt đã bắt các vấn đề về điều hướng Role giới hạn, phản hồi lỗi async, chuẩn hóa số điện thoại quay trang success, phiên bản OTP, ObjectId danh mục/Role và kiểm thông tin đăng nhập trong Settings. Đã có smoke hoặc regression cho các nhánh chính. Thẻ vật lý, cổng/SMTP/Cloudinary thật, luồng end-to-end SC-DEMO 01–07 theo cùng một phiên browser và mapping live vẫn chờ nghiệm thu. [Manual G1](MANUAL_TEST_GUIDE.md#kiểm-tra-thay-đổi-giai-đoạn-1)

## Hồi quy G1.6

Chạy ngày 26/11/2026 trên `feature/smartcard`, cây làm việc của HEAD `2fcc368`. Mốc **869 PASS** phía trên được giữ để đối chiếu. Các lượt chạy lặp, Pug, smoke và Chromium đứng ngoài tổng bốn suite.

| Suite | PASS | FAIL | SKIP | So với G1.5 |
|---|---:|---:|---:|---:|
| `npm.cmd test`, Agent jCardSim test 32013 | 229 | 0 | 0 | +1 |
| `npm.cmd run test:integration`, Mongo replica set test 27018 | 356 | 0 | 0 | +11 |
| Gradle offline `:applet:test`, đọc JUnit XML | 266 | 0 | 0 | 0 |
| Gradle offline `:agent:test`, đọc JUnit XML | 30 | 0 | 0 | 0 |
| **Tổng** | **881** | **0** | **0** | **+12** |

- **Pug 61/61 PASS. HTTP 43/43 PASS** trên Mongo standalone test 27021, 33 trang Admin và 10 trang Client. Trang success dùng đơn và cookie thành viên fixture theo hợp đồng mới. Admin thiếu phiên chuyển đăng nhập, snapshot khách thiếu phiên trả 401 và catch-all Admin trả 404.
- **Chromium fixture PASS** cho menu mobile, sidebar, CTA phát hành theo quyền, một lần tải script Client và bộ lọc/phân trang danh mục. Từ trang tour qua giỏ đi đến VNPay và ZaloPay mock, guest quay lại đúng đơn đã thanh toán. Phiên browser khác bị từ chối. Sau khi server lưu nhưng mất phản hồi, tải lại và bấm **Kiểm tra đơn** mở đúng đơn mà không nhập lại tên/điện thoại. Kiểm thêm phát hành thẻ khách, đổi PIN và ký đăng nhập qua jCardSim, về từ VNPay khác site với trang trung gian rồi bấm **Mở đơn hàng**. Browser dùng mã website và Agent thực, mock cổng thanh toán và thư viện CDN cần thiết khi chạy ngoại tuyến.
- **Môi trường nghiệm thu PASS.** Launcher thử trên một lượt mới, website 3302, mock gateway/hộp thư 3303, Mongo replica set 27022 và Agent jCardSim 32033. Xác nhận Admin đủ quyền và giới hạn, OTP từ hộp thư, Agent Origin, và lệnh dừng giải phóng cả bốn cổng. PowerShell gửi lại cùng intent trả cùng ID, đổi số khách trả 409. [Guide và lệnh](MANUAL_TEST_GUIDE.md#g16--môi-trường-nghiệm-thu-riêng)

| Nhóm | Kiểm chứng |
|---|---|
| Guest/member · WEB-05–WEB-11, MEM-01 | Một ca Node mới kiểm cookie HttpOnly, SameSite Lax, Secure theo HTTPS, session ổn định và intent trước ghi kho. Bảy ca Mongo mới kiểm bấm lặp/đồng thời tranh chỗ cuối, mất phản hồi sau commit, đổi số khách/tour, cách ly guest và member khi dùng cùng intent, đơn lịch sử, intent hết hạn và đơn xóa mềm, lỗi ghi/rollback, các route thanh toán và trang quay về trung gian. [Node](../test/phase1-checkout-session.test.js) · [Mongo](../test/integration/phase1-guest-checkout.test.js) |
| Role · ACC-07–ACC-09 | Bốn ca Mongo mới kiểm gán, mapping, chuyển sang quyền tường minh, khôi phục bộ quyền gốc và fallback trên fixture, Role giới hạn, mapping một phần, hiển thị route/menu và biến cấu hình sai. Dữ liệu demo chỉ kiểm kê Role. [Regression](../test/integration/role-mapping.test.js) · [Bản đồ và rollback](G1_6_ROLE_MAPPING.md) |
| Smart Card và thanh toán | Giữ suite callback ký, đối chiếu định danh/tiền, callback duplicate và đối soát. Hồi quy ví, nạp tiền, refund, hoàn kho, vé, receipt, Card Agent, OTP và recovery CLI đều chạy. Adapter test lấy intent/phiên hợp lệ theo checkout mới, đổi fixture success sang URL chỉ có order ID. Ca Node Zalo cập nhật request/response fixture theo guard mới và tiếp tục xác nhận mô tả tiếng Việt cùng chữ ký. [Gateway](../test/integration/order-payment.test.js) · [Ví](../test/integration/card-pay.test.js) · [Refund](../test/integration/order-card-refund.test.js) |

Log tự động lần cuối trong thư mục được Git bỏ qua `.superpowers/g16`, gồm `node-final.log`, `integration-final.log`, `java-full.log` và `http-final.log`. Applet/APDU/Agent source không đổi so với HEAD. **NOT_RUN** cho thẻ vật lý, gateway sandbox thật, SMTP/Cloudinary thật, đăng nhập demo và migration Role live. Nghiệm thu chủ dự án và chuỗi Smart Card tay SC-DEMO 01–07 vẫn chờ thực hiện trên fixture.

## Hồi quy G1.8 · 27/11/2026

| Suite | Chạy lại baseline | Sau thay đổi | FAIL | SKIP |
|---|---:|---:|---:|---:|
| Node với Agent fixture 32034 | 244 | 246 | 0 | 0 |
| Integration với Mongo replica set test 27018 | 363 | 364 | 0 | 0 |
| Gradle offline Applet | 266 | 266 | 0 | 0 |
| Gradle offline Agent | 31 | 31 | 0 | 0 |
| **Tổng** | **904** | **907** | **0** | **0** |

Pug 67/67. Chromium kiểm 47 đường dẫn/trạng thái HTTP ở 320, 360, 390, 768, 1024 và 1440 px, tổng 282 phép kiểm. Các kịch bản thao tác riêng dùng form, checkbox và nút trong Chromium để kiểm PATCH hủy đơn, album, TinyMCE, checkout mất phản hồi, hồ sơ, ký vé, PIN, xác thực hết hạn thực, hoàn tiền sau cấp lại và thu hồi trên fixture. Mongo và chip được dùng để đối chiếu các điểm đã ghi. [Chi tiết từng phép kiểm và log](G1_8_REPORT.md#bằng-chứng-và-hồi-quy)

Tại lượt chạy tự động G1.8, thiết bị thật, gateway thật, SMTP/Cloudinary thật và Tiny Cloud với hostname đã duyệt là NOT_RUN. Lần thử Agent PC/SC trong browser fixture dừng ở bước readiness. Chủ dự án đã xác nhận 6/6 nhóm G1.8 trong luồng thường. Lượt này kiểm khóa từng lô APDU, còn yêu cầu mở rộng khóa giữa các lô sau đó được rút tại G1.9 với trạng thái REMOVED_BY_OWNER.

## Hồi quy G1.9 · 27/11/2026

| Suite | Baseline | G1.9 PASS | FAIL | SKIP |
|---|---:|---:|---:|---:|
| Node với Agent jCardSim riêng | 246 | 247 | 0 | 0 |
| Mongo replica set test | 364 | 367 | 0 | 0 |
| Applet Gradle offline | 266 | 266 | 0 | 0 |
| Agent Gradle offline | 31 | 31 | 0 | 0 |
| **Tổng** | **907** | **911** | **0** | **0** |

Pug 67/67. Chromium kiểm 47 route/trạng thái × 6 viewport, 282 phép kiểm. Các phép kiểm thao tác riêng bao gồm FilePond và album, bảy trường ảnh tùy chọn, hồ sơ có phiên, checkout ví với Agent jCardSim và mock gateway, menu Client, fault injection check-in và TinyMCE local GPL. Bằng chứng chạy mới ở `.superpowers/g19/`. Manual PASS G1.8 của chủ dự án được ghi riêng. Tiny Cloud có key/domain thật, thẻ vật lý, gateway sandbox/live, SMTP/Cloudinary thật và Role migration vẫn NOT_RUN cho G1.9. [Chi tiết và giới hạn](G1_9_REPORT.md#kiểm-thử-g19)

Chủ dự án xác nhận manual PASS **4/4 nhóm G1.9**. Hai yêu cầu phát triển biên nhận check-in có chữ ký để tự đối soát và khóa chuyển slot giữa các lô APDU được đánh dấu REMOVED_BY_OWNER. Hồi quy tiếp tục kiểm các guard đang vận hành. [Quyết định phạm vi](G1_9_REPORT.md#yêu-cầu-đã-rút)

## Hồi quy trước khi chốt G1

| Suite | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| Node + Agent jCardSim riêng | 247 | 0 | 0 |
| Mongo integration trên replica set riêng | 367 | 0 | 0 |
| Gradle Applet offline | 266 | 0 | 0 |
| Gradle Agent offline | 31 | 0 | 0 |
| **Tổng** | **911** | **0** | **0** |

- **RED/GREEN checkbox.** Trước sửa, ô bỏ ảnh tour ở 1440 px đo 1.038 × 52 px, ô điều khoản ở 320 px đo 13 × 18 px. Sau sửa, 522 lượt đo trên form/bảng/giỏ và 36 lượt đo trên hồ sơ Client, chi tiết thẻ Admin, check-in đều đạt 18 × 18 px. Kiểm nhãn, phím Space, clear ảnh, trạng thái chọn một/nhiều vé và chọn tất cả. Xem `checkbox-red.log`, `checkbox-green.log`, `checkbox-card.log` và `media.log`.
- **Browser và Pug.** 47 route/trạng thái × 6 viewport, 282 lượt, 0 vấn đề. Pug compile 67/67. Chromium với Mongo và jCardSim chạy lại hồ sơ, ví, hoàn tiền, check-in ba vé và retry HTTP confirm. Xem `site.log`, `pug.log` và `checkbox-card.log`.
- **Lưu bằng chứng.** `.superpowers/g19-close/` giữ log suite, ảnh trước/sau và Git status. Fixture dùng dịch vụ mock và Agent jCardSim riêng. [Hướng dẫn rà checkbox](MANUAL_TEST_GUIDE.md#rà-checkbox-trước-khi-chốt-g1)
