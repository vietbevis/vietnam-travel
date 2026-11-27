const Tour = require('../models/tour.model');

async function restoreOrderStock(items, session, refusal = message => new Error(message)) {
  if (!Array.isArray(items) || !items.length) throw refusal('Đơn không có danh sách tour hợp lệ.');

  const stockByTour = new Map();
  let totalPassengers = 0;
  for (const item of items) {
    const tourId = String(item.tourId || '').toLowerCase();
    const quantities = [item.quantityAdult, item.quantityChildren, item.quantityBaby];
    if (!/^[a-f0-9]{24}$/.test(tourId) || !quantities.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw refusal('Số lượng hoặc mã tour trong đơn không hợp lệ.');
    }
    totalPassengers += quantities.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(totalPassengers)) throw refusal('Số lượng khách không hợp lệ.');
    const previous = stockByTour.get(tourId) || [0, 0, 0];
    stockByTour.set(tourId, quantities.map((value, index) => value + previous[index]));
  }
  if (totalPassengers < 1) throw refusal('Đơn không có hành khách hợp lệ.');

  // Người gọi chốt quyền hoàn chỗ trên Order trong cùng transaction trước khi cộng vào Tour.
  for (const [tourId, [stockAdult, stockChildren, stockBaby]] of stockByTour) {
    const result = await Tour.updateOne({ _id: tourId }, { $inc: { stockAdult, stockChildren, stockBaby } }, { session });
    if (result.matchedCount !== 1) throw refusal('Không tìm thấy tour để hoàn chỗ. Đã rollback.');
  }
}

module.exports = { restoreOrderStock };
