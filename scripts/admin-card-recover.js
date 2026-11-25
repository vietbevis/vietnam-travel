'use strict';
// Khôi phục tài khoản admin bị kẹt vì cardRequired=true nhưng không còn thẻ nhân viên hoạt động.
// Dùng: node scripts/admin-card-recover.js <email> [--yes] [--force] [--reason "lý do"]
// Không có --yes: chỉ chạy thử (dry run), không ghi gì.

function parseArgs(argv) {
  const out = { email: '', yes: false, force: false, reason: '', errors: [] };
  const rest = argv.slice();
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--yes') out.yes = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--reason') { const value = rest.shift(); if (!value || value.startsWith('--')) out.errors.push('--reason cần một giá trị.'); else out.reason = value; }
    else if (arg.startsWith('--')) out.errors.push('Tùy chọn không hợp lệ: ' + arg);
    else if (!out.email) out.email = arg.trim();
    else out.errors.push('Chỉ nhận một email.');
  }
  if (!out.email) out.errors.push('Thiếu email tài khoản admin.');
  return out;
}

function hasActiveStaffCard(cards) {
  return cards.some(card => card.cardType === 'staff' && card.status === 'active' && card.isCurrent === true);
}

// Trả về { proceed, reason } để quyết định có được khôi phục hay không.
function decide({ account, cards, force }) {
  if (!account) return { proceed: false, reason: 'Không tìm thấy tài khoản admin đang hoạt động (chưa xóa) với email này.' };
  if (!account.cardRequired) return { proceed: false, reason: 'Tài khoản không bật cardRequired; không cần khôi phục.' };
  if (hasActiveStaffCard(cards) && !force) return { proceed: false, reason: 'Tài khoản vẫn còn thẻ nhân viên đang hoạt động; không cần khôi phục. Dùng --force nếu thật sự muốn tắt cardRequired.' };
  return { proceed: true, reason: '' };
}

function describeCards(cards) {
  if (!cards.length) return ['  (không có thẻ nhân viên nào)'];
  return cards.map(card => `  - ${card.cardId} | ${card.cardType} | ${card.status}${card.isCurrent ? ' | hiện hành' : ''}`);
}

function logEntry({ account, cards, reason, force }) {
  const staff = cards.find(card => card.cardType === 'staff');
  return {
    action: 'admin-card-recover',
    ...(staff && /^[a-fA-F0-9]{32}$/.test(staff.cardId) ? { cardId: staff.cardId } : {}),
    actorType: 'system',
    actorId: 'cli',
    result: 'success',
    detail: { accountId: String(account._id || account.id), email: account.email, reason, force: !!force, previousCards: cards.map(card => ({ cardId: card.cardId, status: card.status, isCurrent: !!card.isCurrent })) }
  };
}

async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(message => log(message));
    log('Cách dùng: node scripts/admin-card-recover.js <email> [--yes] [--force] [--reason "lý do"]');
    return 1;
  }
  require('dotenv').config();
  if (!process.env.DATABASE) { log('Thiếu biến môi trường DATABASE.'); return 1; }
  const mongoose = require('mongoose');
  const Account = require('../models/account-admin.model');
  const Card = require('../models/card.model');
  const CardLog = require('../models/card-log.model');
  await mongoose.connect(process.env.DATABASE);
  try {
    const account = await Account.findOne({ email: args.email, deleted: false, status: 'active' });
    const cards = account ? await Card.find({ ownerId: account.id, cardType: 'staff' }).sort({ createdAt: -1 }).lean() : [];
    if (account) { log(`Tài khoản: ${account.email} (${account.fullName || ''}) | cardRequired=${account.cardRequired}`); log('Thẻ nhân viên:'); describeCards(cards).forEach(line => log(line)); }
    const verdict = decide({ account, cards, force: args.force });
    if (!verdict.proceed) { log(verdict.reason); return 1; }
    if (!args.yes) { log('\nChạy thử (dry run): chưa thay đổi gì. Thêm --yes để đặt cardRequired=false cho tài khoản này.'); return 0; }
    const reason = args.reason || 'Khôi phục tài khoản admin mất/khóa thẻ nhân viên qua CLI';
    const updated = await Account.updateOne({ _id: account._id, cardRequired: true }, { $set: { cardRequired: false } });
    if (updated.modifiedCount !== 1) { log('Không cập nhật được tài khoản (có thể vừa thay đổi). Hãy chạy lại.'); return 1; }
    await CardLog.create(logEntry({ account, cards, reason, force: args.force }));
    log('\nĐã tắt cardRequired và ghi Nhật ký thẻ (admin-card-recover).');
    log('Bước tiếp theo:');
    log('  1. Đăng nhập trang admin chỉ bằng email + mật khẩu.');
    log('  2. Vào Phát hành thẻ -> Nhân viên, phát hành thẻ nhân viên mới cho tài khoản này (việc này bật lại cardRequired).');
    log('  3. Từ lần đăng nhập sau, dùng thẻ mới.');
    return 0;
  } finally { await mongoose.disconnect(); }
}

module.exports = { parseArgs, decide, hasActiveStaffCard, describeCards, logEntry, main };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => { console.error('Không thể khôi phục: ' + (error && error.message ? error.message : error)); process.exitCode = 1; });
}
