# Kiểm kê và kế hoạch chuyển quyền Role G1.6

Kiểm kê ngày 26/11/2026 bằng MongoDB Driver trên loopback 27019. Kết nối đã xác minh database `vietnam-travel-smartcard-demo`, replica set `rsdemo` và node primary trước khi đọc. Dùng truy vấn chiếu trường Role và tổng hợp trạng thái tài khoản, thẻ. Không có lệnh ghi, tạo index hoặc nạp model Mongoose vào tiến trình kiểm kê.

## Hiện trạng và đề xuất theo Role

Số tài khoản đếm các bản ghi có `deleted: false`. Cột Active là phần có trạng thái `active`. Cả sáu Role hiện hành đều có `deleted: false`. Không có tài khoản đang tham chiếu Role ngoài bảng. Quyền hiện tại trong bảng được giữ nguyên theo đề xuất.

| Role | Tài khoản | Active | Quyền hiện tại, giữ nguyên | Đề xuất bổ sung sau khi được duyệt dữ liệu |
|---|---:|---:|---|---|
| Demo Smartcard Full | 1 | 1 | `Gốc-24` | Chín quyền `Mới-9`; đây là Role hiện có tài khoản quản trị đầy đủ qua cơ chế chuyển tiếp. |
| Demo - Bán tour | 0 | 0 | `dashboard-view`, `order-edit`, `order-view`, `tour-create`, `tour-edit`, `tour-view` | Giữ quyền hiện có. |
| Demo - Phát hành thẻ | 1 | 1 | `card-edit`, `card-issue`, `card-lock`, `card-log-view`, `card-reset-pin`, `card-view`, `dashboard-view` | Giữ quyền hiện có. |
| Demo - Thu ngân | 0 | 0 | `card-log-view`, `card-topup`, `card-view`, `dashboard-view`, `order-view` | Giữ quyền hiện có. |
| Demo - Check-in | 0 | 0 | `card-checkin`, `card-view`, `dashboard-view` | Giữ quyền hiện có. |
| Demo - Giám sát | 0 | 0 | `card-log-view`, `card-view`, `dashboard-view`, `order-view`, `tour-view` | Giữ quyền hiện có. |

- `Gốc-24` gồm `card-checkin`, `card-edit`, `card-issue`, `card-lock`, `card-log-view`, `card-reset-pin`, `card-revoke`, `card-topup`, `card-view`, `category-create`, `category-delete`, `category-edit`, `category-trash`, `category-view`, `dashboard-view`, `order-delete`, `order-edit`, `order-trash`, `order-view`, `tour-create`, `tour-delete`, `tour-edit`, `tour-trash`, `tour-view`.
- `Mới-9` gồm `contact-view`, `website-view`, `website-edit`, `account-admin-view`, `account-admin-create`, `account-admin-edit`, `role-view`, `role-create`, `role-edit`. Cả sáu Role đang thiếu bộ này trong dữ liệu gốc. [Danh mục quyền và cơ chế chuyển tiếp](../config/permission.js)

**Kiểm tra quản trị viên.** Có một tài khoản active thuộc Role đủ toàn bộ quyền hiệu lực theo chế độ chuyển tiếp, với email có định dạng hợp lệ, duy nhất trong tập tài khoản chưa xóa, bản ghi bcrypt đúng định dạng và `cardRequired` tắt. Có **0** tài khoản đủ bộ quyền tường minh nếu tắt chế độ chuyển tiếp tại thời điểm kiểm kê. Kiểm tra này xác nhận đường xác thực theo cấu hình và dữ liệu, chưa xác minh mật khẩu của chủ tài khoản bằng đăng nhập demo. Việc kiểm kê không xuất thông tin nhận dạng hoặc dữ liệu xác thực của tài khoản.

## Menu, route và chế độ chuyển tiếp

| Hiển thị | Route | Quyền điều khiển |
|---|---|---|
| Menu Liên hệ | `GET /admin/contact/list` | `contact-view` |
| Menu Cài đặt chung | `GET /admin/setting/list` | Một trong `website-view`, `account-admin-view`, `role-view` |
| Ô Thông tin website | `GET/PATCH /admin/setting/website-info` | `website-view` cho GET, `website-edit` cho PATCH |
| Ô Tài khoản quản trị | `GET /admin/setting/account-admin/list`, trang tạo và sửa tương ứng, `POST .../create`, `PATCH .../edit/:id` | `account-admin-view`, `account-admin-create`, `account-admin-edit` theo hành động |
| Ô Nhóm quyền | `GET /admin/setting/role/list`, trang tạo và sửa tương ứng, `POST .../create`, `PATCH .../edit/:id` | `role-view`, `role-create`, `role-edit` theo hành động |

Quyền các route tour, danh mục, đơn, Smart Card và profile giữ theo ma trận đã duyệt. Sidebar, các ô trong trang Cài đặt và route backend dùng cùng phép tính quyền cho phần hiển thị của chúng. Quyền gốc của Role vẫn dùng ở tầng nghiệp vụ, mỗi Role được phân tích theo tập permission thay vì tên. [Route cài đặt](../routes/admin/setting.route.js) · [Menu](../views/admin/partials/sider.pug)

Khi `ADMIN_LEGACY_PERMISSION_FALLBACK` chưa đặt hoặc bằng `1`, chỉ Role có đủ 24 quyền gốc và chưa có bất kỳ quyền mới nào được tiếp cận chín quyền mới trong thời gian chuyển tiếp. Role đã có dù chỉ một quyền mới lấy quyền mới theo danh sách tường minh. Kiểm tra quyền được cấp khi tạo, sửa hoặc gán Role tính cả quyền hiệu lực của Role đích. Đặt `ADMIN_LEGACY_PERMISSION_FALLBACK=0` để dùng quyền tường minh cho mọi Role. Giá trị cấu hình khác cũng tắt phần suy quyền.

## Áp dụng và rollback sau phê duyệt dữ liệu

1. Xác nhận phạm vi qua kiểm kê chỉ đọc mới. Chụp bản sao được bảo vệ của bộ `permissions` theo `_id` Role và danh sách đối chiếu tài khoản theo `_id`, `role`, `sessionVersion`. Sao lưu tách khỏi log thử nghiệm. Xác nhận người quản trị còn truy cập được và người chịu trách nhiệm rollback.
2. Trên database test riêng, áp dụng bản mapping theo `_id` Role với điều kiện bộ quyền gốc vẫn khớp ảnh chụp. Thêm chín quyền kiểm soát và giữ nguyên 24 quyền của Role quản trị trong **một** thay đổi, tránh thời điểm Role chỉ có một phần quyền cần thiết. Tăng phiên bản phiên của tài khoản bị ảnh hưởng cùng giao dịch để phiên cũ hết hiệu lực. Xác nhận tài khoản quản trị đăng nhập lại và còn đủ quyền tường minh.
3. Lặp lại trên dữ liệu live sau khi chủ dự án duyệt riêng việc ghi. Áp dụng toàn bộ mapping tường minh và nghiệm thu người quản trị trước khi đặt `ADMIN_LEGACY_PERMISSION_FALLBACK=0` rồi khởi động lại tiến trình web. Vì hiện chỉ có một tài khoản đủ quyền quản trị, thực hiện qua quy trình migration vận hành có phê duyệt. Hành động này không dùng luồng tự sửa quyền của Role đang đăng nhập.
4. Sau khi rollout chế độ tường minh ổn định, xóa cơ chế chuyển tiếp khỏi cấu hình và bộ test theo một lượt thay đổi có kiểm thử. Khi chỉ còn quyền tường minh, việc xóa chín quyền đã gán không làm Role tự lấy lại quyền qua lối legacy.
5. Nếu cần rollback, khôi phục cấu hình chuyển tiếp và bộ permission chụp trước đó bằng cùng phạm vi `_id`, theo thứ tự kiểm kê cho thấy quản trị viên còn quyền. Tăng `sessionVersion` trên tài khoản bị ảnh hưởng và đăng nhập lại. Giữ nguyên khóa, thẻ và dữ liệu đơn. Nếu không còn đường truy cập, dùng quy trình recovery đã được phê duyệt riêng.

**Bằng chứng tự động.** Bốn ca kiểm thử Mongo fixture sử dụng router và view Admin thực tế. Các ca xác nhận quyền truy cập qua chế độ chuyển tiếp, chuyển sang quyền tường minh sau mapping, khôi phục quyền truy cập khi bật fallback và trả bộ quyền gốc trên fixture. Các ca còn lại kiểm Role giới hạn, mapping một phần, giá trị cấu hình sai và giới hạn quyền khi tạo Role. Dữ liệu demo vẫn ở mốc kiểm kê. [Regression Role](../test/integration/role-mapping.test.js)
