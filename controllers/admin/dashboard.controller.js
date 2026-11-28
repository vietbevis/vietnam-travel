const Account = require('../../models/account-admin.model');
const Customer = require('../../models/customer.model');
const Order = require('../../models/order.model');
const { cardStats } = require('../../helpers/card-stats.helper');
const { revenue, monthValue, currentMonth, validMonth } = require('../../helpers/dashboard-revenue.helper');
const { vietnamDate, objectId } = require('../../helpers/admin-list.helper');
const { paymentMethod, paymentStatus, orderStatus } = require('../../config/variable');

const label = (choices, value) => choices.find(choice => choice.value === value)?.label || 'Chưa xác định';

async function latestOrders() {
  const rows = await Order.find({ deleted: { $ne: true } }).select('orderCode customerId fullName total paymentMethod paymentStatus status createdAt')
    .sort({ createdAt: -1, _id: -1 }).limit(5).lean();
  return rows.map(row => ({
    id: String(row._id), code: row.orderCode, customer: objectId(row.customerId) ? row.fullName || 'Khách thành viên' :
      row.customerId == null ? 'Khách vãng lai' : 'Chưa xác định',
    amount: row.total, method: label(paymentMethod, row.paymentMethod), payment: label(paymentStatus, row.paymentStatus),
    status: label(orderStatus, row.status), date: vietnamDate(row.createdAt)
  }));
}

module.exports.dashboard = async (req, res) => {
  const selected = req.query?.month;
  let { year, month } = currentMonth();
  if (selected !== undefined) {
    if (typeof selected !== 'string' || !/^\d{4}-\d{2}$/.test(selected)) return res.status(400).send('Tháng không hợp lệ.');
    [year, month] = selected.split('-').map(Number);
    if (!validMonth(year, month)) return res.status(400).send('Tháng không hợp lệ.');
  }
  const canReadCard = req.permissions?.includes('card-view');
  const canReadOrders = req.permissions?.includes('order-view');
  const [finance, totalAdmin, totalUser, totalOrder, cards, orders] = await Promise.all([
    revenue(year, month, canReadCard),
    Account.countDocuments({ deleted: false }),
    Customer.countDocuments({ deleted: { $ne: true } }),
    Order.countDocuments(),
    canReadCard ? cardStats() : null,
    canReadOrders ? latestOrders() : null
  ]);
  res.render('admin/pages/dashboard', {
    pageTitle: 'Tổng quan', overview: { totalAdmin, totalUser, totalOrder }, finance,
    selectedMonth: monthValue(finance.period), paymentMethods: paymentMethod.filter(item => item.value !== 'momo'),
    ...(cards ? { cardStats: cards } : {}), orders
  });
};

module.exports.revenueChartPost = async (req, res) => {
  const { currentMonth: month, currentYear: year, previousMonth, previousYear } = req.body || {};
  const expectedMonth = month === 1 ? 12 : month - 1;
  const expectedYear = month === 1 ? year - 1 : year;
  if (!validMonth(year, month) || (previousMonth !== undefined && previousMonth !== expectedMonth) ||
      (previousYear !== undefined && previousYear !== expectedYear)) {
    return res.status(400).json({ code: 'error', message: 'Khoảng ngày không hợp lệ.' });
  }
  const report = await revenue(year, month, req.permissions?.includes('card-view'));
  res.json({
    code: 'success', ...report,
    dataMonthCurrent: report.period.days.map(day => day.net),
    dataMonthPrevious: report.previous.days.map(day => day.net)
  });
};
