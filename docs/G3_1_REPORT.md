# Báo cáo G3.1 · Dashboard và chi tiết khách hàng

**28/11/2026 · feature/smartcard · Chủ dự án xác nhận manual PASS 2/2 nhóm G3.1.** Hai nhóm đạt là G31-01 Dashboard và G31-02 Chi tiết khách hàng. Chủ dự án cũng xác nhận **manual PASS 3/3 nhóm chức năng G3**, gồm Dashboard, quản lý/chi tiết khách và phân quyền. Mốc trước G3/G3.1 là checkpoint G2/G2.1 `2e1e4508f5c49a0e92271e9612bf916cb29916e1`. [Báo cáo G3](G3_REPORT.md) · [Hướng dẫn G3.1](MANUAL_TEST_GUIDE.md#g31--nghiệm-thu-giao-diện)

Ảnh `vietnamese_tour_admin_statistics_dashboard.png` chưa có trong workspace hoặc các thư mục ảnh cục bộ đã kiểm. Phần triển khai dùng bố cục card trong prompt và kiểu chữ, màu, badge, Font Awesome đang dùng của Admin.

| ID | Trạng thái | Kết quả |
|---|---|---|
| UI-G3-001 | FIXED_TESTED | Chuyển thống kê chi tiết thành KPI và bốn nhóm. Đối soát có số tóm tắt và disclosure bàn phím. Giữ Chart.js, bộ lọc, cả 40 chỉ số, cập nhật kỳ và các trạng thái tải/lỗi. |
| UI-G3-002 | FIXED_TESTED | Khoảng cách từ nút **Mở danh sách đơn hàng** đến bảng là 20 px ở 360 px và 24 px ở 1440 px. Cùng URL, quyền và năm dòng thật trên fixture. |
| UI-G3-003 | FIXED_TESTED | Thông tin cá nhân, thành viên/thẻ và ví/công nợ chia card, dùng `dt/dd`. Mốc số dư chip nằm ngay dưới số tiền. Kiểm hồ sơ dài, thẻ thu hồi và khách chưa phát hành. |
| UI-G3-004 | FIXED_TESTED | Breadcrumb có link danh sách và tên khách được escape. Giữ truy vấn danh sách qua tab, phân trang, F5 và từng mục Back/Forward. |
| UI-G3-005 | FIXED_TESTED | Một thanh điều hướng link GET với mục hiện tại dễ nhận. Mobile cuộn ngang trong thanh, đưa mục active vào vùng thấy được. Tab, Shift+Tab và Enter giữ hành vi link. |
| UI-G3-006 | FIXED_TESTED | Bảng đơn, ví, vé và thẻ giữ toàn bộ cột và phân trang. Badge có nhãn, số tiền căn phải, ngày VN, bảng cuộn nội bộ và trạng thái rỗng. Đơn đã khôi phục được đánh dấu để tra cứu. |

## Kiểm kê chỉ số và phạm vi

Tất cả binding dưới đây dùng cùng nguồn đã nghiệm thu của G3. Đếm **26 khóa tiền** và **14 khóa đếm**. `card` có một ô trong nhóm Thẻ thành viên hiện có và một dòng breakdown. Các KPI Admin, khách, tổng đơn, thẻ active/locked/revoked, số dư hệ thống, check-in và đơn gần đây giữ nguyên vị trí cùng nguồn hiện hành. [Dashboard](../views/admin/pages/dashboard.pug) · [Nhóm thống kê](../views/admin/mixins/dashboard-statistics.pug)

| Vị trí | Binding màn hình | Kỳ hoặc quyền |
|---|---|---|
| Tổng quan và KPI chi tiết | `net`, `orderCount`, `gross`, `refundObligations` | Trong kỳ. Số đơn gồm đơn lưu trữ. |
| KPI ví | `topupReceived`, `unresolvedDebitCount`, `unresolvedDebitAmount` | Nạp trong kỳ, debit toàn thời gian. `card-view`. |
| Doanh thu theo phương thức | `money`, `bank`, `vnpay`, `zalopay`, `card` | Số thu trong kỳ theo quyền Dashboard. |
| Nạp ví | `topupChip`, `topupPending`, `topupCapHeld`, `topupAwaitingPayment`, `topupFailed` | Chip trong kỳ, trạng thái chờ/giữ/thất bại toàn thời gian. `card-view`. |
| Hoàn tiền | `refunded`, `refundChip`, `refundCash`, `refundsPending`, `refundsCapHeld` | Ba số hoàn tất trong kỳ. Hai số chờ/giữ toàn thời gian. |
| Tóm tắt đối soát | `salesMissingTimeCount`, `salesSnapshotAmount`, `refundUnverified` | Toàn thời gian. Tổng tiền chưa xác minh là phần đồng thời thiếu mốc thanh toán. |
| Đối soát thanh toán đơn | `salesUndatedAmount`, `salesMissingAmount`, `salesUnverifiedAmount`, `unsupportedMethod` | Toàn thời gian, trong disclosure. |
| Đối soát hoàn tiền | `refundsMissingRecordedTime`, `refundsMissingTime`, `refundsUndatedAmount` | Toàn thời gian, trong disclosure. |
| Đối soát ghi nợ ví | `unlinkedDebitCount`, `unlinkedDebitAmount`, `lateDebitCount`, `lateDebitAmount` | Toàn thời gian, `card-view`. |
| Đối soát nạp ví | `topupMissingRecordedTime`, `topupMissingTime`, `topupUndatedAmount`, `topupUnverified` | Toàn thời gian, `card-view`. |

Đổi kỳ cập nhật cả thẻ số liệu và chart từ payload G3. Trong khi tải hoặc khi lỗi, các binding động hiện dấu gạch và canvas của tháng trước ẩn. Giá trị 0 có nhãn và định dạng số. `DATA-01` vẫn **PARTIAL** cho lịch sử thiếu chứng cứ và khoản hoàn ngoài ví chưa xác minh. Quy ước quản trị trên fixture giữ công thức thu tour có chứng cứ trừ khoản hoàn hoàn tất theo kỳ UTC+7. [Công thức và phạm vi](G3_REPORT.md#quy-ước-số-liệu)

Hồ sơ giữ tên, email, điện thoại, ngày tham gia, tài khoản, hạng/chiết khấu, tổng chi tiêu và trạng thái thẻ. Mã thẻ, số dư, mốc receipt và các khoản chờ tuân theo `card-view`. Các bảng lấy đúng tập dữ liệu và scope quyền G3. Giá trị thiếu dùng nhãn hiện hành. [Trang chi tiết](../views/admin/pages/user-detail.pug)

## Kiểm thử

| Bộ chạy | G3 baseline chạy lại | G3.1 lần cuối |
|---|---:|---:|
| Node với jCardSim | 247 | 250 |
| Mongo replica set serial | 391 | 391 |
| Applet Gradle offline | 266 | 266 |
| Agent Gradle offline | 31 | 31 |
| **Tổng PASS** | **935** | **938** |
| FAIL / SKIP | **0 / 0** | **0 / 0** |
| Pug compile | 72/72 | 73/73 |
| Chromium route × viewport | 324/324 | 324/324 |

- **RED/GREEN.** Ba ca DOM mới tái hiện thiếu cấu trúc card, disclosure và breadcrumb. Ba ca đạt sau sửa. Browser đo khoảng cách cũ 0 px. Hai lượt RED về breadcrumb tái hiện lệch bộ lọc qua Back/F5 và khi mở một tab lịch sử mới sau Back. Browser cuối đi qua cả hai nhánh và kiểm lại CSS cascade bảng, grid hai cột desktop, độ tương phản badge trong bảng từ 4,5:1. [Ca DOM](../test/g31-ui.test.js)
- **Chromium thao tác.** Đối chiếu 40 binding tháng 11 và 12, hoàn tháng 1, độ dài 28/29/30/31 ngày, lỗi mạng và response đến sai thứ tự. Có click, keyboard, F5, Back/Forward, role hạn chế, nội dung dài mô phỏng và ví rỗng. Ma trận sáu viewport 320/360/390/768/1024/1440 px. 28 ảnh trước/sau gồm Dashboard mở/đóng và năm tab tại 360/1440 px. Chart.js dùng bản cache cục bộ, các CDN bên ngoài bị chặn trong lượt fixture nên ảnh có thể dùng font fallback và thiếu glyph icon từ CDN.
- **Bảo toàn phạm vi.** Hash trước/sau của 12 file đại diện cho route, controller, quyền, engine, model và seed khớp. Phép tính, thanh toán, ví, APDU, giao dịch DB và projection hiện hành giữ nguyên. Log và ảnh ở `.superpowers/g31/` gồm `baseline-run-58Klty/`, `delivery-run-oKlfFh/`, `final-browser-actions.log`, `final-browser-matrix.log`, `baseline-gradle.log`, `final-gradle.log`, `before/`, `unchanged-before.csv` và `final-status.log`.
- **NOT_RUN.** Database demo/thật, gateway/SMTP/cloud thật, PC/SC, thẻ vật lý, backfill và migration Role thật.

## Đề xuất ánh xạ Role

Bảng dùng tài liệu kiểm kê ngày 26/11 và ma trận quyền trong code. Trạng thái danh sách Role hiện hành cần xác nhận riêng khi duyệt rollout. Quyền `customer-view` là tường minh, cho hồ sơ và thêm các phần theo quyền module mà Role đã có. Phương án mặc định giữ phạm vi hẹp cho quầy phát hành, thu ngân, check-in và bán tour. [Nguồn kiểm kê](G1_6_ROLE_MAPPING.md#hiện-trạng-và-đề-xuất-theo-role) · [Quyền G3](G3_REPORT.md#quyền-truy-cập-và-dữ-liệu-khách)

| Role trong tài liệu | Đề xuất để chủ dự án duyệt |
|---|---|
| Demo Smartcard Full | Xem xét cấp tường minh `customer-view` cho người thực sự quản trị hồ sơ. Bộ quyền hiện có của Role sẽ mở lịch sử tài chính, vé, thẻ và đơn lưu trữ sau khi cấp. |
| Demo - Bán tour | Giữ quyền hiện tại. Chỉ xem xét `customer-view` nếu nhiệm vụ có tra cứu hồ sơ. Với bộ quyền đã ghi, thay đổi sẽ thêm hồ sơ và tab đơn. |
| Demo - Phát hành thẻ | Dùng tra cứu danh sách sẵn có qua `card-issue`/`card-view`. Phiên bản có quyền xem hồ sơ và ví cần xác định nhu cầu riêng. |
| Demo - Thu ngân | Giữ quyền nạp và tra cứu đang có. Quyền hồ sơ sẽ mở chung ví, lịch sử thẻ, đơn và vé theo bộ quyền hiện hữu nên cần duyệt phạm vi trước khi xem xét cấp. |
| Demo - Check-in | Giữ quyền check-in và tra cứu thẻ hiện có. |
| Demo - Giám sát | Chờ xác nhận nhiệm vụ và người nhận. `customer-view` kết hợp quyền thẻ/đơn hiện tại sẽ mở lịch sử tương ứng. |
| Role thêm sau kiểm kê hoặc bộ quyền đã thay đổi | **Thiếu thông tin.** Đối chiếu nhiệm vụ, quyền cụ thể và phạm vi nhạy cảm trước khi đề xuất. |

Chủ dự án đã xác nhận chốt checkpoint với baseline **938 PASS, 0 FAIL, 0 SKIP**, Pug **73/73** và Chromium **324/324**. G4 chờ chỉ đạo triển khai riêng. [Báo cáo kiểm thử](PROJECT_TEST_REPORT.md#g31--hồi-quy-giao-diện)
