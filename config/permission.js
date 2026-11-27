module.exports.permissionList = [
  { label: "Xem thẻ thành viên", value: "card-view" },
  { label: "Phát hành thẻ", value: "card-issue" },
  { label: "Sửa hồ sơ thẻ", value: "card-edit" },
  { label: "Khóa và mở khóa thẻ", value: "card-lock" },
  { label: "Thu hồi thẻ", value: "card-revoke" },
  { label: "Đặt lại PIN thẻ", value: "card-reset-pin" },
  { label: "Nạp tiền mặt vào thẻ", value: "card-topup" },
  { label: "Điểm danh bằng thẻ", value: "card-checkin" },
  { label: "Xem nhật ký thẻ", value: "card-log-view" },
  {
    label: "Xem trang Tổng quan",
    value: "dashboard-view"
  },
  {
    label: "Xem danh mục",
    value: "category-view"
  },
  {
    label: "Tạo danh mục",
    value: "category-create"
  },
  {
    label: "Sửa danh mục",
    value: "category-edit"
  },
  {
    label: "Xóa danh mục",
    value: "category-delete"
  },
  {
    label: "Thùng rác danh mục",
    value: "category-trash"
  },
  {
    label: "Xem tour",
    value: "tour-view"
  },
  {
    label: "Tạo tour",
    value: "tour-create"
  },
  {
    label: "Sửa tour",
    value: "tour-edit"
  },
  {
    label: "Xóa tour",
    value: "tour-delete"
  },
  {
    label: "Thùng rác tour",
    value: "tour-trash"
  },
  {
    label: "Xem đơn hàng",
    value: "order-view"
  },
  {
    label: "Sửa đơn hàng",
    value: "order-edit"
  },
  {
    label: "Xóa đơn hàng",
    value: "order-delete"
  },
  {
    label: "Thùng rác đơn hàng",
    value: "order-trash"
  },
];

const legacyPermissionKeys = module.exports.permissionList.map(permission => permission.value);
const delegatedAdminPermissions = [
  { label: "Xem thông tin liên hệ", value: "contact-view" },
  { label: "Xem cấu hình website", value: "website-view" },
  { label: "Sửa cấu hình website", value: "website-edit" },
  { label: "Xem tài khoản quản trị", value: "account-admin-view" },
  { label: "Tạo tài khoản quản trị", value: "account-admin-create" },
  { label: "Sửa tài khoản quản trị", value: "account-admin-edit" },
  { label: "Xem nhóm quyền", value: "role-view" },
  { label: "Tạo nhóm quyền", value: "role-create" },
  { label: "Sửa nhóm quyền", value: "role-edit" }
];

const delegatedPermissionKeys = delegatedAdminPermissions.map(permission => permission.value);

function usesLegacyPermissionFallback(permissions) {
  const mode = process.env.ADMIN_LEGACY_PERMISSION_FALLBACK;
  return (mode === undefined || mode === '1') && Array.isArray(permissions) &&
    !delegatedPermissionKeys.some(key => permissions.includes(key)) &&
    legacyPermissionKeys.every(key => permissions.includes(key));
}

module.exports.permissionList.push(...delegatedAdminPermissions);
module.exports.hasPermission = (permissions, value) => Array.isArray(permissions) && (
  permissions.includes(value) ||
  (delegatedPermissionKeys.includes(value) && usesLegacyPermissionFallback(permissions))
);
module.exports.effectivePermissions = permissions => module.exports.permissionList
  .map(permission => permission.value).filter(key => module.exports.hasPermission(permissions, key));
