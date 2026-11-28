# Hướng dẫn nghiệm thu tay — Vietnam Travel

**Chủ dự án đã nghiệm thu PASS 3/3 nhóm chức năng G3 và PASS 2/2 nhóm giao diện G3.1.** Có thể dùng lại kịch bản bên dưới khi kiểm hồi quy. [Hai nhóm giao diện G3.1](#g31--nghiệm-thu-giao-diện)


**Chủ dự án đã nghiệm thu 6/6 nhóm G2 và 2/2 nhóm G2.1.** Có thể chạy lại [hai nhóm G2.1](#g21--nghiệm-thu-hai-thay-đổi-cuối). Chủ dự án đã xác nhận chốt G1, gồm G1.8 **6/6**, G1.9 **4/4** và phần rà checkbox. [Báo cáo G2](G2_REPORT.md)

**Nghiệm thu G1.6 · cây làm việc trên HEAD `2fcc368` · 26/11/2026**

Các ca lịch sử G1 dùng [môi trường nghiệm thu riêng](#g16--môi-trường-nghiệm-thu-riêng) và [bảng kiểm Giai đoạn 1](#kiểm-tra-thay-đổi-giai-đoạn-1). [Sáu nhóm G2](#g2--nghiệm-thu-danh-mục-tour-và-đơn) được lưu để đối chiếu phạm vi đã nghiệm thu.

Chạy trên website và Mongo test riêng với dữ liệu giả, Card Agent jCardSim test riêng và Origin phù hợp. Ví dụ URL demo trong tài liệu tham chiếu cần được thay bằng URL fixture. Chuẩn bị một vai trò quyền phù hợp, một vai trò hạn chế và tài khoản khách thuộc hai chủ thẻ. Dùng fixture cho email, avatar, callback và mã định danh. Ca có ghi dữ liệu, xóa, khóa, thử PIN hoặc reset chỉ thực hiện trên fixture. Ghi HEAD, browser/viewport, lớp test, ID fixture và kết quả **PASS / FAIL / NOT_RUN / BLOCKED**. Ghi kết quả quan sát bằng mô tả hoặc ảnh đã che dữ liệu nhạy cảm.

## G3.1 · Nghiệm thu giao diện

Chạy PowerShell trong repo và giữ terminal mở đến khi hết phiên kiểm. Chờ dòng `READY`.

```powershell
Set-Location 'D:\vietnam-travel'
node scripts/acceptance-g1.cjs --g3
```

Vào **http://127.0.0.1:3302/admin/account/login**. Mật khẩu của mọi tài khoản fixture dưới đây là **`G16Fixture-2026!`**. Dữ liệu seed có sẵn cho cả hai nhóm. Agent jCardSim khởi động cùng fixture. Hai nhóm giao diện chỉ cần thao tác trên trình duyệt.

| Tài khoản | Dùng để kiểm |
|---|---|
| `backup@g1.example.com` | Dashboard, hồ sơ, bốn lịch sử và đơn lưu trữ. |
| `g3-dashboard@g1.example.com` | Dashboard với dữ liệu bán tour. Vùng thẻ, nạp ví, đối soát debit và nút mở đơn vắng mặt. |
| `g3-customer@g1.example.com` | Danh sách và hồ sơ, chỉ thấy tab Hồ sơ. |
| `g3-history@g1.example.com` | Hồ sơ và lịch sử theo quyền. Đơn đã khôi phục có thể tra cứu. |
| `g3-issuer@g1.example.com` | Tra cứu danh sách. Mở trang chi tiết trực tiếp trả 403. |

### G31-01 · Dashboard

1. Với **backup**, mở **http://127.0.0.1:3302/admin/dashboard?month=2026-11**. Ở phần tổng quan có **8 Admin**, **210 khách**, **25 đơn** và ròng **3.900.000 đ**. Vùng thẻ và bảng check-in vẫn ở trên chart. Cuộn xuống **Thống kê chi tiết**, đối chiếu các card với bảng dưới.

   | Vùng | Kết quả tháng 11/2026 |
   |---|---|
   | KPI chi tiết | **10** đơn gồm đơn lưu trữ, thu **3.900.000 đ**, nghĩa vụ hoàn **1.100.000 đ**, nạp đã ghi nhận **950.000 đ**, debit chờ **1 khoản / 123.000 đ** toàn thời gian. |
   | Doanh thu theo phương thức | Tiền mặt **1.200.000**, ngân hàng **850.000**, VNPay **750.000**, ZaloPay **0**, ví **1.100.000 đ**. |
   | Nạp ví | Ghi chip trong kỳ **0**, chờ ghi/đối soát **0**, giữ hạn mức **250.000**, chờ trả **80.000**, thất bại **20.000 đ**. |
   | Hoàn tiền | Hoàn tất **0**, qua chip **0**, tiền mặt thu hồi **0**, hoàn đang chờ **400.000 đ**, giữ hạn mức **0 đ**. |
   | Tóm tắt đối soát | **2 đơn** thiếu mốc thanh toán, trong đó tổng tiền chưa xác minh **500.000 đ**, hoàn cần đối soát **0 khoản**. |
   | Chi tiết đối soát | Tiền có chứng cứ thiếu mốc **0 đ**. Thiếu số tiền **1 đơn**, có tổng thiếu chứng cứ **1 đơn**, phương thức chưa xác định **0**. Nhóm hoàn, ghi sổ chưa khớp, receipt đến muộn và mốc thu/ghi chip của nạp đều **0**. |

2. Tab đến **Xem chi tiết đối soát**, bấm Enter để mở, Space để thu gọn. Khi thu gọn vẫn thấy tóm tắt. So sánh các nhóm 0, khoản chờ và số đã xác nhận qua cả nhãn lẫn màu.
3. Chọn **12/2026** để thấy thu **200.000 đ**, hoàn chip **600.000 đ**, ghi chip nạp **700.000 đ** và ròng **−400.000 đ**. Tháng **01/2027** hoàn tiền mặt thu hồi **100.000 đ**, ròng **−100.000 đ**. F5 giữ tháng. Thử tháng rỗng **02/2024**, số tháng **0 đ** và có 29 ngày. Trong DevTools, bật Offline và đổi sang một tháng khác. Số động hiện dấu gạch, chart cũ ẩn và có thông báo lỗi. Tắt Offline, chọn tháng hợp lệ để thấy số đúng.
4. Ở 360 và 1440 px, xem nhóm chi tiết co cột, số tiền dễ đọc và bảng đơn cuộn trong khung. Nút **Mở danh sách đơn hàng** cách bảng **20/24 px** và mở **/admin/order/list**. Bảng dùng tối đa năm đơn gần đây, gồm `G3-UNPAID` và `G3-ZALO-NEXT`. Đăng nhập **g3-dashboard** để kiểm các vùng theo quyền trong bảng tài khoản trên.

### G31-02 · Chi tiết khách hàng

1. Với **backup**, mở **http://127.0.0.1:3302/admin/user/list?keyword=Dang+Ha&cardStatus=active&tier=gold&pageSize=5**. Bấm **Chi tiết** của **G3 Đặng Hà (Hồ sơ)**. Hồ sơ trực tiếp ở **http://127.0.0.1:3302/admin/user/detail/650000000000000000000003**. Breadcrumb hiển thị danh sách và tên khách ở trên tiêu đề. Link danh sách giữ bộ lọc, kể cả sau khi đổi tab và F5. Thử mở cùng khách từ truy vấn `?keyword=g3-dang-ha`, Back về tab cũ rồi mở một tab lịch sử khác. Link quay lại dùng bộ lọc đầu.
2. Kiểm ba card hồ sơ. Thông tin cá nhân có cặp nhãn–giá trị. Thành viên hiện **Gold · 5%**, chi tiêu **30.000.000 đ** và thẻ hoạt động đuôi **0310**. Ví có số dư hệ thống và biên nhận chip cùng **2.500.000 đ**, mốc chip **00:00 ngày 01/12/2026**. Ghi có chờ **2.400.000**, giữ hạn mức **250.000**, debit chờ **123.000** và biên nhận muộn **0 đ**. Ở 1440 px, hai card đầu chia hai cột. Ở 360 px, các card xếp dọc và tên/email/mã vẫn đọc được.
3. Bấm lần lượt **Đơn hàng**, **Giao dịch ví**, **Vé**, **Lịch sử thẻ**. Kiểm mục active, tiêu đề bảng, badge, cột số tiền/ngày. Ở 320 hoặc 360 px, cuộn thanh tab/bảng trong khung và thử Tab, Shift+Tab, Enter. URL và mục active đúng khi F5/Back/Forward.
4. Đơn `G3-CASH` là khách vãng lai có tên và điện thoại trùng fixture. Dòng này vắng trong hồ sơ. `G3-VNPAY-RESTORED` có link tra cứu và nhãn đã lưu trữ/khôi phục. Ví có **14** dòng, chọn **5** và trang **3** để thấy **11–14 của 14**. Kiểm nhãn chuyển số dư và hoàn tiền mặt khi thu hồi. Vé có `G3-ZALO-NEXT`. Lịch sử có thẻ hiện hành **0310** và thẻ thu hồi **0309**. Xem thêm hồ sơ ID `650000000000000000000005` để kiểm thẻ thu hồi và hồ sơ ID `650000000000000000000006` với `?tab=wallet` để kiểm bảng rỗng.
5. Với **g3-customer**, chỉ thấy Hồ sơ, vắng mã thẻ và ví công nợ. Mở `?tab=wallet` trực tiếp trả 403. Với **g3-history**, đơn `G3-VNPAY-RESTORED` có trong tab Đơn hàng, còn `G3-BANK-ARCHIVED` vắng mặt. Với **g3-issuer**, mở được danh sách và nhận 403 khi vào chi tiết.

Ghi lại kết quả **G31-01** và **G31-02** nếu chạy hồi quy. Dừng fixture bằng **Ctrl+C** trong cửa sổ launcher hoặc `node scripts/acceptance-g1.cjs --stop <RunID>`. [Báo cáo G3.1](G3_1_REPORT.md)

## G3 · Nghiệm thu Dashboard và khách hàng

Ba nhóm bên dưới lưu hướng dẫn chức năng G3 đã được chủ dự án xác nhận. Các ca UI hiện tại ở mục G3.1.

### Khởi động và tài khoản

Mở PowerShell trong thư mục dự án. Tắt lượt fixture do bạn đang chạy tại cùng cổng nếu có. Chờ terminal in `READY`, sau đó giữ cửa sổ này mở.

```powershell
Set-Location 'D:\vietnam-travel'
node scripts/acceptance-g1.cjs --g3
```

Mở **http://127.0.0.1:3302/admin/account/login**. Tất cả tài khoản dưới đây dùng mật khẩu fixture **`G16Fixture-2026!`**.

| Email | Quyền và điều cần thấy |
|---|---|
| `backup@g1.example.com` | Kiểm toàn bộ Dashboard và khách, gồm đơn lưu trữ và các tab. |
| `g3-dashboard@g1.example.com` | Dashboard và API chart. Khu vực thẻ/nạp/ví chi tiết và bảng đơn gần đây được ẩn. |
| `g3-customer@g1.example.com` | Danh sách và hồ sơ. Truy cập trực tiếp tab đơn, ví, vé hoặc lịch sử thẻ nhận 403. |
| `g3-history@g1.example.com` | Hồ sơ, đơn, ví, vé và thẻ. Đơn archived chưa khôi phục bị loại khỏi đơn và vé. |
| `g3-issuer@g1.example.com` | Tra cứu danh sách như quầy phát hành. Truy cập trực tiếp hồ sơ nhận 403. |

Các ca đọc dùng dữ liệu seed có sẵn. Launcher khởi động Agent jCardSim cùng web/mocks, việc đọc Dashboard và hồ sơ không cần thao tác Agent. Dữ liệu được tạo trên replica set riêng của mỗi lần chạy. Nếu máy không tìm thấy `mongod.exe`, đặt `$env:G16_MONGOD` bằng đường dẫn tuyệt đối cài trên máy rồi chạy lại. Nếu chưa có bản Agent, chạy `.\gradlew.bat :agent:installDist` trong thư mục `smartcard` với cache đã cấu hình. [Môi trường fixture](#g16--môi-trường-nghiệm-thu-riêng)

### A. Dashboard và phép đối chiếu

1. Dùng **backup**, mở **http://127.0.0.1:3302/admin/dashboard?month=2026-11**. Fixture mới có **8 quản trị viên**, **210 khách**, **25 đơn mọi thời kỳ**, **10 đơn đặt trong tháng 11**. Khách chưa có thẻ được tính. Trong bảng **Đơn hàng gần đây**, tìm `G3-UNPAID` và `G3-ZALO-NEXT`. Đơn `G3-VNPAY-RESTORED` ở lịch sử tra cứu và góp thu 750.000 đ.
2. Đối chiếu breakdown tháng 11. Tiền mặt **1.200.000**, chuyển khoản **850.000**, VNPay **750.000**, ZaloPay **0**, ví **1.100.000 đ**. Tổng gộp và ròng cùng bằng **3.900.000 đ**. Chart ngày 1 có **1.200.000**, ngày 10 có **850.000**, ngày 12 có **600.000**, ngày 15 có **400.000**, ngày 21 có **100.000** và ngày 30 có **750.000 đ**.
3. Đối soát tháng 11. Nghĩa vụ hoàn phát sinh **1.100.000**, hoàn hoàn tất **0**. Mục *Đối soát toàn thời gian* có **400.000 đ** hoàn đang chờ và hai đơn thiếu thời điểm. Trong hai đơn có một tổng đặt legacy **500.000 đ** chưa xác minh đã thu và một đơn thiếu số tiền. Nạp ví đã thu **950.000**, ghi chip tháng 11 **0**, giữ do hạn mức **250.000**, chờ thanh toán **80.000**, thất bại **20.000 đ**. Ghi nợ chờ xác nhận có **1** khoản **123.000 đ**.
4. Chọn **12/2026**. Thu ZaloPay **200.000**, hoàn qua chip **600.000**, ròng **−400.000 đ**, chart ngày 1 tương ứng. Nạp đã ghi chip **700.000 đ**. F5 giữ tháng và kết quả. Chọn **01/2027**, thấy hoàn tiền mặt khi thu hồi **100.000**, ròng **−100.000 đ**, ngày 1. Chọn **02/2024** để xem tháng 29 ngày và tổng 0, **02/2025** để xem tháng 28 ngày, **04/2026** để xem tháng 30 ngày. Chart so cùng ngày với kỳ trước, các ngày vượt độ dài của một kỳ để trống riêng trên đường của kỳ đó.
5. Mở DevTools **Network**, bật Offline sau khi tải trang và đổi tháng. Vùng số kỳ hiện dấu gạch và báo lỗi, chart cũ ẩn. Tắt Offline, chọn lại một tháng khác và đối chiếu tổng. Lượt tự động đã trì hoãn response tháng 11 cho đến khi tháng 12 hiển thị để kiểm response đến sai thứ tự.

| Order / sự kiện | Mốc VN | Số tiền và kết quả |
|---|---|---|
| `G3-CASH` | 01/11/2026 00:00 | Thu 1.200.000 đ. Đặt đơn ngay trước biên, khách vãng lai. |
| `G3-BANK-ARCHIVED` | 10/11/2026 | Thu 850.000 đ, đơn archived. |
| `G3-VNPAY-RESTORED` | 30/11/2026 23:59:59.999 | Thu 750.000 đ, đơn khôi phục tra cứu. |
| `G3-ZALO-NEXT` | 01/12/2026 00:00 | Thu 200.000 đ, được đặt trong tháng 11. |
| `G3-WALLET-REFUND-DONE`, debit 0301 | 12/11/2026 | Thu ví 600.000 đ, paid+cancel. Credit gốc 0401 ghi nghĩa vụ 25/11, chuyển thẻ; 0411 hoàn tất 01/12, chỉ một khoản 600.000 đ. |
| `G3-WALLET-REFUND-PENDING`, debit 0302 | 15/11/2026 | Thu ví 400.000 đ. Credit 0402 ngày 25/11 còn chờ ghi. |
| `G3-WALLET-CASH-REFUND`, debit 0303 | 21/11/2026 | Thu ví 100.000 đ. Credit 0403 ngày 25/11 kết thúc bằng bút toán tiền mặt 0413 ngày 01/01/2027. |
| `G3-UNPAID`, `G3-CALLBACK-FAILED` | 30/11 và 28/11/2026 | 999.999 đ và 960.000 đ là tổng đơn vẫn chưa thu. |
| `G3-OLD-TIME`, `G3-OLD-AMOUNT` | Thiếu thời điểm settlement | Một tổng đơn 500.000 đ chưa xác minh, một đơn chưa xác định số tiền. |
| Ví 0501, 0502 | 24 và 25/11/2026 | Tiền mặt 700.000 đ ghi chip 01/12; VNPay 250.000 đ đã thu, đang giữ do hạn mức. |
| Ví 0503, 0504, 0505, 0506 | 25–29/11/2026 | 80.000 đ chờ thanh toán; 20.000 đ nạp thất bại; 2.000.000 đ chuyển số dư chờ ghi; 123.000 đ debit đang chờ xác nhận. |

Mã ledger trong bảng dùng bốn ký tự cuối của txRef. Ròng tháng 11 = 3.900.000 − 0, tháng 12 = 200.000 − 600.000, tháng 01 = 0 − 100.000. Số tiền fixture dùng để nghiệm thu công thức quản trị. [Định nghĩa đầy đủ](G3_REPORT.md#quy-ước-số-liệu)

### B. Danh sách và hồ sơ

1. Mở **http://127.0.0.1:3302/admin/user/list**. Gõ `G3 Phan Trang`, bấm **Tìm kiếm**, chọn cỡ **5**, trang **2**. Kết quả **6–10 của 205**. Chọn trang **41**, thấy **201–205 của 205**. Thử F5, Back, Forward và URL trang vượt giới hạn. Cỡ trang có 5/10/20/50/100. Bộ lọc gửi về trang đầu.
2. Tìm `Dang Ha` hoặc `Đặng Hà`, thấy hai khách G3. Lọc **Hoạt động** và **Gold**, còn một **G3 Đặng Hà (Hồ sơ)**. Có thể tìm lại bằng `(Hồ sơ)`, `g3-dang-ha` hoặc `0900000033`. Tìm `.*` cho kết quả rỗng. Xóa lọc và thử **Đã khóa** cùng **Silver**, hoặc **Từng thu hồi và chưa có thẻ hiện hành**. Mỗi tổ hợp trên có một khách fixture.
3. Bấm **Chi tiết** hoặc mở **http://127.0.0.1:3302/admin/user/detail/650000000000000000000003**. Hạng **Gold · 5%**, tổng chi tiêu **30.000.000 đ**, tình trạng thẻ hệ thống **Hoạt động**. Số dư hệ thống **2.500.000 đ**, biên nhận chip cuối **2.500.000 đ** lúc 00:00 ngày 01/12/2026. Ghi có chờ đồng bộ **2.400.000 đ** gồm credit hoàn và chuyển số dư. Ghi có giữ do hạn mức **250.000 đ**, debit chờ **123.000 đ**. Các nhóm chờ hiện riêng số dư.
4. Bấm **Đơn hàng**, kiểm các mã G3 gắn customerId và dòng archived. `G3-CASH` có cùng tên/điện thoại fixture nhưng là khách vãng lai. Bấm **Giao dịch ví**, thử cỡ **5** và trang **3**, thấy **11–14 của 14**. Thấy cả **Chuyển số dư khi cấp lại** và bút toán hoàn tiền mặt khi thu hồi. Bấm **Vé**, thấy vé `G3-ZALO-NEXT` đã ghi. Bấm **Lịch sử thẻ**, thấy thẻ hiện hành đuôi **0310** và thẻ thu hồi đuôi **0309**. So sánh với hồ sơ thẻ đã thu hồi ID `650000000000000000000005` và khách chưa phát hành ID `650000000000000000000006`.
5. Xem lại ở 320/360/390/768/1024/1440 px nếu cần. Khi bảng rộng, cuộn ngang trong khung bảng. Tại hồ sơ, thử tải lại tab ví ở trang đã chọn và Back về tab trước.

### C. Quyền và chốt nghiệm thu

1. Đăng nhập từng tài khoản ở bảng trên trong cửa sổ riêng. Thử trực tiếp `/admin/dashboard`, `/admin/user/list` và hồ sơ khách có `?tab=wallet`, `?tab=orders`. Tài khoản **g3-history** thấy `G3-VNPAY-RESTORED`; `G3-BANK-ARCHIVED` chỉ hiện cho **backup** ở hồ sơ. Tài khoản **g3-customer** không thấy ID thẻ, số dư hoặc lịch sử. ID sai định dạng hoặc ID không tồn tại trả 404 với tài khoản được xem hồ sơ.
2. Sau khi kiểm, bấm **Ctrl+C** tại cửa sổ đã chạy fixture, hoặc gửi lệnh `node scripts/acceptance-g1.cjs --stop <RunID>` với Run ID in ở terminal.
3. Xác nhận kết quả A/B/C và quyết định công thức ròng, dữ liệu legacy, ánh xạ Role theo [gate G3](G3_REPORT.md#gate-chủ-dự-án). Kết quả tay của chủ dự án sẽ được ghi riêng khỏi suite.

## G2.1 · Nghiệm thu hai thay đổi cuối

Mở PowerShell. Nếu terminal nghiệm thu G2 cũ vẫn chạy, bấm Ctrl+C tại terminal đó trước khi mở lượt mới. Mỗi lượt fixture mới có lại toàn bộ dữ liệu seed.

~~~powershell
Set-Location D:\vietnam-travel
node scripts/acceptance-g1.cjs --g2
~~~

Đợi **READY**, ghi **Run ID** rồi mở **http://127.0.0.1:3302/admin/account/login**. Dùng **admin@g1.example.com** để thao tác và **g2-trash@g1.example.com** trong cửa sổ riêng để kiểm quyền xem. Cả hai dùng mật khẩu fixture **G16Fixture-2026!**. Nếu thiếu Agent build, xem [lệnh build Agent](#khởi-động-fixture).

### 1 · Bỏ bộ đếm lựa chọn

Mở các URL dưới đây trên website fixture. Thử ở 360 px và 1440 px. Mở fixture mới khi cần lặp lại các bước đã ghi dữ liệu.

| URL | Dữ liệu và thao tác mẫu |
|---|---|
| `/admin/category/list?keyword=G2+Da+Nang&pageSize=5` | Chọn hai hàng, thử **Dừng hoạt động**. |
| `/admin/category/trash?keyword=G2+Phan+Trang+Rac+Danh+Muc&pageSize=5` | Chọn hai hàng, thử **Khôi phục**. |
| `/admin/tour/list?keyword=G2+Chuyen+Da+Lat&pageSize=5` | Chọn hai hàng, thử **Dừng hoạt động**. |
| `/admin/tour/trash?keyword=G2+Phan+Trang+Rac+Tour&pageSize=5` | Chọn hai hàng, thử **Khôi phục**. |
| `/admin/order/list?q=G2-LIST-&pageSize=5` | Đổi trang, sau đó lọc **Hủy**. Danh sách dùng thao tác đơn lẻ. **G2-LIST-11** có nút **Ẩn đơn**. |
| `/admin/order/trash?q=G2-ARCH-PAGING-&pageSize=5` | Chọn hai hàng, thử **Khôi phục**. |

1. Ở các trang có bulk, thử 0/1/hai/tất cả lựa chọn rồi bỏ chọn. Dùng phím Space và kiểm ô đầu bảng có trạng thái chọn một phần. Ô vẫn 18 × 18 px. Thanh tìm và nút **Áp dụng** giữ vị trí, không hiện **Đã chọn N**. Đổi trang hoặc lọc phải xóa lựa chọn cũ. Tổng bản ghi và phân trang vẫn hiển thị.
2. Chọn hành động rồi bấm **Áp dụng** với 0 mục, thấy nhắc chọn mục. Chọn hai hàng và mở modal. Chọn **Quay lại** thì Network có 0 PATCH. Xác nhận lần sau, có một PATCH và trường `ids` gồm đúng hai hàng đã tích. Tải lại và kiểm kết quả. Trang danh sách đơn thử hủy modal **Ẩn đơn** trước khi xác nhận. Đơn biến khỏi danh sách đang quản lý và xuất hiện trong trash với trạng thái **Hủy**.
3. Trên `/admin/tour/create`, bấm nhãn một điểm xuất phát để chọn và bỏ chọn. Trên `/admin/setting/role/create`, bấm nhãn một quyền. Hai trang vẫn thao tác được bằng nhãn và Space. Thùng rác đơn có lựa chọn **Khôi phục**.

### 2 · Xóa vĩnh viễn danh mục và kiểm điều kiện

1. **Xóa một và clamp.** Mở `/admin/category/trash?keyword=G21+Xoa+Trang&pageSize=5&page=2`. Có một hàng ở trang 2. Bấm icon **Xóa vĩnh viễn** của hàng. Modal nêu thao tác không thể khôi phục. Hủy rồi F5, hàng còn. Mở lại và xác nhận, Network có một PATCH đi tới `/admin/category/delete-destroy/<id>`. Kết quả về trang hiển thị 1/1, còn năm hàng. F5 giữ kết quả và từ khóa. Có thể chọn thêm người xóa **G1 Fixture Admin** để kiểm lọc.
2. **Guard danh mục con.** Mở `/admin/category/trash?keyword=G2+Rac+Danh+Muc`. Thử xóa riêng **G2 Rác Danh Mục Cha**. Thông báo nhắc xóa danh mục con trước. Chọn đúng cha và con rồi thử bulk **Xóa vĩnh viễn**, cả hai vẫn còn sau F5. Nếu kiểm thành công theo thứ tự, xóa riêng **G2 Rác Danh Mục Con** trước, sau đó xóa cha ở một thao tác khác.
3. **Bulk và guard tour.** Mở `/admin/category/trash?keyword=G21+Bulk`. Có ba mục **G21 Bulk Trống 01–03** và **G21 Bulk Có Tour**. Chọn cả bốn, áp dụng **Xóa vĩnh viễn** và xác nhận. Trang báo còn tour tham chiếu, F5 vẫn đủ bốn. Chọn lại chỉ ba mục trống, thử hủy modal rồi xác nhận. Có một PATCH tới `/admin/category/trash/change-multi` với `option` là `delete-destroy` và đúng ba ID. F5 chỉ còn **G21 Bulk Có Tour**. `/admin/tour/trash?keyword=G21+Tour` vẫn có **G21 Tour Đã Xóa Mềm**.
4. **Quyền và khôi phục.** Mở lại `/admin/category/trash?keyword=G21` bằng **g2-trash@g1.example.com**. Xem được dữ liệu, không có checkbox, nút Áp dụng hoặc nút sửa dữ liệu. Với admin, có thể khôi phục một mục **G21 Xóa Trang** còn lại. Sau F5 mục rời trash, xuất hiện trong `/admin/category/list?keyword=G21+Xoa+Trang`.

Ghi **PASS / FAIL** cho từng nhóm cùng Run ID và viewport. Dừng fixture bằng Ctrl+C trong terminal launcher hoặc chạy lệnh sau và nhập mã từ dòng **Run ID**.

~~~powershell
$fixtureRun = Read-Host 'Nhập Run ID của fixture'
node scripts/acceptance-g1.cjs --stop $fixtureRun
~~~

## G2 · Nghiệm thu danh mục, tour và đơn

Chủ dự án đã xác nhận **6/6 nhóm** của lượt này. Phần dưới lưu các ca G2 để đối chiếu.

### Khởi động fixture

Tại D:\vietnam-travel, chạy lệnh dưới đây bằng PowerShell. Launcher tạo Mongo replica set mới và kiểm tên DB, thư mục dữ liệu và tiến trình trước khi seed. Nếu cổng đã có tiến trình sử dụng, launcher sẽ dừng.

~~~powershell
node scripts/acceptance-g1.cjs --g2
~~~

Đợi dòng **READY** và lưu **Run ID**. Website ở **http://127.0.0.1:3302**, đăng nhập tại **/admin/account/login**. Các tài khoản này cùng dùng mật khẩu fixture **G16Fixture-2026!**.

| Tài khoản | Phạm vi |
|---|---|
| admin@g1.example.com | Đủ quyền, hiển thị là **G1 Fixture Admin**. Dùng cho sáu nhóm chính. |
| backup@g1.example.com | Đủ quyền, hiển thị là **G1 Fixture Backup**. Một số bản ghi được tạo hoặc xóa bởi tài khoản này. |
| g2-reader@g1.example.com | Xem ba danh sách và chi tiết đơn. Các URL thùng rác trả 403. |
| g2-trash@g1.example.com | Xem thùng rác danh mục và đơn. CTA khôi phục vắng mặt. URL thùng rác tour trả 403. |
| g2-editor@g1.example.com | Tạo/sửa danh mục và tour, sửa đơn. Có bulk đổi trạng thái danh mục/tour. URL xóa và thùng rác trả 403. |

Nếu thiếu Agent build, chạy các lệnh sau rồi khởi động lại fixture.

~~~powershell
Push-Location smartcard
.\gradlew.bat :agent:installDist
Pop-Location
~~~

Agent fixture dùng 127.0.0.1:32033. Sáu nhóm bên dưới dùng dữ liệu đã seed. Khi cần quan sát Agent, chạy **node scripts/simulator-console.cjs** ở terminal khác rồi mở **http://[::1]:3304/**. Console có bốn slot. Khi cần Tiny Cloud, đặt **G18_TINYMCE_API_KEY** trong terminal launcher và dùng hostname đã duyệt. Ô HTML vẫn dùng được khi thiếu cấu hình editor. Mail, ảnh và thanh toán dùng mock cục bộ.

Hai mốc UTC **27/11/2026 16:59:59.999** và **17:00:00.000** thuộc hai ngày **27/11** và **28/11** theo giờ Việt Nam. Khi nhập bộ lọc, dùng ngày hiển thị trên website.

### 1 · Danh mục đang quản lý

1. Mở **/admin/category/list**, nhập **G2 Da Nang** và Enter. Thấy 13 bản ghi. Chọn cỡ 5, trang 2 rồi thử F5, Back, Forward và mở lại URL. Hai trang có các mục riêng. Thử các cỡ 10/20/50/100 và đối chiếu khoảng hiển thị.
2. Chọn đồng thời **Hoạt động**, người tạo **G1 Fixture Admin** và ngày **28/11/2026** ở hai ô. Mỗi lần chọn áp dụng ngay và về trang đầu. Còn 12 kết quả, **G2 Đà Nẵng 12** nằm ngoài bộ lọc. Bấm **Xóa bộ lọc** để về danh sách mặc định.
3. Ở 360 px, bấm một ô rồi bấm chọn tất cả. Kích thước ô là 18 × 18 px, ô đầu bảng hiện trạng thái chọn một phần khi mới tích một mục. Chọn **Dừng hoạt động**, bấm **Áp dụng** rồi hủy modal, kiểm Network có 0 PATCH. Lặp lại với riêng **G2 Đà Nẵng 03**, xác nhận rồi bật lại bằng hành động **Hoạt động**.
4. Tạo **G2 Danh mục nghiệm thu**, cha **G2 Đà Nẵng Gốc**, vị trí 101. Bấm sửa, đổi mô tả và tải lại. Ảnh đã lưu giữ nguyên khi chưa xóa hoặc thay. Thử vị trí -1, nhận lỗi và kiểm dữ liệu cũ. Khi sửa danh mục gốc, cây chọn cha loại chính nó và các nhánh con. Thử xóa danh mục gốc hoặc **G2 Đà Nẵng 01**, nhận lỗi do còn con hoặc tour. Xóa mềm mục vừa tạo để chuyển sang nhóm 2.

### 2 · Thùng rác danh mục

1. Bấm **Thùng rác** hoặc mở **/admin/category/trash**. Tìm **G2 Phan Trang Rac Danh Muc**, chọn cỡ 5 rồi trang 2, thấy **6–10 của 12**. Reset rồi tìm **G2 Rac Danh Muc**. Lọc người xóa **G1 Fixture Admin** và ngày **28/11/2026**. Còn hai hàng **G2 Rác Danh Mục Cha** và **G2 Rác Danh Mục Con**.
2. Khôi phục riêng dòng con, xác nhận và thấy lỗi vì cha vẫn trong thùng rác. Chọn cả cha và con, áp dụng **Khôi phục**. Hủy một lượt rồi xác nhận. Hai hàng rời thùng rác. Trạng thái của cha là **Hoạt động**, của con là **Tạm dừng**.
3. Reset và tìm **G2 Rác Danh Mục Cũ**. Cột người/ngày/trạng thái trước xóa hiện **Không có dữ liệu**. Khôi phục đơn lẻ, kết quả **Tạm dừng**. Khôi phục mục vừa xóa ở nhóm 1. Trang gồm các thao tác khôi phục đã duyệt.
4. Thử phiên **g2-reader** và **g2-trash**. Reader nhận 403 khi mở URL. Trash role thấy dữ liệu, các checkbox và nút khôi phục được ẩn. Log Mongo đã bao phủ cạnh tranh xóa danh mục và gắn tour ở hai tiến trình.

### 3 · Tour đang quản lý

1. Mở **/admin/tour/list**, tìm **G2 Chuyen Da Lat**, thử cỡ 5 và trang 2. Kết hợp danh mục **G2 Đà Nẵng 01**, **Hoạt động**, **G1 Fixture Admin**, **Từ 2 đến dưới 4 triệu** và ngày tạo **28/11/2026**. Còn 11 tour. Giá lọc dựa trên giá bán người lớn. Ngày khởi hành nằm trong form tour.
2. Chọn **G2 Chuyến Đà Lạt 01**, áp dụng **Dừng hoạt động** rồi xác nhận. Tour rời kết quả **Hoạt động**. Mở qua bộ lọc **Tạm dừng**, bật lại. Thử chọn tất cả trên trang và hủy modal.
3. Tạo **G2 Tour nghiệm thu**. Chọn danh mục **G2 Đà Nẵng 01**, điểm xuất phát **Hà Nội - G1 fixture**, vị trí 120, ngày khởi hành 29/11/2031, thời lượng **2 ngày**, giá người lớn cũ **1.000.000**, giá mới **900.000**, giá em bé **0** và chỗ người lớn **7**. Thử giá mới **1.200.000** để xem lỗi. Nhập hai lịch trình, mô tả và vài ảnh album. Lưu, mở trang sửa, đổi phương tiện, sắp ảnh và tải lại. Đối chiếu VND, giá em bé, chỗ, thứ tự ảnh và định dạng mô tả.
4. Đưa tour vừa tạo vào thùng rác bằng chọn hàng và **Xóa**, thử hủy trước rồi xác nhận. Tour rời danh sách. URL chi tiết Client của tour trả 404. Kho, vé và đơn lịch sử giữ nguyên.

### 4 · Thùng rác tour

1. Mở **/admin/tour/trash**. Tìm **G2 Phan Trang Rac Tour**, thử cỡ 5 và trang 2. Reset, tìm **G2 Rac Tour**, chọn người xóa **G1 Fixture Admin** và ngày **28/11/2026**. Còn **G2 Rác Tour Chưa Đặt**. Xác nhận khôi phục và kiểm trạng thái **Hoạt động**.
2. Tìm **G2 Rác Tour Có Vé**, xác nhận **Xóa vĩnh viễn** và kiểm thông báo chặn do có đơn lịch sử. Dùng **G1 Trash Thiếu Danh Mục** để kiểm chặn khôi phục. Chọn tập nhiều mục có một mục không đủ điều kiện và đối chiếu cả tập giữ nguyên.
3. Tìm **G2 Tour nghiệm thu** vừa xóa. Hủy modal xóa hẳn một lượt và kiểm Network. Xác nhận sau đó với bản ghi fixture chưa có đơn. Tìm lại tên này phải rỗng.

### 5 · Đơn đang quản lý

1. Mở **/admin/order/list**. Tìm **G2-LIST-**, **Dang Ha G2** hoặc số fixture **0900000044**. Với **G2-LIST-**, chọn cỡ 5 và trang 2, sau đó lọc **Khởi tạo**, **Chuyển khoản ngân hàng**, **Chưa thanh toán**, ngày đặt **28/11/2026**. Trước khi thử hủy có 5 kết quả.
2. Mở **G2-LIST-02**, sửa ghi chú, lưu và tải lại. Bấm **Quay lại danh sách** để kiểm query đã dùng. Đối chiếu mã đơn, tổng, giảm giá và snapshot tour. **G2-LIST-01** là ZaloPay đã thanh toán, có trường phương thức và trạng thái thanh toán chỉ đọc.
3. Tại **G2-LIST-02**, chọn **Hủy**, bấm **Cập nhật**, thử hủy modal và kiểm Network. Xác nhận lần sau, thấy đơn **Hủy**. Về danh sách, tìm mã đơn rồi **Ẩn đơn**. **G2-USED** có vé đã check-in và không chọn được Hủy. **g2-reader** mở được chi tiết ở chế độ chỉ đọc.
4. Để thử ghi nhận thanh toán tay, dùng đơn fixture chưa thanh toán bằng tiền mặt hoặc chuyển khoản. Sau khi kiểm số tiền fixture, chọn **Đã thanh toán** và xác nhận modal. Đơn gateway/ví giữ quy trình callback hoặc biên nhận của G1.
5. Khi kiểm dự phòng, chặn JavaScript trên trang sửa đơn fixture. Dùng **G2-LIST-03**, sửa ghi chú và lưu. Network hiển thị POST tới URL sửa đơn rồi 303, trang tải lại có ghi chú mới. Thử đổi trạng thái đơn và lưu khi script còn bị chặn. Trang báo cần bật JavaScript để xác nhận, trạng thái giữ nguyên.

### 6 · Thùng rác đơn và dữ liệu lịch sử

1. Mở **/admin/order/trash**, tìm **G2-ARCH-PAGING-**, chọn cỡ 5, đổi trang và F5. Reset, tìm **Dang Ha G2**, lọc **Hủy**, **Đã thanh toán**, **Ví thẻ thành viên**. Có **G2-ARCH-PENDING** và **G2-ARCH-DONE**. Lọc thêm người xóa **G1 Fixture Admin** và ngày **28/11/2026** để chỉ còn **G2-ARCH-PENDING**. Dùng **G2-ARCH-LEGACY** để kiểm metadata thiếu.
2. Bỏ lọc người/ngày, chọn cả hai đơn ví và áp dụng **Khôi phục**. Thử hủy trước rồi xác nhận. Hai đơn xuất hiện ở danh sách Admin, vẫn **Hủy** và **Đã thanh toán**. Chi tiết chỉ đọc còn mã hoàn, một khoản chờ ghi lên thẻ và một khoản đã ghi. Khôi phục đơn khách **G2-LIST-02** đơn lẻ, đơn vẫn **Hủy**. Các bản ghi chỉ mở lại để tra cứu Admin.
3. Xem [kiểm thử G2](G2_REPORT.md#kiểm-thử) để đối chiếu snapshot Mongo, kho, vé, ledger, restore lặp và rollback. Trang đơn chỉ cung cấp các thao tác khôi phục đã duyệt.
4. Tìm **G1-TRASH-ORDER** và khôi phục. Bản ghi legacy này có trạng thái **Khởi tạo**. Nó rời thùng rác, xuất hiện trong danh sách Admin và trang chi tiết chỉ đọc hiển thị **Đơn lịch sử đã khôi phục để tra cứu**. Trạng thái gốc giữ nguyên qua ca này.

Kiểm các thao tác chính ở desktop và mobile. Có thể dùng DevTools ở 320, 360, 390, 768, 1024 và 1440 px. Bảng cuộn trong vùng bảng, bộ lọc và nút vẫn sử dụng được. Ghi kết quả từng nhóm và che tên khách, điện thoại, thông tin phiên trong ảnh hoặc log nếu dùng dữ liệu ngoài fixture.

Dừng launcher bằng Ctrl+C hoặc **node scripts/acceptance-g1.cjs --stop RUN_ID** với ID vừa in. Nếu đã mở Console, dừng terminal Console bằng Ctrl+C. Lượt fixture mới tạo lại bộ dữ liệu ban đầu.

## Admin

| Ca | Vào trang, thao tác và dữ liệu fixture | PASS khi |
|---|---|---|
| A01 · đăng nhập, quyền | Với Admin đủ quyền, mở `/admin/account/login`, nhập thông tin fixture, mở Dashboard và đăng xuất. Lặp với người chưa đăng nhập, tài khoản tạm dừng và vai trò giới hạn theo ma trận. | Menu và điều hướng đúng, route được phép chạy, route thiếu quyền bị từ chối, phiên vừa đăng xuất không xem thêm dữ liệu bảo vệ. |
| A02 · Dashboard | Vai trò có `dashboard-view`. Mở `/admin/dashboard`, chọn tháng rỗng, tháng 2 và mốc tháng 1. Fixture có unpaid, paid, hủy, refund chờ chip, refund done và nạp ví. | Số hiển thị khớp bảng chuẩn của G3, tháng đúng ngày VN, nạp ví không cộng doanh thu, refund không gộp vào tiền đã ghi chip. Bảng đơn mới là đơn fixture. |
| A03 · TEST 09 A/B hồi quy | Admin có quyền danh mục. Ở `/admin/category/list`, lọc trạng thái/người tạo/từ ngày/đến ngày, gõ tên có dấu và không dấu, đổi trang, reset. Thử giá trị không khớp, reload và đổi page size khi có. | Không lỗi trang âm/vượt, URL giữ filter, từ khóa và danh sách khớp. Tổng, số hiển thị và trạng thái rỗng chính xác. |
| A04 · TEST 09 C và trash | Fixture gồm cha/con, danh mục gắn tour và danh mục trống. Tạo/sửa với tên/slug trùng, vị trí âm, cha không hợp lệ, giữ ảnh khi không tải lại. Đổi trạng thái một/hàng loạt, xóa đúng mục. Sau G2, mở trash, tìm, lọc người/ngày xóa, khôi phục một/nhiều. | Ghi dữ liệu hợp lệ, từ chối trùng/cycle/sai cha/tham chiếu; không tạo mồ côi. Giữ ảnh cũ. Xóa hẳn chỉ trong trash và theo policy. Kiểm lại hiển thị Client sau đổi trạng thái. |
| A05 · Tour | Mở `/admin/tour/list`, tạo/sửa fixture với các mức giá, stock, thời gian, vị trí, danh mục, album và lịch trình. Thử ngày sai, giá âm, sai danh mục và ảnh lỗi. Dùng list/chọn hành động bulk và trang trash sau G2. | Giá/tồn/vị trí hợp lệ, album/snapshot đúng. Quản lý được tập bản ghi đã chọn. Đơn/vé liên quan giữ nguyên khi tour bị ẩn. |
| A06 · Đơn | `/admin/order/list`, nhập mã đơn/tên/điện thoại, lọc trạng thái và ngày. Mở đơn fixture, xem chính sách hủy, sửa trường được phép, hủy đơn chưa dùng vé hoặc xem ca từ chối với vé đã check-in. | Query và page giữ điều kiện. Sau hủy hợp lệ, kho hoàn đúng một lần. Nghiệp vụ ví, receipt, refund và vé xem SC08/SC11 bên dưới. |
| A07 · Khách | `/admin/user/list`. Tìm tên/email/điện thoại fixture. So khách chưa có thẻ, active, locked, revoked. Sau G3, xem chi tiết/lịch sử/hạng và page. | Kết quả và trạng thái đúng. Vai trò giới hạn thấy dữ liệu đúng quyền. Giao diện không có trường sửa trực tiếp PIN hoặc số dư. |
| A08 · Liên hệ và Settings | `/admin/contact/list` và `/admin/setting/list`. Dùng email giả, kiểm format/trùng. Cập nhật website info trong fixture, giữ logo khi không đổi và thử ảnh sai. | Dữ liệu hợp lệ và badge/page thật sau G5. Tài khoản thiếu quyền bị chặn. Khi cập nhật hợp lệ, tên/ảnh/liên hệ thấy đúng trên cả hai giao diện. |
| A09 · Tài khoản và Role | `/admin/setting/account-admin/list`, `/admin/setting/role/list` và `/admin/profile/edit`. Thử xem/sửa với vai trò phù hợp và vai trò hạn chế. Đổi mật khẩu và kiểm quản trị viên cuối, Role đang dùng, tài khoản đã gắn thẻ. | Chỉ sửa trường hợp lệ, Role đang dùng được bảo vệ, quyền ngoài phạm vi bị chặn, session và thẻ tuân policy sau thay đổi. |
| A10 · Responsive | Các trang trên ở 320/390/768/1280px. Bấm menu, Tab, Esc, nút icon, dropdown, modal xác nhận và thao tác quay lại. | Điều hướng được bằng bàn phím, focus trở lại khi đóng modal, bảng còn thao tác được, không có lỗi JS bất ngờ. |

## Client

| Ca | Vào trang, thao tác và dữ liệu fixture | PASS khi |
|---|---|---|
| C01 · Điều hướng | Mở `/`, kiểm logo, header/footer, menu mobile, cart, đăng nhập, danh mục, các link hỗ trợ và email nhận tin. | Link có đích thật hoặc được loại theo phạm vi đã duyệt. Tải script một lần, console sạch, thông tin chỉnh ở Settings hiển thị đúng. |
| C02 · Tìm và danh mục | `/category/:slug`, `/search`. Lọc nơi đi/nơi đến/ngày/số khách/giá, đổi sort/page và reload. Fixture có cha inactive, tour inactive, tour đã xóa, kết quả rỗng. | Rule hiển thị nhất quán ở Home, listing, search và route trực tiếp. Kết quả đúng điều kiện, filter/page còn sau reload. |
| C03 · Chi tiết/giỏ | Mở `/tour/detail/:slug`, thử album, lịch trình, số người lớn/trẻ/em bé, thêm giỏ và qua `/cart`. Sửa số người, xóa item, thử tour hết chỗ và autofill thẻ test. | Giá hiển thị khớp server, không cho vượt tồn, cart có thể phục hồi lỗi, autofill đúng chủ và không phụ thuộc Agent để đặt guest. |
| C04 · Checkout và trạng thái | Đặt fixture theo phương thức được hỗ trợ, ghi mã đơn, thử nhấn lại/giả lập mất phản hồi, mở trang success/processing. Dùng sandbox được duyệt hoặc fixture callback. | Kho và order khớp đúng một giao dịch; reload có trạng thái thật; không lộ đơn của người khác; lịch sử hiển thị được tour đã ẩn. |
| C05 · Lỗi/Responsive | Home, search/form, detail, cart, success và login thẻ trên các viewport. Đổi mạng/Agent fixture, xem lỗi, reload và dùng bàn phím. | Có trạng thái loading/rỗng/lỗi phù hợp, thao tác tiếp tục được, không lộ log chi tiết và không ghi trùng. |

Một số ca nêu tiêu chí của giai đoạn sau và đang chờ triển khai theo tracker. Khi kiểm baseline, ghi kết quả quan sát cho từng bước hiện có.

## Smart Card và hoàn tiền

Tái sử dụng [mục lục 00–22, 90–92](huong-dan-test-the/README.md). Sơ đồ slot trong bộ tài liệu chỉ dùng khi môi trường test riêng đã chuẩn bị đúng. Ghi riêng kết quả qua applet, Agent HTTP, browser web/Mongo, vận hành demo và thiết bị thật.

| Ca | Hướng dẫn gốc | Điểm xác nhận bổ sung ở HEAD |
|---|---|---|
| SC-DEMO 01 | [01 Nhân viên](huong-dan-test-the/01-phat-hanh-the-nhan-vien.md) và [03 Khách](huong-dan-test-the/03-phat-hanh-the-khach-hang.md) | Cắm slot fixture trống, hoàn tất UI ba khu vực, kiểm PIN hiển thị một lần, dừng ở lỗi trường hợp khoảng trắng, ghi tình trạng chờ khi mất Agent. |
| SC-DEMO 02/03 | [02 Admin](huong-dan-test-the/02-dang-nhap-admin-bang-the.md), [04 Khách](huong-dan-test-the/04-khach-dang-nhap-bang-the.md), [05 Thẻ của tôi](huong-dan-test-the/05-trang-the-cua-toi.md) | Đổi PIN lần đầu và chủ động. PIN yếu, trùng ngày sinh, nhập lại sai đều có phản hồi rõ. Tự phát hành cho mình kết thúc session mật khẩu cũ. |
| SC-DEMO 04/05 | [05 Thẻ của tôi](huong-dan-test-the/05-trang-the-cua-toi.md) và [21 Hồ sơ/ảnh](huong-dan-test-the/21-sua-ho-so-anh-tren-the.md) | Đọc, ghi và đọc lại hồ sơ/ảnh fixture đúng thẻ. Ngắt kết nối giữa các bước để kiểm khả năng phục hồi. |
| SC-DEMO 06/07 | [15 Khóa và reset PIN](huong-dan-test-the/15-sai-pin-khoa-pin-reset-pin.md) | Sai 5 lần trên thẻ test, thấy PIN bị khóa. Admin reset qua step-up trên đúng thẻ, ví/vé giữ nguyên, PIN cần đổi lần đầu. Trạng thái PIN và trạng thái server hiển thị tách biệt. |
| SC08 · Ví/Vé | [06 Nạp tiền](huong-dan-test-the/06-nap-tien-mat-tai-quay.md), [07 Nạp online](huong-dan-test-the/07-nap-online-vnpay-zalopay.md), [08 Trả ví](huong-dan-test-the/08-dat-tour-thanh-toan-vi-the.md), [09 Ghi vé](huong-dan-test-the/09-ghi-ve-len-the-dong-bo.md) | Kiểm biên tiền mặt 10.000/20.000.000, daily cap, trần ví 50.000.000, trừ ví/cộng chi tiêu một lần, ghi vé và gửi lại an toàn. |
| SC10 · Check-in | [10 Check-in](huong-dan-test-the/10-check-in-tour.md) | Lọc theo chuyến. Kiểm vé hợp lệ, sai người/tour/ngày, vé đã dùng và số hành khách. |
| SC11 · Hoàn tiền | [11 Hủy đơn](huong-dan-test-the/11-huy-don-xoa-ve.md) và [16 Đối soát](huong-dan-test-the/16-dong-bo-doi-soat-bien-nhan.md) | Đơn ví paid với debit đã xác nhận. Hủy thấy một credit chờ, hoàn kho/giảm chi tiêu đúng một lần và vé chờ xóa. Sau sync, kiểm receipt và số dư chip. Cap held, đã check-in, thiếu biên nhận và thẻ cấp lại kiểm bằng fixture riêng. |
| SC12–16 · Vòng đời | [12 OTP](huong-dan-test-the/12-khach-bao-mat-the-otp.md), [13 Trạng thái](huong-dan-test-the/13-khoa-mo-khoa-thu-hoi-the.md), [14 Cấp lại](huong-dan-test-the/14-cap-lai-the.md), [16 Đối soát](huong-dan-test-the/16-dong-bo-doi-soat-bien-nhan.md) | OTP hết hạn/đã dùng, giữ số dư/chờ giao dịch; cấp lại chỉ một lần; session cũ không ghi tiếp. Kiểm thao tác từ chối khi sai thẻ, mất confirm và giao dịch reconciliation. |
| SC17–22 · Hiển thị | [17 Danh sách](huong-dan-test-the/17-danh-sach-chi-tiet-the.md), [18 Nhật ký](huong-dan-test-the/18-nhat-ky-the.md), [19 Dashboard](huong-dan-test-the/19-thong-ke-dashboard.md), [20 Khách](huong-dan-test-the/20-quan-ly-khach-hang.md), [22 Logout](huong-dan-test-the/22-dang-xuat-phien-the.md) | Một menu active, role đọc không thấy CTA vượt quyền, log read-only và không chứa dữ liệu bí mật, trạng thái ví và khách hiển thị đúng. |
| SC-CLI · Recovery | [92 Hạn chế và xử lý sự cố](huong-dan-test-the/92-han-che-va-xu-ly-su-co.md) | Nghiệm thu sau khi G1.4 được duyệt, trên database fixture. Dry run giữ nguyên account/Card/Log; kiểm từ chối khi còn thẻ active, rollback khi audit lỗi, phiên cũ và phát hành lại. |

**FAIL** khi điều kiện cột cuối không thỏa, giao diện gây thao tác sai hoặc quan sát có lỗi không mong đợi. **BLOCKED/NOT_RUN** cần nêu điều kiện cụ thể kèm lớp test.

## Kiểm tra thay đổi Giai đoạn 1

Khởi động bản test theo mục G1.6 bên dưới. Mỗi ca chỉ ghi dữ liệu fixture. Ghi PASS khi đạt cột cuối, FAIL khi phản hồi sai hoặc có thay đổi ngoài dự kiến.

| Ca | URL, vai trò và thao tác | PASS khi |
|---|---|---|
| G1-A01 · Quyền và lỗi | Vai trò chỉ có `category-view` đăng nhập tại `/admin/account/login`. Mở Dashboard, cấu hình hoặc chỉnh tour bằng link trực tiếp. Sau đó mở `/admin/g1-khong-ton-tai` và xem HTTP status trong Network. Vai trò có dashboard mở lại dashboard. | Trang đích của role giới hạn là danh mục. Route thiếu quyền trả 403, route lạ trả 404 với giao diện cũ, route hợp lệ hiển thị bình thường. |
| G1-A02 · Profile | Admin fixture mở `/admin/profile/edit`, cập nhật tên/điện thoại, thử không chọn ảnh rồi thử ảnh hợp lệ. Qua `/admin/profile/change-password`, gửi mật khẩu hiện tại sai, gửi xác nhận lệch rồi đổi hợp lệ. Dùng hai cửa sổ đã đăng nhập để kiểm phiên cũ. | Email đăng nhập chỉ đọc, ảnh cũ còn khi không có ảnh mới, mật khẩu chỉ đổi với xác minh hợp lệ. Cả phiên cũ không còn quyền. Tài khoản yêu cầu thẻ vẫn cần thẻ khi đăng nhập lại. |
| G1-A03 · Cấu hình và quyền | Trên fixture đặt một Role quản trị đầy đủ và một Role hạn chế. Thử vào `/admin/setting/role/list`, `/admin/setting/account-admin/list`, `/admin/setting/website-info`, `/admin/contact/list`. Thử gán Role hợp lệ, quyền ngoài phạm vi hoặc thay đổi quản trị viên cuối bằng tài khoản có quyền thao tác. | Route phục vụ đúng quyền. Gán vượt phạm vi, Role không tồn tại, tự đổi quyền và làm mất quản trị viên cuối đều bị chặn. Không đổi `cardRequired` từ form. |
| G1-A04 · Tour và upload | `/admin/tour/create` hoặc `/admin/tour/edit/:id`. Chọn ảnh JPEG/PNG hợp lệ, ảnh sai loại và ảnh vượt 5 MB; nhập đoạn văn có chữ đậm, bảng và link HTTP(S). Mở tour ở Client. | File sai bị từ chối, ảnh cũ được giữ nếu không gửi file mới. Nội dung hợp lệ được hiển thị, URL và nội dung ngoài allowlist bị bỏ. |
| G1-A05 · Trash và lịch sử | `/admin/tour/list` rồi `/admin/tour/trash`. Fixture gồm tour chưa có đơn, tour có đơn đã xóa mềm và tour không còn danh mục. Xóa mềm tour trước, thử xóa hẳn theo cả một và nhiều mục, rồi thử restore. | Tour trống trong trash có thể xóa hẳn, tour có tham chiếu được bảo vệ. Bulk có một mục không hợp lệ giữ nguyên tất cả. Restore chỉ với tour trash có danh mục hợp lệ và khôi phục được trạng thái cũ đã lưu. |
| G1-C01 · Trả ví/checkout | `/tour/detail/g1-tour-co-cho` → `/cart`, chọn City fixture, đổi số khách và kiểm giá sau đặt. Thử tour `g1-tour-het-cho`. Chạy ca SC08, SC11. | Giá/tổng và tồn kho khớp server, lỗi không làm trừ một phần. Hồ sơ đơn thuộc đúng khách. Hoàn tiền và vé giữ hành vi SC08/SC11. |
| G1-A06 · OTP | `/admin/account/forgot-password`. So `backup@g1.example.com` với một địa chỉ fixture chưa tồn tại. Đọc mã ở hộp thư mock. Thử OTP sai, OTP đã quá 5 phút và OTP đã dùng. Hoàn tất đổi mật khẩu trong luồng reset. Lặp với `admin@g1.example.com` sau khi đã gắn thẻ nhân viên. | Phản hồi gửi đồng nhất, giới hạn hoạt động, chỉ có token reset, OTP dùng một lần. Đổi mật khẩu không tạo phiên quản trị và không bỏ yêu cầu thẻ. |
| G1-A07 · Phân trang | `/admin/category/list` với Role có quyền. Fixture trên 10 bản ghi và một bộ lọc kết quả rỗng. Lần lượt chọn 5/10/20/50/100, đổi trang, đổi trạng thái/từ khóa, xóa bản ghi cuối trang và bấm reset. | Mặc định 10, số trang/tổng/range đúng, điều kiện lọc vẫn còn khi đổi size/page. Khi đổi lọc về trang 1, xóa mục cuối clamp xuống, không có skip âm. |
| G1-UI · Thẻ và Client | Mở `/admin/card/list` bằng Role chỉ có `card-view` và Role có `card-issue`. Mở `/account/login`, xem Network/console ở 390px và thử menu, form nhập PIN với Agent test. | Chỉ người có `card-issue` thấy CTA. Script chung tải một lần, menu vẫn mở và không có lỗi khai báo trùng. |

## G1.6 · Môi trường nghiệm thu riêng

Trong PowerShell, dùng Node.js và Java 17 đã cài. Script ưu tiên Agent đã build ở `smartcard/agent/build/install/agent/lib` hoặc lớp Java của G0 ở `.superpowers/audit-phase0/java`. Nếu chưa có cả hai, chạy `cd D:\vietnam-travel\smartcard` rồi `.\gradlew.bat :agent:installDist` để build Agent trước. Script tự tìm `mongod.exe` dưới `C:\Program Files\MongoDB\Server`. Khi MongoDB nằm chỗ khác, đặt `$env:G16_MONGOD = 'C:\duong-dan-tuyet-doi\mongod.exe'` bằng đường dẫn thực tế.

```powershell
Set-Location -LiteralPath 'D:\vietnam-travel'
node .\scripts\acceptance-g1.cjs
```

Chờ dòng `READY`, giữ cửa sổ PowerShell này mở và vào [website fixture](http://127.0.0.1:3302/). Dùng đúng `127.0.0.1` cho website vì đây là Origin được Agent cho phép. Nếu cổng đang bận, script dừng trước khi khởi tạo. Mỗi lần khởi động dùng thư mục DB mới dưới `.superpowers/g16-manual`. Script in đường dẫn để tra log. Cấu hình và khóa riêng của demo không được đọc vào tiến trình fixture. Khóa ký Agent là khóa test theo repo, còn khóa escrow và session tạo riêng cho từng lượt fixture. Browser dùng kết nối CDN của giao diện hiện có để tải các thư viện như JustValidate và TinyMCE.

| Dịch vụ | Địa chỉ và dữ liệu |
|---|---|
| Website | `http://127.0.0.1:3302`. Đăng nhập Admin tại `/admin/account/login`, đăng nhập khách bằng thẻ tại `/account/login`. |
| MongoDB | `127.0.0.1:27022`, replica set `vtG16Manual`, database `vietnam-travel-g16-acceptance-<mã-lượt>`. Bước seed kiểm tra PRIMARY, tên replica set, thư mục dữ liệu và database rỗng. |
| Card Agent | `http://127.0.0.1:32033/v1/status`, jCardSim, bốn slot mới. Origin cho phép duy nhất `http://127.0.0.1:3302`. |
| Hộp thư mock | [Hộp thư fixture](http://localhost:3303/mailbox). Thư hiển thị mới nhất trước, chỉ nhận địa chỉ `@g1.example.com`. Mã OTP nằm trong thư fixture, không ghi vào log. |
| Cổng thanh toán | VNPay và ZaloPay mock ở `http://localhost:3303`. Nhấn **Xác nhận thanh toán mô phỏng** để chạy callback fixture rồi về website. Địa chỉ `localhost` của cổng tạo hành trình khác site với website trên `127.0.0.1`. |
| Cloudinary | Upload ảnh thông thường trả ảnh từ máy loopback. Upload avatar thẻ mock trả URL ảnh đại diện giả lập, còn byte ảnh dùng để ghi và đọc chip vẫn qua Agent. |

Các tài khoản Admin fixture dùng mật khẩu `G16Fixture-2026!` ban đầu. Chỉ dùng mật khẩu này trong môi trường nghiệm thu.

| Tài khoản | Quyền và mục đích |
|---|---|
| `admin@g1.example.com` | Toàn bộ permission đang khai báo. Dùng cho CRUD và phát hành thẻ nhân viên cho chính tài khoản này nếu cần kiểm step-up. |
| `backup@g1.example.com` | Toàn bộ permission, chưa gắn thẻ lúc seed. Dùng để vào lại fixture khi tài khoản Admin chính đã đổi mật khẩu hoặc đang nghiệm thu thẻ. |
| `viewer@g1.example.com` | Chỉ `category-view`, dùng kiểm trang đích, danh mục và từ chối truy cập Dashboard hoặc sửa dữ liệu. |
| `cardreader@g1.example.com` | Chỉ `card-view`, dùng kiểm danh sách thẻ, CTA và route phát hành. |
| `customer@g1.example.com` | Hồ sơ khách mẫu, ngày sinh 03/02/1990. Phát hành thẻ khách cho hồ sơ này trong fixture để lấy PIN mới và đăng nhập. |

Dữ liệu mẫu gồm 12 danh mục, City **Hà Nội - G1 fixture**, tour có 12 chỗ người lớn giá 300.000 đồng, tour đã hết chỗ, ba tour trash gồm trống, có đơn xóa mềm và thiếu danh mục. Trong Admin có đơn `G1-LEGACY` để kiểm quyền trên dữ liệu guest cũ, đơn `G1-TRASH-ORDER` đã xóa mềm và đơn ví chưa thanh toán `G1-WALLET`. Sử dụng [tour có chỗ](http://127.0.0.1:3302/tour/detail/g1-tour-co-cho) để tạo đơn guest mới có chứng cứ sở hữu. Dùng `public\assets\images\product-1.jpg` khi cần tệp ảnh hợp lệ.

Tại cửa sổ PowerShell thứ hai, chọn slot nhân viên hoặc khách riêng. Lệnh dưới đây chỉ chuyển slot trên cổng fixture. Dùng `$g1Slot = 0` cho nhân viên, `$g1Slot = 1` cho khách và đổi khi luồng yêu cầu cắm lại thẻ.

```powershell
$g1Slot = 0
Invoke-RestMethod -Uri 'http://127.0.0.1:32033/v1/sim/slot' -Method Post -ContentType 'application/json' -Headers @{ Origin = 'http://127.0.0.1:3302' } -Body (@{ slot = $g1Slot } | ConvertTo-Json -Compress)
```

**Dừng fixture.** Nhấn `Ctrl+C` tại cửa sổ đang chạy, hoặc mở cửa sổ PowerShell thứ hai, lấy `Run ID` do launcher in ra và thay vào lệnh sau. Lệnh gửi yêu cầu cho đúng lượt chạy và dừng các tiến trình của lượt đó. Thư mục Mongo và log fixture vẫn được giữ để đối chiếu. Lượt sau tự tạo DB và bốn slot giả lập mới.

```powershell
Set-Location -LiteralPath 'D:\vietnam-travel'
$g1RunId = '<Run ID do launcher in ra>'
node .\scripts\acceptance-g1.cjs --stop $g1RunId
```

### Ca guest và idempotency

| Ca | Thao tác | PASS khi |
|---|---|---|
| G1-G01 · Sở hữu guest | Không đăng nhập. Đặt tour từ trình duyệt A, chọn tiền mặt hoặc chuyển khoản. Mở lại trang success trong cùng trình duyệt, sau đó sao chép URL sang cửa sổ InPrivate B chưa có cookie. Thử thêm số điện thoại fixture vào URL B. | A thấy đơn, B không thấy chi tiết. URL success không chứa số điện thoại hoặc chứng cứ sở hữu. Cookie có HttpOnly và SameSite Lax. |
| G1-G02 · Gateway | Tạo một đơn VNPay, một đơn ZaloPay và xác nhận tại trang mock. Thử link khởi tạo thanh toán và trang xử lý của đơn chưa biết trong cửa sổ khác. | Browser quay về success trên website, đơn ghi nhận đúng trạng thái đã thanh toán, URL không có số điện thoại. Phiên khác không thể xem chi tiết hoặc khởi tạo thanh toán cho đơn đó. |
| G1-G03 · Đơn cũ | Tra `G1-LEGACY` trong Admin rồi mở trang success bằng ID ở browser guest. Đăng nhập bằng thẻ khách đã phát hành và mở lại. | Admin xử lý theo quyền hiện có. Guest và khách thẻ không được gán quyền xem đơn guest cũ. |
| G1-G04 · Gateway của hội viên | Phát hành thẻ cho khách fixture, đăng nhập bằng thẻ, tạo đơn VNPay hoặc ZaloPay và xác nhận mock. Bấm **Mở đơn hàng** sau khi về website. | Lần điều hướng từ cổng thanh toán có thể về trang trung gian khi cookie hội viên `SameSite=Strict` chưa đi cùng request. Trang trung gian có liên kết mở đơn và không hiển thị dữ liệu khách. Sau cú bấm cùng site, đúng hội viên xem được đơn đã thanh toán. |
| G1-I01 · Retry | Dùng PowerShell bên dưới hoặc cùng payload trong một phiên browser. Gửi hai lần cùng intent, sau đó đổi số khách và gửi lại. | Hai lần đầu trả đúng một ID. Payload mới bị từ chối. Admin thấy một đơn, kho giảm đúng một lần. |
| G1-I02 · Hai chủ sở hữu | Tạo hai cửa sổ browser riêng để đặt các đơn độc lập. Lặp thử với khách đã phát hành thẻ và thao tác bấm nhanh hai lần trên giỏ. | Đơn đi theo phiên hoặc `customerId` thực. Bấm nhanh không tạo thêm đơn. |
| G1-I03 · Kiểm phần khó quan sát | Đối chiếu báo cáo test cho concurrent commit, mất HTTP response, intent hết hạn, database lỗi và rollback. | Intent cũ không tái tạo đơn đã xử lý. Lỗi lưu đơn rollback tồn kho và không làm hỏng hoàn tiền hoặc vé. |
| G1-I04 · Khôi phục sau khi tải lại | Nếu đặt tour báo chưa nhận được kết quả, tải lại `/cart` trong cùng tab và cùng phiên. | Nếu server đã lưu, giỏ tự mở đúng đơn dù các ô thông tin còn trống. Nếu kết quả chưa rõ, giỏ giữ lần đặt cũ. Chỉ nút **ĐẶT TOUR** gửi lại yêu cầu tạo đơn, với cùng intent khi còn khả dụng. |

```powershell
$g1Base = 'http://127.0.0.1:3302'
$g1Ids = Invoke-RestMethod -Uri 'http://localhost:3303/fixture-ids'
$g1Checkout = Invoke-RestMethod -Uri "$g1Base/order/checkout-session" -SessionVariable g1Guest
$g1Booking = @{
    fullName = 'G1 Retry Fixture'
    phone = '0900000022'
    paymentMethod = 'money'
    intentId = $g1Checkout.intentId
    items = @(@{
        tourId = $g1Ids.tourId
        locationFrom = $g1Ids.cityId
        quantityAdult = 1
        quantityChildren = 0
        quantityBaby = 0
    })
}
$g1Payload = $g1Booking | ConvertTo-Json -Depth 5 -Compress
$g1First = Invoke-RestMethod -Uri "$g1Base/order/create" -Method Post -WebSession $g1Guest -ContentType 'application/json' -Body $g1Payload
$g1Retry = Invoke-RestMethod -Uri "$g1Base/order/create" -Method Post -WebSession $g1Guest -ContentType 'application/json' -Body $g1Payload
$g1First.orderId -eq $g1Retry.orderId
$g1Booking.items[0].quantityAdult = 2
$g1Conflict = $g1Booking | ConvertTo-Json -Depth 5 -Compress
try {
    Invoke-RestMethod -Uri "$g1Base/order/create" -Method Post -WebSession $g1Guest -ContentType 'application/json' -Body $g1Conflict
} catch {
    [int]$_.Exception.Response.StatusCode
}
```

Hai lệnh cuối in `True` cho lần gửi lại cùng payload và HTTP `409` cho payload đã đổi. Phiên PowerShell ở đây giữ cookie riêng; muốn kiểm trang success của chính đơn này, dùng cùng `-WebSession $g1Guest`. Nghiệm thu giao diện bằng browser dùng đơn tạo trong browser đó.

Sau G1-A01, có thể dùng `admin@g1.example.com` tạo một Role fixture có `category-view`, `role-view`, `role-create` và gán cho `viewer@g1.example.com`. Đăng nhập lại bằng viewer, thử tạo Role gồm các quyền mình được cấp, rồi thử thêm `account-admin-edit`. G1-A03 đạt khi lần đầu thành công và lần vượt quyền bị từ chối. Trình tự chuyển fallback và khôi phục Role đã có kiểm thử fixture riêng. [Kiểm kê và ánh xạ Role](G1_6_ROLE_MAPPING.md)

## G1.7 · Nghiệm thu lại

**Chuẩn bị ba tab.** Từ `D:\vietnam-travel\smartcard`, chạy `.\gradlew.bat :agent:installDist` với Java 17 để dùng Agent G1.7. Về thư mục gốc, chạy `node .\scripts\acceptance-g1.cjs` như ở mục trên. Chờ `READY`, lưu Run ID và giữ nguyên lượt chạy đến khi hoàn tất một chuỗi Smart Card. Từ PowerShell thứ hai ở thư mục gốc, chạy `node .\scripts\simulator-console.cjs`.

| Tab | Địa chỉ | Dữ liệu kiểm |
|---|---|---|
| Admin | [Đăng nhập Admin](http://127.0.0.1:3302/admin/account/login) | Dùng Admin chính để phát hành/xác thực thẻ nhân viên và thực hiện step-up. Giữ Backup Admin chưa phát hành. Dùng Viewer và Card Reader để kiểm thiếu quyền. |
| Client | [Đăng nhập bằng thẻ](http://127.0.0.1:3302/account/login) | Phát hành thẻ cho hồ sơ khách fixture, đổi PIN ban đầu và đăng nhập. Mở [tour có chỗ](http://127.0.0.1:3302/tour/detail/g1-tour-co-cho) hoặc [Thẻ của tôi](http://127.0.0.1:3302/account/card). |
| Console | [Simulator Console](http://[::1]:3304/) | Mặc định nối Agent fixture 32033. Đổi slot 0 nhân viên, 1 khách, 2–3 thẻ thay thế. Nhãn slot là hướng dẫn, trạng thái đầu đọc do Agent cung cấp. Reload chỉ đọc trạng thái. |

**Chuyển slot an toàn.** Đợi hoàn tất cả phản hồi web và xác nhận chip ở hai tab trước khi đổi slot. Khóa Agent bảo vệ từng lô APDU, giữa các lô có thể có bước máy chủ chưa hoàn tất. Khi cấp lại, cắm slot nhân viên để xác thực step-up, chờ màn hình yêu cầu đổi sang thẻ trắng rồi chọn slot đích. Sau mất kết nối hoặc chưa rõ kết quả, giữ đúng slot để đối soát. Console mặc định chỉ dùng fixture, tùy chọn `--demo` chọn cổng 31999 một cách tường minh và dành riêng cho buổi demo đã được phép. Dừng Console bằng `Ctrl+C`. Dừng fixture theo hướng dẫn Run ID ở mục G1.6.

| Nhóm | Cách kiểm trên fixture | Kết quả cần xác nhận |
|---|---|---|
| Quyền và phiên Admin · 001, 004–006 | Dán URL `/admin/dashboard`, `/admin/category/create` khi là Viewer. Mở từ cả tab mới và reload, kiểm Network. Gán nhóm quyền hợp lệ cho tài khoản chức vụ trống. Thử tạo Role với quyền ngoài phạm vi và mở Role của chính Admin. | 403 trong layout của Viewer, API yêu cầu JSON vẫn trả JSON. Đổi nhóm quyền đơn lẻ giữ dữ liệu hồ sơ. Quyền ngoài phạm vi bị chặn. Trang Role của mình giải thích guard và không gửi PATCH. |
| Giá, ảnh, form tour · 002–003, 007–011 | Tạo tour giá gốc NL `1.000.000`, giá mới bỏ trống, em bé `0`. Thử `1.2`, `-1000`, `1.000.00` và số tràn. Chọn ảnh hợp lệ trong repo, sửa tên, lưu, reload. Thêm bảng, chữ đậm/nghiêng, link và ảnh vào mô tả. Thử ảnh sai định dạng và tệp trên 5 MB. Sửa ảnh Profile rồi đăng nhập lại. | Network gửi VND nguyên, lưu đúng 1.000.000 đ. Giá sai bị báo tại form, giá mới trống lấy giá gốc. Tên mới xuất hiện trong Admin/Client và ảnh cũ còn sau sửa tên. Preview giữ được ảnh đã lưu và có đường thử lại khi ảnh lỗi. Định dạng giữ sau reload. |
| Xóa và lỗi form · 012–013, 020 | Thử hủy rồi xác nhận xóa mềm/vĩnh viễn. Chọn hai tour trong trash gồm một tour có đơn tham chiếu. Gửi OTP sai rồi gửi mã đúng từ hộp thư mock và thực hiện reset, thử dùng lại mã. | Hủy modal không có request, xác nhận chỉ gửi một lần. Bulk gặp bản ghi bị chặn thì không xóa bản ghi nào. Sai/hết hạn/đã dùng báo lỗi. Mã đúng cấp phiên chỉ đặt lại mật khẩu, sau đó đăng nhập lại. |
| Giao diện · 014–019, 023, 025 | Mở URL lạ Admin/Client, trang chủ, danh mục, tìm kiếm, tour, giỏ, trang đặt tour ở 320/360/390/768/1024/1440 px. Dùng Tab/Enter/Escape trên menu và modal PIN. Quét thẻ có nhiều vé, chọn một vé và xác nhận. | 404 đúng status. Header không đẩy giỏ hoặc nút thẻ khỏi viewport. Modal có chữ/nút rõ. Nút Điền từ thẻ chỉ điền thông tin. Check-in hiển thị đúng vé, ngày khởi hành, số khách và mã vừa xác nhận; vé đã dùng không được chọn lại. |
| Gateway và quyền sở hữu · 021, 023 | Nạp ví và đặt tour bằng từng cổng mock VNPay/ZaloPay. Xác nhận trên cổng, bấm **Về thẻ của tôi** hoặc **Mở đơn hàng** sau khi quay lại. Thử refresh, gateway thất bại và phiên InPrivate khác. | Trang trung gian không hiện số dư hoặc dữ liệu đơn công khai. Phiên còn hiệu lực được sử dụng khi bấm tiếp. Phiên khác không xem được chi tiết. Trạng thái paid do backend xác minh. |
| Ví, dự trữ chỗ và khôi phục · 022 | So chỗ trước/sau khi tạo đơn ví có tổng cao hơn số dư, đơn vừa đủ và đơn chưa debit để hết hạn. Thử mất phản hồi sau khi server ghi đơn trong fixture và tải lại giỏ cùng tab. | Thiếu tiền không tạo đơn và không giữ chỗ. Chỗ của đơn ví mới chưa debit được giải phóng một lần sau 20 phút. DEBIT chưa rõ kết quả vẫn giữ chỗ tới khi đối soát biên nhận. Giỏ tự tra cứu và mở lại đơn đã ghi theo G1.8. |
| Đồng bộ · 024 | Hoàn tất nạp ở mock, đặt tour bằng mock, hủy đơn ví đã paid chưa dùng vé. Trên Thẻ của tôi, xem khoản chờ ghi và vé, cắm đúng thẻ và bấm **Đồng bộ thẻ**. Thử thẻ sai, PIN sai và ngắt giữa ghi/xác nhận trên fixture riêng. | Trạng thái và số dư chip cập nhật sau khi đọc thẻ. Nạp/hoàn/ghi vé/xóa vé không lặp. Thẻ khác và phiên hết hạn bị chặn. Hỗ trợ đối soát nếu không xác định được kết quả. |
| Cấp lại và lịch sử · 026–027 | Sau khi bắt đầu cấp lại, để step-up hết hạn hoặc thao tác sai slot, mở **Tiếp tục cấp lại** từ chi tiết thẻ cũ. Xác thực bằng đúng thẻ nhân viên, chuyển slot trắng và tiếp tục. Đối chiếu thẻ trước/sau, thử đăng nhập bằng thẻ cũ, kiểm đơn hủy trước/sau cấp lại. | Trang hướng dẫn xác thực đi đúng yêu cầu cấp lại. Số dư, hạng và vé chưa dùng được đối chiếu trên thẻ hiện hành, không nạp lặp. Nhật ký cũ vẫn tra cứu được. Giao dịch nguồn transfer có nhãn chuyển số dư. Đơn có vé đã dùng bị chặn hoàn tự động. |
| Thu hồi, nhật ký và Console | Thử thu hồi thẻ còn số dư mà chưa xác nhận hoàn tiền mặt. Đối chiếu log, sau đó xử lý theo kịch bản fixture riêng. Thử đổi slot, hủy, reload, rồi kiểm Agent offline bằng cách dừng fixture sau khi xong. | Thu hồi cần lý do và xác nhận theo nghiệp vụ; thẻ thu hồi không mở lại. Log Việt hóa, chi tiết đối soát giữ mã kỹ thuật được phép. Console không tự đổi slot khi mở lại hoặc khi Agent không trả trạng thái. |

Ghi từng ca `PASS`, `FAIL`, `BLOCKED` hoặc `NOT_RUN` cùng phiên bản/lượt fixture và bằng chứng đã che PIN, OTP, token và khóa. Giữ chuỗi cấp lại/hoàn tiền trên cùng lượt chạy để đối chiếu tình trạng các thẻ cũ. [Các kịch bản Smart Card](huong-dan-test-the/README.md) · [Báo cáo G1.7](G1_7_REPORT.md)

## G1.8 · Nghiệm thu tập trung

Chạy trên một fixture mới. Dùng bản Agent đã build từ cây hiện tại. Nếu chưa có, từ `D:\vietnam-travel\smartcard` chạy `.\gradlew.bat :agent:installDist` với Java 17.

```powershell
Set-Location 'D:\vietnam-travel'
node .\scripts\acceptance-g1.cjs
```

Chờ `READY` và ghi Run ID. Từ PowerShell thứ hai ở thư mục gốc, chạy `node .\scripts\simulator-console.cjs`. Mở [Admin](http://127.0.0.1:3302/admin/account/login), [Client](http://127.0.0.1:3302/account/login), [Console](http://[::1]:3304/) và [hộp thư mock](http://localhost:3303/mailbox) khi cần. Dùng `admin@g1.example.com` hoặc `backup@g1.example.com` và mật khẩu fixture ở [mục G1.6](#g16--môi-trường-nghiệm-thu-riêng). Phát hành vào slot 0 cho nhân viên và slot 1 cho hồ sơ `customer@g1.example.com`. Slot 2–3 là hai thẻ trắng dự phòng. Đợi phản hồi cuối ở cả Admin và Client trước khi chuyển slot.

| Ưu tiên | Thao tác trên browser | Kết quả mong đợi |
|---|---|---|
| 1 · Hủy đơn ví | Nạp bằng cổng mock, đặt và trả bằng ví. Mở đúng đơn ở Admin. Sửa ghi chú, sau đó chọn Hủy và bấm Cập nhật. Dismiss lần đầu, xác nhận lần thứ hai. Về **Thẻ của tôi**, bấm **Đồng bộ thẻ** rồi **Đọc thẻ**. | Ghi chú lưu qua PATCH. Dismiss không gửi PATCH. Xác nhận gửi một PATCH, kho hoàn một lần, xuất hiện khoản hoàn và vé chờ xóa. Sau đồng bộ, số tiền ghi một lần, vé không còn trên chip. Thử đồng bộ lại và kiểm không đổi số dư. |
| 2 · Ảnh | Sửa Profile. Bấm **Bỏ ảnh này** rồi tải lại trước khi lưu. Lặp lại và lưu. Tải ảnh khác. Trong tour edit, chọn ảnh đại diện và ba ảnh album, lưu, mở lại, bỏ một ảnh và đổi thứ tự. Kiểm ở 320 và 1440 px. | Tải lại khi chưa lưu giữ ảnh. Sau lưu clear, form/header hiện ảnh mặc định. FilePond co theo nội dung, nút và preview các vùng tách nhau. Album sau F5 đúng thứ tự. Ảnh sai chữ ký hoặc quá 5 MB bị từ chối. |
| 3 · Check-in | Mua ba đơn cho cùng tour trong cửa sổ check-in. Quét đúng thẻ, nhập PIN, chọn một rồi hai vé, hủy modal. Bấm **Chọn tất cả vé hợp lệ**, xác nhận. Quét lại. | Số vé/số khách phản ánh lựa chọn. Hủy giữ nguyên vé. Sau xác nhận ba vé, panel thông tin và lựa chọn được xóa. Quét lại thấy vé đã dùng và không thể chọn hoặc hủy. Vé chưa rõ kết quả giữ trạng thái cần đối soát. |
| 4 · Hồ sơ và nhật ký | Từ menu tài khoản mở **Thông tin cá nhân**. Lưu địa chỉ/ảnh web, đổi giới tính và liên hệ bằng đúng thẻ + PIN, tải lại. Đọc nhật ký chip có hơn ba giao dịch và mở rộng. | Dữ liệu hồ sơ lưu và đọc lại, đơn đã đặt giữ thông tin lúc đặt. Ảnh web và chân dung trên thẻ nằm ở hai vị trí riêng. Họ tên, ngày sinh và email hiển thị để đối chiếu. Nhật ký chip mặc định có ba dòng, **Xem toàn bộ** và **Thu gọn** hoạt động. |
| 5 · Khôi phục checkout | Trên fixture, dùng kịch bản mất phản hồi ở `.superpowers/g18/guest-browser.cjs` nếu máy có Playwright như trong báo cáo. Khi đã có đơn và mất phản hồi, tải lại giỏ cùng tab. Mở link đơn ở một cửa sổ InPrivate khác. | Giỏ tự mở đúng đơn và dọn mục đã đặt. Trang đơn chặn cửa sổ khác. Giỏ giữ intent nếu chưa xác định kết quả. |
| 6 · TinyMCE | Với API key hợp lệ và hostname đã duyệt, mở thêm/sửa tour. Sửa một đoạn tiếng Việt, định dạng, bảng, link và ảnh, rồi lưu và mở trang Client. Lặp lại với fixture thiếu cấu hình. | TinyMCE hiện thanh công cụ theo cấu hình cũ. Nội dung đã lưu mở lại đúng qua sanitizer. Khi Tiny Cloud chưa cấu hình hoặc không tải được, form báo rõ và hiển thị ô HTML chứa mô tả hiện tại. |

Để bật Tiny Cloud trên fixture, đặt `G18_TINYMCE_API_KEY` trong PowerShell chạy fixture trước khi khởi động. Với cấu hình ứng dụng thông thường dùng `TINYMCE_API_KEY`. Đăng ký hostname `127.0.0.1` trong **Approved Domains** trước khi chạy URL fixture. Tiny Cloud chấp nhận `localhost` cho local development theo tài liệu, nhưng fixture dùng URL `127.0.0.1` cho cookie và Agent Origin. [Hướng dẫn Tiny Cloud](https://www.tiny.cloud/docs/tinymce/latest/cloud-quick-start/) · [Phân biệt localhost và địa chỉ loopback](https://www.tiny.cloud/blog/how-to-create-a-javascript-project-with-tinymce/)

Khi xong, dừng Console bằng `Ctrl+C` và dừng fixture bằng `Ctrl+C` ở cửa sổ launcher hoặc `node .\scripts\acceptance-g1.cjs --stop <RunID>`. Ghi ca đã xác nhận, bước lỗi, trạng thái mong đợi và ảnh đã che dữ liệu. [Báo cáo G1.8](G1_8_REPORT.md)

## G1.9 · Nghiệm thu tập trung

Trong PowerShell, dùng Node.js, Java 17 và MongoDB. Build Agent từ workspace hiện tại khi cần, rồi khởi động một fixture mới.

```powershell
Set-Location 'D:\vietnam-travel\smartcard'
.\gradlew.bat :agent:installDist
Set-Location 'D:\vietnam-travel'
node .\scripts\acceptance-g1.cjs
```

Chờ `READY` và giữ cửa sổ launcher mở. Mở PowerShell thứ hai tại thư mục gốc và chạy `node .\scripts\simulator-console.cjs`. Dùng địa chỉ website `127.0.0.1` để khớp Origin Agent.

| Thành phần | Giá trị fixture |
|---|---|
| Admin | [Đăng nhập Admin](http://127.0.0.1:3302/admin/account/login), tài khoản `admin@g1.example.com` hoặc `backup@g1.example.com`, mật khẩu `G16Fixture-2026!`. |
| Khách | [Đăng nhập bằng thẻ](http://127.0.0.1:3302/account/login). Ở **Phát hành thẻ**, chọn khách `customer@g1.example.com` và dùng slot 1. Nhập PIN phát hành được hiện một lần, rồi chọn PIN fixture mới, ví dụ `572604`. |
| Agent và Console | [Console bốn slot](http://[::1]:3304/) và [Agent status](http://127.0.0.1:32033/v1/status). Slot 0 dùng cho nhân viên nếu ca cần step-up. Slot 2–3 dự phòng. Đợi thao tác kết thúc rồi mới chuyển slot. |
| Tour và mock | [Tour có chỗ](http://127.0.0.1:3302/tour/detail/g1-tour-co-cho) có 12 chỗ người lớn và giá 300.000 đồng. [Hộp thư fixture](http://localhost:3303/mailbox). Cổng mock mở từ form nạp tiền, chọn **Xác nhận thanh toán mô phỏng**. |
| Ảnh | Dùng tệp `public\assets\images\product-1.jpg`, `product-2.jpg` và `product-3.jpg`. |

| Ca nghiệm thu | Thao tác và kết quả mong đợi |
|---|---|
| Album tour | Mở **Chỉnh sửa tour**, chọn ba ảnh mới và kiểm tại 360 và 1440 px. Preview nằm ngang và tự xuống hàng, dấu cộng còn dùng được. Lưu để có ảnh đã lưu, mở lại, bỏ một ảnh rồi **Giữ lại ảnh**, đổi thứ tự ảnh lưu và kéo ảnh mới. Lưu và mở lại để đối chiếu thứ tự. |
| Khoảng cách hồ sơ | Từ **Thẻ của tôi** mở [Thông tin cá nhân](http://127.0.0.1:3302/account/profile). Kiểm dòng hướng dẫn sau nút ghi thẻ ở 360 và 1440 px. Hướng dẫn cách nút trên 14 px và trước nút Đổi PIN 16 px. |
| Thiếu số dư ví | Với thẻ mới có số dư 0, thêm một người lớn của tour mẫu, chọn **Ví thẻ thành viên** và bấm đặt. Một popup **Số dư ví không đủ** hướng dẫn nạp tiền hoặc chọn cách khác. Đóng popup và đổi sang tiền mặt nếu muốn kiểm đường tiếp tục. Muốn kiểm ví đủ tiền, nạp mock 500.000 đồng, đồng bộ, đặt tour khác và thanh toán bằng PIN. Số dư còn 200.000 đồng sau giao dịch ví đơn 300.000 đồng. |
| Danh mục Client | Mở [Trang chủ](http://127.0.0.1:3302/). Ở desktop các danh mục đầu hiện trực tiếp, chỉ phần hết chỗ nằm trong **Xem thêm**. Thử Tab, Enter, Escape và click ngoài. Thu cửa sổ còn 390 px, mở nút menu và kiểm danh mục cùng giỏ hàng/tài khoản/thẻ. Liên hệ dẫn tới footer. |

Ca mở lại đơn sau mất phản hồi, intent hết hạn, ảnh stale và check-in mất kết quả có kịch bản cùng log trong [báo cáo G1.9](G1_9_REPORT.md#kiểm-thử-g19). Chủ dự án có thể xác nhận phần mới bằng bảng trên. Tiny Cloud đã được xác nhận ở G1.8. Nếu cần bật trong fixture mới, đặt biến `G18_TINYMCE_API_KEY` trong tiến trình PowerShell chạy launcher và đăng ký hostname fixture trong **Approved Domains**. App thường dùng `TINYMCE_API_KEY`. Khi thiếu key hoặc CDN, editor hiển thị ô HTML để tiếp tục làm việc. [Hướng dẫn Tiny Cloud](https://www.tiny.cloud/docs/tinymce/latest/cloud-quick-start/)

Khi xong, nhấn `Ctrl+C` tại Console và launcher, hoặc chạy `node .\scripts\acceptance-g1.cjs --stop <RunID>` với Run ID của fixture. Ghi ca đã duyệt, viewport và kết quả quan sát. Che PIN, OTP và dữ liệu cá nhân trong ảnh.

### Rà checkbox trước khi chốt G1

Dùng [fixture G1.9](#g19--nghiệm-thu-tập-trung). Chỉ cần kiểm phần sửa sau nghiệm thu ở bảng sau.

| Trang | Kiểm nhanh |
|---|---|
| Admin · Chỉnh sửa tour có ảnh đại diện | Ở 360 px và 1440 px, kiểm checkbox **Bỏ ảnh đại diện khi lưu** là 18 × 18 px, nằm cạnh nhãn. Bấm nhãn để chọn và bỏ chọn. Chọn rồi tải lại trước khi lưu, ảnh vẫn giữ và ô trở về chưa chọn. |
| Admin · Form và bảng | Nhãn địa điểm ở form tour, nhãn quyền Role, Nhớ mật khẩu và điều khoản đăng ký đều chọn được. Danh mục và Thùng rác tour giữ thao tác chọn dòng và chọn tất cả hiện có. |
| Admin · Thẻ và check-in, Client · Hồ sơ và giỏ | Kiểm ô xác nhận hoàn tiền mặt, ô chọn tất cả/vé hợp lệ, ô bỏ ảnh web và ô chọn tour. Bấm nhãn ở nơi có nhãn hiển thị. Với giỏ, dùng Tab tới ô và nhấn Space để bỏ/chọn. |

Check-in giữ xử lý vé chờ đối soát, gồm chốt hủy/hoàn/cấp lại. Đổi slot sau khi giao dịch kết thúc. Hai yêu cầu mở rộng về biên nhận check-in và khóa giữa các lô APDU đã được chủ dự án rút. [Báo cáo G1.9](G1_9_REPORT.md)
