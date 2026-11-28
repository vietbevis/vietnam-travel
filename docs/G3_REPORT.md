# Báo cáo G3 · Vietnam Travel

**28/11/2026 · feature/smartcard · Chủ dự án xác nhận PASS 3/3 nhóm chức năng G3 và PASS 2/2 nhóm giao diện G3.1.** Chủ dự án đã xác nhận manual PASS 6/6 nhóm G2 và 2/2 nhóm G2.1. Mốc trước G3/G3.1 là checkpoint G2 **`2e1e4508f5c49a0e92271e9612bf916cb29916e1`**, cha **`6902f245946d485136d68ac6e3bdb8a8eacb0992`**, gồm 52 tệp. [G2/G2.1](G2_REPORT.md) · [Báo cáo G3.1](G3_1_REPORT.md) · [Hướng dẫn giao diện](MANUAL_TEST_GUIDE.md#g31--nghiệm-thu-giao-diện)

| ID | Trạng thái | Kết quả và phạm vi |
|---|---|---|
| ADM-01 | FIXED_TESTED | GET `/admin/dashboard?month=YYYY-MM` và POST `/admin/dashboard/revenue-chart` dùng cùng báo cáo. Giữ Chart.js và layout Dashboard. Kiểm số theo kỳ, tổng ròng âm, HTTP 401/403/400, đơn thật và lịch VN. |
| ADM-14 | FIXED_TESTED | GET `/admin/user/list`. DB đếm và phân trang 5/10/20/50/100, mặc định 10. Có lọc thẻ/hạng, tìm tên tiếng Việt, email, điện thoại, sort ngày tạo và ID, query qua Back/Forward. |
| ADM-15 | FIXED_TESTED | GET `/admin/user/detail/:id` chỉ đọc, có hồ sơ và các nhóm lịch sử theo quyền. Mỗi nhóm truy vấn và phân trang riêng. |
| DATA-01 | PARTIAL | Số theo kỳ có chứng cứ được đối chiếu trên fixture. Các đơn và ledger cũ thiếu thời điểm/số tiền xác nhận nằm trong đối soát. Chính sách ghi nhận theo kỳ và phạm vi báo cáo thực tế chờ duyệt. |
| CARD-15, MEM-06 | PARTIAL | G3 hiển thị chuỗi hoàn, ledger khi cấp lại, hạng, số dư hệ thống, biên nhận chip và nghĩa vụ đang chờ trong Admin. Các mục G4 và trải nghiệm Client tiếp tục theo lộ trình đã duyệt. |

## Đối chiếu tại checkpoint

| Chỉ tiêu cũ | Thực tế ở 2e1e450 | Thay đổi ở G3 |
|---|---|---|
| Quản trị viên | Đếm `AccountAdmin.deleted:false`. | Giữ tập bản ghi, chỉnh nhãn. |
| Người dùng | `totalUser` khởi tạo 0 và giữ nguyên khi render. | Đếm Customer theo ID, kể cả chưa có thẻ. |
| Đơn hàng | Tải Order `deleted:false` rồi lấy độ dài. | Đếm mọi đơn, ghi rõ toàn thời gian. Thêm số đặt theo tháng dựa trên createdAt. |
| Doanh thu tổng và chart | Cộng `Order.total` của đơn đang hiện, gồm cả unpaid. Chart chia ngày theo `createdAt`, tháng theo múi giờ máy chủ và ngày theo mảng client. | Tập hợp sự kiện thanh toán và hoàn. Ngày hệ thống phát sinh sự kiện theo UTC+7, bucket [đầu kỳ, đầu kỳ kế tiếp). |
| Đơn gần đây | G0 từng có dòng mẫu. Checkpoint G2 chỉ còn liên kết tới đơn. | Danh sách tối đa 5 đơn thật, xác định khách vãng lai khi thiếu customerId. |
| Thẻ/check-in | `cardStats` đếm active/locked/revoked, tổng debit done dùng ngày tạo Tx, bảng check-in ±7 ngày. | Giữ số thẻ và bảng check-in. Ví mua tour dùng cùng breakdown đã settlement. Tách số dư hệ thống và trạng thái receipt. |
| Danh sách khách | Tìm literal trên ba trường, chỉ khách active/chưa xóa, cap 200, quyền thẻ kiêm quyền tra cứu. Chi tiết chưa có route. | Query có phân trang, tìm dấu/không dấu, lọc trước khi cắt trang. Quyền hồ sơ độc lập và lịch sử theo module. |

## Quy ước số liệu

**Đơn vị tiền** là số nguyên VND. Tháng theo giờ Việt Nam UTC+7. **Tổng đơn** bao gồm đơn hủy, đang xử lý, đã ẩn và khôi phục tra cứu. **Đơn gần đây** áp dụng trạng thái đang hiện của Admin và quyền `order-view`. Thứ tự ngày tạo giảm dần, sau đó ID giảm dần. Khách vãng lai thuộc nhóm riêng. Quan hệ lịch sử của một khách lấy từ `customerId` hoặc chủ sở hữu thẻ đã lưu.

| Nhãn | Nguồn và thời điểm | Phạm vi, quyền và dữ liệu thiếu |
|---|---|---|
| Admin và khách chưa xóa | AccountAdmin `deleted:false`, Customer `deleted != true`, mỗi document một người. | Toàn thời gian, `dashboard-view`. Tính khách chưa có thẻ. Trang list khách dùng khách active theo enum hiện tại. |
| Đơn đặt | Order.createdAt thật, aggregate theo kỳ. | Gồm archived và restored. Ngày tạo phục vụ đếm đơn. |
| Tiền bán tour | Order `paid` với `paidAmount` chốt khi nhận tiền. Tiền mặt/chuyển khoản theo ghi nhận Admin. VNPay/ZaloPay theo callback/return đã xác minh của luồng hiện có. | Gồm đơn đã hủy/archived/restored có chứng cứ. Breakdown tiền mặt, ngân hàng, VNPay, ZaloPay, ví. Khoản chưa xác minh nằm trong đối soát. |
| Trả tiền tour bằng ví | Debit `done/order` trùng orderId, cardTxRef, chủ thẻ, số tiền và nội dung receipt. `Order.paidAt` và `Tx.completedAt` dùng cùng mốc áp dụng biên nhận. | Tính một lần ở breakdown của Order. Bản ghi legacy định danh khớp và có `completedAt` dùng được mốc đó. Thiếu ngày thì đưa số có chứng cứ vào nhóm thiếu mốc. |
| Nạp ví đã ghi nhận | Nạp tiền mặt dùng ngày bút toán gốc vì thao tác bắt đầu bằng ghi nhận tại quầy. VNPay/ZaloPay dùng `paymentReceivedAt`. | `card-view`. Khoản provider đã thu và đang đối soát do thiếu thẻ vẫn được ghi nhận. `movedFrom` giữ nguồn vốn gốc khi cấp lại. |
| Nạp ví đã ghi chip | Credit `done` ở đầu cuối chuỗi, đã đối chiếu receipt và `completedAt`. | `card-view`. Hiển thị riêng tiền chờ trả, chờ đồng bộ, giữ vì hạn mức và thất bại. Chuyển số dư nội bộ xuất hiện trong lịch sử ví. |
| Nghĩa vụ hoàn đơn ví | Credit gốc `refund` gắn Order hủy, `refundTxRef`, cùng chủ thẻ và amount. Dùng thời điểm tạo nghĩa vụ. | Một khoản mỗi đơn. Chuyển credit chưa ký sang thẻ mới theo `movedFrom`. Dữ liệu không khớp đưa vào đối soát. |
| Hoàn đã hoàn tất | Receipt credit đã áp dụng chip, dùng `completedAt`. Hoàn tiền mặt khi thu hồi dùng bút toán debit đối ứng duy nhất cùng cardId, amount và movedFrom của credit đơn hàng. | Khoản chi số dư ví thông thường khi thu hồi nằm ngoài hoàn đơn. Hoàn cổng/tiền mặt/chuyển khoản từ đơn ngoài ví cần xử lý qua quy trình đối soát hiện hành. |
| Doanh thu ròng quản trị | Tiền bán tour có chứng cứ trong kỳ trừ hoàn đã hoàn tất trong kỳ. | `dashboard-view`. Kỳ hoàn chậm có thể âm. Khoản chờ hoàn và vốn nạp đứng riêng. Công thức quản trị chờ chủ dự án phê duyệt. |
| Đối soát | Đơn/hoàn/nạp thiếu mốc hoặc amount, bằng chứng lệch, debit chưa xác nhận và receipt đến muộn có log đủ điều kiện. | Đơn legacy có tổng đặt nhưng thiếu chứng cứ số đã thu hiện riêng dưới nhãn tổng đơn chưa xác minh. Receipt muộn đếm duy nhất theo cardId và txRef, phần ví chi tiết cần `card-view`. |
| Thẻ, số dư và check-in | Card theo trạng thái hệ thống. Số dư server lấy Card hiện hành khách active/locked. Hồ sơ dùng số dư trong receipt gần nhất của thẻ hiện hành đủ chứng cứ và thời gian. | `card-view`. Lệnh pending/reconciliation qua cả thẻ cũ của đúng khách hiện riêng. Bảng check-in giữ nguồn Order đã trả, chưa hủy, ngày khởi hành ±7 ngày. |

Cash, bank, VNPay, ZaloPay và ví đi qua `markOrderPaid` hoặc `markOrderPaidInSession`. CAS `unpaid → paid` ghi snapshot cùng cập nhật đơn; trường hợp thành viên và ví rollback chung với cập nhật vé/chi tiêu/ledger. Engine đã xác minh mật mã trước khi ghi Tx `done`. Bộ tổng hợp kiểm cấu trúc và đối chiếu trường receipt với dòng ledger, giữ chữ ký/receipt ngoài HTML/JSON. Một lần retry thành công đã ghi trước đó giữ nguyên mốc. Ngày tạo đơn, ngày cập nhật và ngày khôi phục không cung cấp mốc settlement. [Settlement](../helpers/order-payment.helper.js) · [Receipt](../helpers/card-op.helper.js) · [Aggregate](../helpers/dashboard-revenue.helper.js) · [Đối chiếu ledger](../helpers/ledger-report.helper.js)

## Quyền truy cập và dữ liệu khách

| Tài nguyên | Quyền thực thi ở route/server |
|---|---|
| Dashboard HTML và POST chart | `dashboard-view`. Bảng Đơn gần đây cần thêm `order-view`; thẻ, nạp và đối soát debit cần `card-view`. |
| Tra cứu danh sách | `customer-view`, `card-view` hoặc `card-issue`. Hai quyền thẻ hiện hữu vẫn tra được khách và trạng thái thẻ để phục vụ nghiệp vụ quầy. |
| Chi tiết, ngày tham gia, hạng và tổng chi tiêu | `customer-view` tường minh. Hạng và chiết khấu đọc trực tiếp `tier.helper` từ Customer.totalSpent. Vòng đời cấp lại không cộng chi tiêu từ các thẻ cũ. |
| Đơn, vé, thẻ và ví ở hồ sơ | Đơn cần `order-view`, bản ghi chưa khôi phục thêm `order-trash`. Vé cần `order-view` với `card-view` hoặc `card-checkin`; áp dụng cùng quyền lưu trữ. Mã thẻ, lịch sử thẻ, số dư và ví cần `card-view`. |
| Dữ liệu ngoài hồ sơ đọc | PIN, escrow, token, receipt, khóa và APDU không có trong dữ liệu render. Thông tin định danh/email tự sửa của khách tiếp tục theo G4.6. |

Bộ lọc *Từng thu hồi và chưa có thẻ hiện hành* cần quyền `card-view` và truy vấn thẻ lịch sử khi hiện tại chưa có thẻ. Card bị khóa trên hệ thống là một trạng thái vòng đời của thẻ. Số dư chip là quan sát tại receipt, có thể cách xa thời điểm hiện tại. Trang hồ sơ chỉ hiển thị dữ liệu, dùng chính sách ghi nhận chi tiêu và hoàn sẵn có. [Route khách](../routes/admin/user.route.js) · [Controller khách](../controllers/admin/user.controller.js) · [Hạng](../helpers/tier.helper.js)

## Kiểm thử và rà soát

- **Baseline checkpoint sau G3.1** đạt **938 PASS, 0 FAIL, 0 SKIP**, Pug **73/73** và Chromium **324/324**. Lượt chức năng G3 trước chỉnh sửa UI đạt **935 PASS, 0 FAIL, 0 SKIP**, Pug **72/72** và Chromium **324/324**. Lượt thao tác G2.1 bổ sung kiểm 18 modal ở 360 px. [Số theo suite](PROJECT_TEST_REPORT.md#g31--hồi-quy-giao-diện)
- **Baseline chạy mới ở G2** đạt 247 Node, 385 Mongo replica set, 266 Applet và 31 Agent, tổng **929 PASS, 0 FAIL, 0 SKIP**. Pug **70/70**, Chromium **294/294** từ 49 route/trạng thái và sáu viewport. Log Node/Mongo trong `.superpowers/g3/baseline-run-IxNMpl/`, Java trong `gradle.log` và `gradle-counts.log`.
- **RED** tái hiện thiếu snapshot/mốc, chart phụ thuộc payload ngày, danh sách cap 200. Review RED bổ sung quyền archive và số đơn tháng trước. Tập hồi quy đối soát bắt sai lệch tiền cổng tới sau khi mất bản ghi thẻ, receipt muộn trùng log và hồ sơ còn nghĩa vụ trên thẻ cũ.
- **Rà độc lập** kiểm quyền, quan hệ ledger và tính nhất quán thời gian. Lượt rà lại xác nhận các phát hiện quan trọng đã được xử lý. Thay assertion chart cũ vốn đếm debit theo createdAt bằng ca chặn và đối soát debit mồ côi/chưa xác minh. Bổ sung kiểm mốc receipt ở đường ký/xác nhận, retry, rollback. Bộ fixture có chữ ký RSA sinh riêng và dữ liệu cố định theo kỳ. Các ca engine kiểm xác minh chữ ký trong luồng thật. [Ca tích hợp G3](../test/integration/g3-admin.test.js) · [Oracle fixture](../scripts/acceptance-g3-seed.cjs)
- **Chromium thao tác** đăng nhập qua form, chart/KPI, đổi tháng/năm, thử lỗi mạng và hai phản hồi thành công đến sai thứ tự. Search, lọc kết hợp, phân trang và F5/Back/Forward, năm tab hồ sơ, quyền archive và tải trực tiếp. Kiểm 320/360/390/768/1024/1440 px. Ảnh và log dưới `.superpowers/g3/`. [Bảng suite](PROJECT_TEST_REPORT.md#g3--kiểm-thử-dashboard-và-khách)
- **Explain trên fixture.** Với 25 đơn và 14 dòng ví, payload báo cáo tháng 11 khoảng 3,7 KB. Explain ghi lookup Order theo index `_id_` và các lần quét collection ở một số join ledger/thẻ. Kết quả phản ánh fixture nhỏ. Đo tải và index trên dữ liệu thật chưa thực hiện. Xem `.superpowers/g3/fixture-explain-delivery.log`.
- **NOT_RUN** thiết bị vật lý, PC/SC, sandbox/live provider, mail/cloud thật, demo DB, backfill và migration Role thực tế. Java/APDU không đổi. Superpowers dùng input `MASTER_PROMPT_G3.md` đã được ủy quyền triển khai trực tiếp và kế hoạch làm việc lưu ở `.superpowers/g3/plan.md`.

## Gate chủ dự án

Chủ dự án xác nhận công thức và phân quyền trong ba nhóm chức năng G3 trên fixture, nghiệm thu hai nhóm UI G3.1 và xác nhận chốt checkpoint. DATA-01 giữ phạm vi PARTIAL cho lịch sử thiếu chứng cứ. Ánh xạ `customer-view` trên Role thật và triển khai G4 chờ chỉ đạo riêng. [Nghiệm thu giao diện và đề xuất Role](G3_1_REPORT.md)
