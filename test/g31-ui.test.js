const { test } = require('node:test');
const assert = require('node:assert/strict');
const pug = require('pug');
const parse = require('parse5');
const { paymentMethod } = require('../config/variable');

function elements(html) {
  const nodes = [];
  function walk(node) {
    if (node.tagName) nodes.push({
      tag: node.tagName,
      attrs: Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
      text: (function text(n) {
        return n.value ?? (n.childNodes || []).map(text).join('');
      })(node)
    });
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parse.parse(html));
  return nodes;
}
const shared = { pageTitle: 'Fixture', pathAdmin: 'admin', messages: {}, account: {} };
const period = {
  orderCount: 10, gross: 200000, net: -400000, refunded: 600000, refundChip: 600000, refundCash: 0, refundObligations: 0,
  methods: { money: 0, bank: 0, vnpay: 0, zalopay: 200000, card: 0 }
};
const reconciliation = {
  refundsPending: 400000, refundsCapHeld: 0,
  salesMissingTime: { count: 2, amount: 0, snapshotAmount: 500000 },
  salesMissingAmount: 1, salesUnverifiedAmount: 1, unsupportedMethod: 0,
  refundsMissingRecordedTime: 0, refundsMissingTime: 0, refundsUndatedAmount: 0, refundUnverified: 0
};
const wallet = {
  topupReceived: 0, topupChip: 700000, topupPending: 0, topupCapHeld: 250000, topupAwaitingPayment: 80000, topupFailed: 20000,
  unresolvedDebit: { count: 1, amount: 123000 }, unlinkedDebit: { count: 0, amount: 0 }, lateDebit: { count: 0, amount: 0 },
  topupMissingRecordedTime: 0, topupMissingTime: 0, topupUndatedAmount: 0, topupUnverified: 0
};
function dashboard(extraPermissions) {
  const permissions = ['dashboard-view', ...extraPermissions];
  const readCard = permissions.includes('card-view');
  return pug.renderFile('views/admin/pages/dashboard.pug', {
    ...shared, permissions, finance: { period, reconciliation, ...(readCard ? { wallet } : {}) },
    selectedMonth: '2026-12', paymentMethods: paymentMethod.filter(method => method.value !== 'momo'),
    overview: { totalAdmin: 8, totalUser: 210, totalOrder: 25 },
    cardStats: readCard ? { byStatus: { active: 1, locked: 1, revoked: 2 }, serverBalance: 2500000, checkinRate: [] } : null,
    orders: []
  });
}

test('G3.1 dashboard cards and disclosure preserve every displayed finance binding', () => {
  const nodes = elements(dashboard(['card-view', 'order-view']));
  const moneyKeys = ['net', 'gross', 'money', 'bank', 'vnpay', 'zalopay', 'card', 'refunded', 'refundChip', 'refundCash',
    'refundObligations', 'refundsPending', 'refundsCapHeld', 'topupReceived', 'topupChip', 'topupPending', 'topupCapHeld',
    'topupAwaitingPayment', 'topupFailed', 'salesUndatedAmount', 'salesSnapshotAmount', 'refundsUndatedAmount',
    'unresolvedDebitAmount', 'unlinkedDebitAmount', 'lateDebitAmount', 'topupUndatedAmount'];
  const countKeys = ['orderCount', 'salesMissingTimeCount', 'salesMissingAmount', 'salesUnverifiedAmount', 'unsupportedMethod',
    'refundsMissingRecordedTime', 'refundsMissingTime', 'refundUnverified', 'unresolvedDebitCount', 'unlinkedDebitCount',
    'lateDebitCount', 'topupMissingRecordedTime', 'topupMissingTime', 'topupUnverified'];
  const values = (mapping, key) => nodes.filter(node => node.attrs[mapping] === key).map(node => node.text);
  for (const key of moneyKeys) assert.equal(values('data-finance', key).length, key === 'card' ? 2 : 1, key);
  for (const key of countKeys) assert.equal(values('data-finance-count', key).length, 1, key);
  assert.deepEqual(values('data-finance', 'net'), ['-400.000 đ']);
  assert.deepEqual(values('data-finance', 'refundCash'), ['0 đ']);
  for (const group of ['Doanh thu theo phương thức', 'Nạp ví', 'Hoàn tiền', 'Đối soát dữ liệu']) {
    assert.ok(nodes.some(node => node.tag === 'h3' && node.text === group), group);
  }
  assert.ok(nodes.some(node => node.tag === 'details' && node.attrs.id === 'finance-reconciliation-details'));
  assert.ok(nodes.some(node => node.tag === 'a' && node.attrs.class?.includes('dashboard-orders-link') && node.attrs.href === '/admin/order/list'));
});

test('G3.1 dashboard restricted render has no wallet payload or gated detail bindings', () => {
  const html = dashboard([]);
  const nodes = elements(html);
  const payload = JSON.parse(nodes.find(node => Object.hasOwn(node.attrs, 'data-dashboard-finance')).attrs['data-dashboard-finance']);
  assert.equal(payload.wallet, undefined);
  assert.doesNotMatch(html, /topupReceived|unresolvedDebitAmount|dashboard-orders-link|Thẻ thành viên/);
  assert.equal(nodes.filter(node => node.attrs['data-finance'] === 'card').length, 1);
  assert.ok(nodes.some(node => node.tag === 'h3' && node.text === 'Hoàn tiền'));
});

test('G3.1 customer profile keeps hierarchy, escaping and role-gated markup', () => {
  const customer = { fullName: '<img src=x onerror=alert(1)>', email: 'customer@example.test', totalSpent: 30000000, status: 'active' };
  const owner = '650000000000000000000003';
  function profile(canReadCard) {
    return pug.renderFile('views/admin/pages/user-detail.pug', {
      ...shared, permissions: ['customer-view'], customer, owner, current: { status: 'active', ...(canReadCard ? { cardId: '00000000000000000000000000000310', balance: 2500000 } : {}) },
      canReadCard, snapshot: canReadCard ? { lastChip: null, pending: { credit: 400000, cap: 250000, debit: 123000 }, lateDebit: { amount: 0 } } : null,
      tab: 'profile', tabs: [{ value: 'profile', label: 'Hồ sơ' }], tier: { label: 'Gold', percent: 5 }, vietnamDate: () => ''
    });
  }
  const html = profile(true);
  const nodes = elements(html);
  const crumb = nodes.find(node => node.tag === 'li' && node.attrs['aria-current'] === 'page');
  assert.equal(crumb?.text, customer.fullName);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(nodes.some(node => node.tag === 'a' && node.attrs['aria-current'] === 'page' && node.attrs.href === '/admin/user/detail/' + owner + '?tab=profile'));
  for (const field of ['Họ tên', 'Email', 'Điện thoại', 'Ngày tham gia', 'Tài khoản', 'Thẻ hiện hành trên hệ thống',
    'Hạng và chiết khấu', 'Tổng chi tiêu', 'Số dư ví trên hệ thống', 'Số dư chip tại biên nhận gần nhất',
    'Ghi có chờ đồng bộ/đối soát', 'Ghi có giữ vì hạn mức', 'Ghi nợ chờ xác nhận/đối soát', 'Ghi nợ có biên nhận đến muộn']) {
    assert.ok(nodes.some(node => node.tag === 'dt' && node.text === field), field);
  }
  const heading = label => nodes.some(node => node.tag === 'h2' && node.text === label);
  assert.ok(heading('Thông tin cá nhân') && heading('Thành viên và thẻ') && heading('Ví và công nợ'));
  assert.doesNotMatch(profile(false), /00000000000000000000000000000310|Ví và công nợ|Số dư ví trên hệ thống/);
});
