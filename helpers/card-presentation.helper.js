const knownTicketStatuses = Object.freeze({
  none: 'Chưa phát hành vé',
  pending: 'Chờ ghi thẻ',
  written: 'Đã ghi thẻ · chưa check-in',
  used: 'Đã check-in',
  'pending-delete': 'Đã hủy · chờ xóa khỏi thẻ',
  deleted: 'Đã xóa khỏi thẻ'
});

const auditActions = Object.freeze({
  'card-op-confirm': 'Xác nhận lệnh thẻ',
  'card-sync-op': 'Đồng bộ lệnh thẻ',
  'card-op-sign': 'Ký lệnh thẻ',
  'topup-cash': 'Ghi nhận nạp tiền mặt',
  'replace': 'Bắt đầu cấp lại thẻ',
  'replace-finish': 'Hoàn tất cấp lại thẻ',
  'revoke': 'Thu hồi thẻ',
  'lock': 'Khóa thẻ',
  'unlock': 'Mở khóa thẻ',
  'reset-pin': 'Đặt lại mã PIN',
  'checkin-lookup': 'Tra cứu vé check-in',
  'checkin-use': 'Ghi nhận check-in',
  'ticket-order-cancel': 'Hủy vé theo đơn hàng',
  'profile-build': 'Chuẩn bị ghi hồ sơ',
  'issue-prepare': 'Chuẩn bị phát hành thẻ',
  'issue-finish': 'Hoàn tất phát hành thẻ',
  issue: 'Phát hành thẻ',
  'issue-cancel': 'Hủy phát hành thẻ',
  'customer-login': 'Khách đăng nhập bằng thẻ',
  'admin-card-login': 'Nhân viên đăng nhập bằng thẻ'
});

const auditFields = Object.freeze({
  errorCode: 'Mã lỗi', opId: 'Mã thao tác', sw: 'Trạng thái APDU',
  type: 'Loại lệnh', state: 'Mã trạng thái chip', counter: 'Bộ đếm',
  txRef: 'Mã giao dịch', orderCode: 'Mã đơn', amount: 'Số tiền',
  balanceHeld: 'Số dư đang giữ', replaceOf: 'Thẻ trước',
  newCardId: 'Thẻ mới', tourId: 'Mã tour', itemIndex: 'Vị trí vé'
});
const errors = Object.freeze({
  REFUND_REQUIRED: 'Cần xác nhận hoàn tiền mặt',
  RECONCILIATION_REQUIRED: 'Cần đối soát giao dịch',
  STEP_UP_REQUIRED: 'Cần xác thực lại bằng thẻ nhân viên',
  OP_FORBIDDEN: 'Yêu cầu bị từ chối theo quyền',
  CARD_STATE: 'Trạng thái thẻ không cho phép thao tác'
});
const types = Object.freeze({
  credit: 'Ghi có', debit: 'Ghi nợ', 'set-state': 'Cập nhật trạng thái chip',
  'write-ticket': 'Ghi vé', 'use-ticket': 'Check-in vé', 'delete-ticket': 'Xóa vé',
  'reset-pin': 'Đặt lại PIN', 'commit-write': 'Ghi dữ liệu chip'
});
const sources = Object.freeze({
  cash: 'Tiền mặt', vnpay: 'VNPay', zalopay: 'ZaloPay', order: 'Đặt tour',
  refund: 'Hoàn tiền đơn hàng', transfer: 'Chuyển số dư khi cấp lại'
});
const financialStatuses = Object.freeze({
  'awaiting-payment':'Chờ thanh toán', 'pending-card':'Chờ ghi thẻ', sent:'Chờ xác nhận chip',
  done:'Đã xác nhận', failed:'Thất bại', reconciliation:'Cần đối soát'
});

const hasKey = (table, key) => Object.hasOwn(table, key);
const ticketStatusLabel = key => hasKey(knownTicketStatuses, key) ? knownTicketStatuses[key] : 'Chưa xác định';
const cardTxType = key => hasKey(types, key) ? types[key] : 'Giao dịch thẻ';
const cardTxStatus = key => hasKey(financialStatuses, key) ? financialStatuses[key] : 'Cần kiểm tra';
const cardTxSource = key => hasKey(sources, key) ? sources[key] : 'Nguồn khác';

function formatCardAudit(entry, actorProfiles = new Map()) {
  const raw = entry.detail || {};
  const label = hasKey(auditActions, entry.action) ? auditActions[entry.action] : 'Thao tác thẻ';
  const outcome = ['success', 'ok'].includes(entry.result) ? 'success' : ['fail', 'error'].includes(entry.result) ? 'fail' : 'unknown';
  const detail = Object.entries(auditFields).flatMap(([key, name]) => {
    const value = raw[key];
    // Display only the technical scalars emitted by these producers. Free-form fields stay in storage.
    if (!(typeof value === 'number' && Number.isSafeInteger(value)) &&
        !(typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value))) return [];
    return [[name, key === 'type' && hasKey(types, value) ? `${types[value]} (${value})` : String(value)]];
  });
  const by = { system: 'Hệ thống', admin: 'Nhân viên', customer: 'Khách hàng' };
  const actorType = hasKey(by, entry.actorType) ? by[entry.actorType] : 'Tác nhân';
  const actorProfile = entry.actorType === 'admin' ? actorProfiles.get(entry.actorId) : undefined;
  return {
    label, action: typeof entry.action === 'string' && /^[a-z0-9.:-]+$/i.test(entry.action) ? entry.action : '',
    outcome, outcomeLabel: { success: 'Thành công', fail: 'Thất bại', unknown: 'Cần kiểm tra' }[outcome],
    actor: actorProfile?.name || actorType, actorRole: actorProfile?.role || actorType,
    actorId: /^[a-f0-9]{24}$/i.test(entry.actorId || '') ? entry.actorId : '',
    hint: hasKey(errors, raw.errorCode) ? errors[raw.errorCode] : '', detail
  };
}

module.exports = { ticketStatusLabel, cardTxType, cardTxStatus, cardTxSource, auditActions, formatCardAudit };
