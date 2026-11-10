const Tour = require("../../models/tour.model");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");

const variableConfig = require("../../config/variable");
const gererateHelper = require("../../helpers/generate.helper");
const zalopayHelper = require("../../helpers/zalopay.helper");
const vnpayHelper = require("../../helpers/vnpay.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const tierHelper = require("../../helpers/tier.helper");
const CardTransaction = require("../../models/card-transaction.model");
const moment = require("moment");

// Giới hạn một giao dịch ví thẻ (khớp CardTransaction.amount).
const CARD_MAX_AMOUNT = 50000000;
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const orderError = message => Object.assign(new Error(message), {userMessage: message});
const validQuantity = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000;
const validPrice = value => Number.isSafeInteger(value) && value >= 0;

// Chỉ nhận tourId, nơi khởi hành và số lượng từ client; mọi giá/tên/ảnh lấy từ database.
function cleanItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20)
    throw orderError('Vui lòng đặt ít nhất 1 tour!');
  const seen = new Set();
  return raw.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.tourId !== 'string' || !OBJECT_ID.test(item.tourId)
      || typeof item.locationFrom !== 'string' || !OBJECT_ID.test(item.locationFrom))
      throw orderError('Thông tin tour không hợp lệ!');
    const quantities = [item.quantityAdult, item.quantityChildren, item.quantityBaby];
    if (!quantities.every(validQuantity) || quantities.reduce((sum, value) => sum + value, 0) < 1)
      throw orderError('Số lượng hành khách không hợp lệ!');
    if (seen.has(item.tourId))
      throw orderError('Mỗi tour chỉ được xuất hiện một lần trong đơn hàng!');
    seen.add(item.tourId);
    return {
      tourId: item.tourId,
      locationFrom: item.locationFrom,
      quantityAdult: item.quantityAdult,
      quantityChildren: item.quantityChildren,
      quantityBaby: item.quantityBaby
    };
  });
}

module.exports.createPost = async (req, res) => {
  const reserved = [];
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (typeof body.fullName !== 'string' || !body.fullName.trim() || body.fullName.length > 100
      || typeof body.phone !== 'string' || !body.phone.trim() || body.phone.length > 20
      || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000)))
      throw orderError('Thông tin khách hàng không hợp lệ!');
    if (typeof body.paymentMethod !== 'string' || !variableConfig.paymentMethod.some(method => method.value === body.paymentMethod))
      throw orderError('Phương thức thanh toán không hợp lệ!');
    // Phiên đăng nhập lấy từ cookie phía server; không bao giờ đọc customerId từ body.
    const customer = req.customer && req.card ? req.customer : null;
    if (body.paymentMethod === 'card' && !customer)
      throw orderError('Vui lòng đăng nhập bằng thẻ thành viên để thanh toán bằng ví thẻ!');

    const items = cleanItems(body.items);
    const tours = [];
    for (const item of items) {
      const infoTour = await Tour.findOne({_id: item.tourId, status: "active", deleted: false});
      if (!infoTour || ![infoTour.priceNewAdult, infoTour.priceNewChildren, infoTour.priceNewBaby].every(validPrice))
        throw orderError('Tour không còn tồn tại hoặc giá không hợp lệ, vui lòng chọn lại!');
      tours.push(infoTour);
      item.priceNewAdult = infoTour.priceNewAdult;
      item.priceNewChildren = infoTour.priceNewChildren;
      item.priceNewBaby = infoTour.priceNewBaby;
      item.departureDate = infoTour.departureDate;
      item.avatar = infoTour.avatar;
      item.name = infoTour.name;
      item.ticketStatus = 'none';
    }

    // Tạm tính, giảm giá theo hạng và tổng đều do backend tính từ dữ liệu database.
    const subTotal = items.reduce((sum, item) => sum + item.priceNewAdult * item.quantityAdult + item.priceNewChildren * item.quantityChildren + item.priceNewBaby * item.quantityBaby, 0);
    if (!Number.isSafeInteger(subTotal) || subTotal < 1)
      throw orderError('Tổng tiền đơn hàng không hợp lệ!');
    const discount = customer ? tierHelper.discountFor(customer.totalSpent || 0, subTotal) : 0;
    const total = subTotal - discount;
    if (!Number.isSafeInteger(total) || total < 1 || discount < 0 || discount > subTotal)
      throw orderError('Tổng tiền đơn hàng không hợp lệ!');
    if (body.paymentMethod === 'card' && total > CARD_MAX_AMOUNT)
      throw orderError('Đơn hàng vượt hạn mức thanh toán một lần của ví thẻ, vui lòng chọn phương thức khác!');

    // Giữ chỗ nguyên tử: kiểm tra và trừ tồn trong cùng một lệnh để không bán vượt.
    for (const [index, item] of items.entries()) {
      const result = await Tour.updateOne({
        _id: item.tourId,
        status: "active",
        deleted: false,
        stockAdult: {$gte: item.quantityAdult},
        stockChildren: {$gte: item.quantityChildren},
        stockBaby: {$gte: item.quantityBaby}
      }, {
        $inc: {stockAdult: -item.quantityAdult, stockChildren: -item.quantityChildren, stockBaby: -item.quantityBaby}
      });
      if (result.modifiedCount !== 1)
        throw orderError(`Số lượng chỗ của tour ${tours[index].name} đã hết, vui lòng chọn lại`);
      reserved.push(item);
    }

    const newRecord = new Order({
      orderCode: "OD" + gererateHelper.generateRandomNumber(10),
      fullName: body.fullName,
      phone: body.phone,
      note: body.note || '',
      items,
      customerId: customer ? String(customer._id) : undefined,
      subTotal,
      discount,
      total,
      paymentMethod: body.paymentMethod,
      paymentStatus: "unpaid", // unpaid: chưa thánh toán, paid: đã thanh toán
      status: "initial" // initial: khởi tạo, done: hoàn thành, cancel: hủy
    });
    await newRecord.save();

    res.json({
      code: "success",
      message: "Đặt hàng thành công!",
      orderId: newRecord.id
    })
  } catch (error) {
    // Hoàn lại chỗ đã giữ khi đơn không được lưu.
    for (const item of reserved) {
      await Tour.updateOne({_id: item.tourId}, {
        $inc: {stockAdult: item.quantityAdult, stockChildren: item.quantityChildren, stockBaby: item.quantityBaby}
      }).catch(() => {});
    }
    if (!error.userMessage)
      console.log(error.name);

    res.json({
      code: "error",
      message: error.userMessage || "Đặt hàng không thành công!"
    })
  }
}

module.exports.success = async (req, res) => {
  try {
    const { orderId, phone } = req.query;

    const orderDetail = await Order.findOne({
      _id: orderId,
      phone: phone
    })

    if(!orderDetail) {
      res.redirect("/");
      return;
    }

    orderDetail.paymentMethodName = variableConfig.paymentMethod.find(item => item.value == orderDetail.paymentMethod).label;

    orderDetail.paymentStatusName = variableConfig.paymentStatus.find(item => item.value == orderDetail.paymentStatus).label;

    orderDetail.statusName = variableConfig.orderStatus.find(item => item.value == orderDetail.status).label;

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("HH:mm - DD/MM/YYYY");

    for (const item of orderDetail.items) {
      const infoTour = await Tour.findOne({
        _id: item.tourId,
        deleted: false
      })

      if(infoTour) {
        item.slug = infoTour.slug;
      }

      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");

      const city = await City.findOne({
        _id: item.locationFrom
      })

      if(city) {
        item.locationFromName = city.name;
      }
    }

    res.render("client/pages/order-success", {
      pageTitle: "Đặt hàng thành công",
      orderDetail: orderDetail
    });
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
}

module.exports.paymentZaloPay = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (typeof orderId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(orderId)) return res.redirect('/');
    const orderDetail = await Order.findOne({
      _id: orderId, paymentStatus: 'unpaid', paymentMethod: 'zalopay', deleted: false, status: {$ne: 'cancel'}
    });
    if (!orderDetail) return res.redirect('/');
    const url = await zalopayHelper.createOrder({
      appUser: `${orderDetail.phone}-${orderDetail.id}`,
      amount: orderDetail.total,
      description: `Thanh toán đơn hàng ${orderDetail.orderCode}`,
      redirectUrl: `${process.env.DOMAIN_WEBSITE}/order/success?orderId=${orderDetail.id}&phone=${orderDetail.phone}`,
      callbackPath: '/order/payment-zalopay-result'
    });
    return res.redirect(url || '/');
  } catch {
    return res.redirect('/');
  }
}

module.exports.paymentZaloPayResultPost = async (req, res) => {
  try {
    const verified = zalopayHelper.verifyCallback(req.body);
    if (!verified.valid) return res.json({return_code: -1, return_message: 'mac not equal'});
    const data = verified.data;
    if (!/^\+?\d{8,15}-[a-fA-F0-9]{24}$/.test(data.app_user)) return res.json({return_code: -1, return_message: 'invalid payment'});
    const [phone, orderId] = data.app_user.split('-');
    const identity = {
      _id: orderId, phone, total: data.amount, paymentMethod: 'zalopay', deleted: false, status: {$ne: 'cancel'}
    };
    const order = await Order.findOne(identity);
    if (!order || !['unpaid', 'paid'].includes(order.paymentStatus)) return res.json({return_code: -1, return_message: 'invalid payment'});
    const changed = await orderPaymentHelper.markOrderPaid({_id: orderId, phone, deleted: false, total: data.amount}, 'zalopay');
    // Callback lặp chỉ được ACK khi cùng identity/amount vẫn là đơn paid hợp lệ.
    if (!changed && !await Order.findOne({...identity, paymentStatus: 'paid'})) return res.json({return_code: -1, return_message: 'invalid payment'});
    return res.json({return_code: 1, return_message: 'success'});
  } catch {
    // Không trả lỗi DB/provider chứa dữ liệu nhạy cảm ra ngoài hoặc ghi MAC vào log.
    return res.json({return_code: 0, return_message: 'processing failed'});
  }
}

module.exports.paymentVNPay = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (typeof orderId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(orderId)) return res.redirect('/');
    const orderDetail = await Order.findOne({
      _id: orderId, paymentStatus: 'unpaid', paymentMethod: 'vnpay', deleted: false, status: {$ne: 'cancel'}
    });
    if (!orderDetail) return res.redirect('/');
    const txnRef = `${orderDetail.id}-${Date.now()}`;
    const ipAddr = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.socket?.remoteAddress || req.connection?.socket?.remoteAddress;
    const url = vnpayHelper.buildPaymentUrl({
      txnRef,
      amount: orderDetail.total,
      orderInfo: 'Thanh toan cho ma GD:' + txnRef,
      returnPath: '/order/payment-vnpay-result',
      ipAddr
    });
    return res.redirect(url);
  } catch {
    return res.redirect('/');
  }
}

module.exports.paymentVNPayResult = async (req, res) => {
  try {
    const verified = vnpayHelper.verifyReturn(req.query);
    if (!verified.valid || !verified.success) return res.redirect('/');
    // Chỉ signed reference chọn đơn; không dùng orderId tự khai trong query.
    const reference = /^([a-fA-F0-9]{24})-([0-9]{13})$/.exec(verified.txnRef);
    const rawAmount = req.query.vnp_Amount;
    if (!reference || !process.env.VNPAY_CODE || req.query.vnp_TmnCode !== process.env.VNPAY_CODE || typeof rawAmount !== 'string' || !/^[1-9][0-9]*$/.test(rawAmount)) return res.redirect('/');
    const scaled = Number(rawAmount);
    if (!Number.isSafeInteger(scaled) || scaled % 100 !== 0) return res.redirect('/');
    const orderId = reference[1];
    const amount = scaled / 100;
    const identity = {_id: orderId, total: amount, paymentMethod: 'vnpay', deleted: false, status: {$ne: 'cancel'}};
    const order = await Order.findOne(identity);
    if (!order || !['unpaid', 'paid'].includes(order.paymentStatus)) return res.redirect('/');
    const changed = await orderPaymentHelper.markOrderPaid({_id: orderId, phone: order.phone, deleted: false, total: amount}, 'vnpay');
    if (!changed && !await Order.findOne({...identity, phone: order.phone, paymentStatus: 'paid'})) return res.redirect('/');
    return res.redirect(`${process.env.DOMAIN_WEBSITE}/order/success?orderId=${orderId}&phone=${order.phone}`);
  } catch {
    return res.redirect('/');
  }
}

module.exports.paymentCard = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!req.customer || !req.card) return res.redirect('/account/login');
    const orderId = req.query.orderId;
    if (typeof orderId !== 'string' || !OBJECT_ID.test(orderId)) return res.redirect('/');
    // Đơn phải thuộc đúng khách trong phiên; đơn người khác hoặc không tồn tại đều về trang chủ.
    const order = await Order.findOne({
      _id: orderId, customerId: String(req.customer._id), paymentMethod: 'card', deleted: false, status: {$ne: 'cancel'}
    }).lean();
    if (!order) return res.redirect('/');
    const successUrl = `/order/success?orderId=${order._id}&phone=${encodeURIComponent(order.phone)}`;
    if (order.paymentStatus === 'paid') return res.redirect(successUrl);
    if (order.paymentStatus !== 'unpaid') return res.redirect('/');
    const tx = order.cardTxRef ? await CardTransaction.findOne({txRef: order.cardTxRef}).lean() : null;
    const unresolved = !!tx && tx.status !== 'done' && (tx.status === 'sent' || !!tx.signedOpId);
    for (const item of order.items) {
      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
    }
    res.render("client/pages/order-payment-card", {
      pageTitle: "Thanh toán bằng ví thẻ",
      order,
      card: req.card,
      unresolved,
      successUrl
    });
  } catch (error) {
    return res.redirect('/');
  }
}
