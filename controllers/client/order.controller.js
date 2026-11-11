const Tour = require("../../models/tour.model");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");

const variableConfig = require("../../config/variable");
const gererateHelper = require("../../helpers/generate.helper");
const zalopayHelper = require("../../helpers/zalopay.helper");
const vnpayHelper = require("../../helpers/vnpay.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const tierHelper = require("../../helpers/tier.helper");
const moment = require("moment");
const mongoose = require("mongoose");

module.exports.createPost = async (req, res) => {
  let session;
  try {
    // Danh tính khách chỉ lấy từ phiên đăng nhập, không tin dữ liệu client gửi lên.
    for (const field of ["customerId", "cardTxRef", "deleted", "deletedBy", "deletedAt", "updatedBy"]) {
      delete req.body[field];
    }
    if (req.body.paymentMethod === "card" && !req.customer) {
      res.json({
        code: "error",
        message: "Vui lòng đăng nhập bằng thẻ để thanh toán bằng ví thẻ"
      })
      return;
    }
    if (req.customer) {
      req.body.customerId = String(req.customer._id);
    }

    // Kiểm tra toàn bộ item phía server trước mọi thay đổi tồn kho:
    // tour phải đang hoạt động, số lượng là số nguyên không âm, ít nhất một khách.
    const items = req.body.items;
    const validQuantity = value => Number.isSafeInteger(value) && value >= 0;
    let totalQuantity = 0;
    let itemsValid = Array.isArray(items) && items.length > 0;
    if (itemsValid) {
      for (const item of items) {
        const validShape = item && typeof item === "object" && typeof item.tourId === "string" && /^[a-fA-F0-9]{24}$/.test(item.tourId)
          && validQuantity(item.quantityAdult) && validQuantity(item.quantityChildren) && validQuantity(item.quantityBaby);
        const tourExists = validShape && await Tour.exists({_id: item.tourId, status: "active", deleted: false});
        if (!tourExists) {
          itemsValid = false;
          break;
        }
        totalQuantity += item.quantityAdult + item.quantityChildren + item.quantityBaby;
        if (!Number.isSafeInteger(totalQuantity)) {
          itemsValid = false;
          break;
        }
      }
    }
    if (!itemsValid || totalQuantity < 1) {
      res.json({
        code: "error",
        message: "Thông tin tour hoặc số lượng không hợp lệ, vui lòng chọn lại"
      })
      return;
    }

    req.body.orderCode = "OD" + gererateHelper.generateRandomNumber(10);

    session = await mongoose.startSession();
    let newRecord;
    // Giữ chỗ và lưu đơn cùng commit: lỗi ở bất kỳ tour/bước lưu nào đều hoàn kho bằng rollback.
    // Không hoàn kho bằng phép gán từ snapshot cũ vì có thể ghi đè lượt đặt khác.
    await session.withTransaction(async () => {
      // Danh sách tour
      for (const item of req.body.items) {
        // Trạng thái vé do hệ thống quản lý, không nhận từ client
        item.ticketStatus = "none";
        delete item.checkedInAt;
        delete item.checkedInBy;

        const infoTour = await Tour.findOneAndUpdate({
          _id: item.tourId,
          status: "active",
          deleted: false,
          stockAdult: {$gte: item.quantityAdult},
          stockChildren: {$gte: item.quantityChildren},
          stockBaby: {$gte: item.quantityBaby}
        }, {$inc: {
          stockAdult: -item.quantityAdult,
          stockChildren: -item.quantityChildren,
          stockBaby: -item.quantityBaby
        }}, {session, new: true});

        if (!infoTour) throw new Error("Tour không còn đủ chỗ hoặc đã ngừng hoạt động");

        if(infoTour) {
          // Thêm giá
          item.priceNewAdult = infoTour.priceNewAdult;
          item.priceNewChildren = infoTour.priceNewChildren;
          item.priceNewBaby = infoTour.priceNewBaby;

          // Ngày khởi hành
          item.departureDate = infoTour.departureDate;

          // Ảnh
          item.avatar = infoTour.avatar;

          // Tiêu đề
          item.name = infoTour.name;

          if (![item.priceNewAdult, item.priceNewChildren, item.priceNewBaby].every(value => Number.isSafeInteger(value) && value >= 0))
            throw new Error("Giá tour không hợp lệ");
        }
      }

      // Thanh toán
      // Tạm tính
      req.body.subTotal = req.body.items.reduce((sum, item) => {
        return sum + ((item.priceNewAdult * item.quantityAdult) + (item.priceNewChildren * item.quantityChildren) + (item.priceNewBaby * item.quantityBaby));
      }, 0);
      if (!Number.isSafeInteger(req.body.subTotal) || req.body.subTotal < 0)
        throw new Error("Tổng giá trị đơn không hợp lệ");

      // Giảm theo hạng thành viên (chỉ khi đã đăng nhập)
      req.body.discount = 0;
      if (req.customer && Number.isSafeInteger(req.body.subTotal) && req.body.subTotal >= 0) {
        req.body.discount = tierHelper.discountFor(req.customer.totalSpent || 0, req.body.subTotal);
      }

      // Thanh toán
      req.body.total = req.body.subTotal - req.body.discount;

      // Trạng thái thanh toán
      req.body.paymentStatus = "unpaid"; // unpaid: chưa thánh toán, paid: đã thanh toán

      // Trạng thái đơn hàng
      req.body.status = "initial"; // initial: khởi tạo, done: hoàn thành, cancel: hủy

      newRecord = new Order(req.body);
      await newRecord.save({session});
    });

    res.json({
      code: "success",
      message: "Đặt hàng thành công!",
      orderId: newRecord.id
    })
  } catch (error) {
    console.log(error);

    res.json({
      code: "error",
      message: "Đặt hàng không thành công!"
    })
  } finally {
    if (session) await session.endSession();
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

module.exports.paymentCard = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (!req.customer || !req.card) return res.redirect('/account/login');
    if (typeof orderId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(orderId)) return res.redirect('/');
    const orderDetail = await Order.findOne({
      _id: orderId, customerId: String(req.customer._id), paymentStatus: 'unpaid', paymentMethod: 'card', deleted: false, status: {$ne: 'cancel'}
    });
    if (!orderDetail) return res.redirect('/');
    res.set('Cache-Control', 'no-store');
    res.render("client/pages/order-payment-card", {
      pageTitle: "Thanh toán bằng ví thẻ",
      orderDetail: orderDetail,
      cardInfo: {cardId: req.card.cardId, balance: req.card.balance}
    });
  } catch {
    return res.redirect('/');
  }
}

// Cổng đã thu tiền nhưng ghi nhận đơn bị lỗi: ghi log đủ để nhân viên đối soát (không ghi chữ ký, khoá hay payload cổng).
function logPaymentFailure(gateway, info, error) {
  console.error('[thanh-toan] Ghi nhận thanh toán thất bại, cần đối soát thủ công: ' + JSON.stringify({
    gateway,
    orderId: info.orderId,
    orderCode: info.orderCode,
    amount: info.amount,
    reference: info.reference,
    error: String(error?.message || error).slice(0, 300),
    at: new Date().toISOString()
  }));
}

// VNPay không gọi lại: khách đã trả tiền thì hiện trang "đang xử lý" thay vì im lặng chuyển về trang chủ.
function paymentProcessing(res, gateway, info, error) {
  logPaymentFailure(gateway, info, error);
  return res.render("client/pages/order-payment-processing", {
    pageTitle: "Đang xử lý thanh toán",
    orderCode: info.orderCode || info.orderId,
    amount: info.amount,
    gatewayName: gateway === 'vnpay' ? 'VNPay' : 'ZaloPay'
  });
}

module.exports.paymentZaloPay = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    if (typeof orderId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(orderId)) return res.redirect('/');
    const orderDetail = await Order.findOne({
      _id: orderId, paymentStatus: 'unpaid', paymentMethod: 'zalopay', deleted: false, status: {$ne: 'cancel'}
    });
    if (!orderDetail) return res.redirect('/');
    // Số điện thoại nhập tự do ("0901 234 567") được chuẩn hoá trước khi đưa vào app_user của ZaloPay.
    const appPhone = zalopayHelper.normalizePhone(orderDetail.phone);
    // Callback chỉ nhận ^\+?\d{8,15}: số không đạt thì báo lỗi ngay, không để khách trả tiền rồi callback bị từ chối.
    if (!/^\+?\d{8,15}$/.test(appPhone)) {
      if (typeof req.flash === 'function') req.flash('error', 'Số điện thoại của đơn hàng không hợp lệ để thanh toán qua ZaloPay. Vui lòng liên hệ hỗ trợ hoặc chọn phương thức thanh toán khác.');
      return res.redirect(`/order/success?orderId=${orderDetail.id}&phone=${encodeURIComponent(orderDetail.phone)}`);
    }
    const url = await zalopayHelper.createOrder({
      appUser: `${appPhone}-${orderDetail.id}`,
      amount: orderDetail.total,
      description: `Thanh toán đơn hàng ${orderDetail.orderCode}`,
      redirectUrl: `${process.env.DOMAIN_WEBSITE}/order/success?orderId=${orderDetail.id}&phone=${encodeURIComponent(orderDetail.phone)}`,
      callbackPath: '/order/payment-zalopay-result'
    });
    return res.redirect(url || '/');
  } catch {
    return res.redirect('/');
  }
}

module.exports.paymentZaloPayResultPost = async (req, res) => {
  let received;
  try {
    const verified = zalopayHelper.verifyCallback(req.body);
    if (!verified.valid) return res.json({return_code: -1, return_message: 'mac not equal'});
    const data = verified.data;
    if (!/^\+?\d{8,15}-[a-fA-F0-9]{24}$/.test(data.app_user)) return res.json({return_code: -1, return_message: 'invalid payment'});
    const [phone, orderId] = data.app_user.split('-');
    received = {orderId, amount: data.amount, reference: data.app_trans_id};
    const reference = {
      _id: orderId, total: data.amount, paymentMethod: 'zalopay', deleted: false, status: {$ne: 'cancel'}
    };
    const found = await Order.findOne(reference);
    if (found) received.orderCode = found.orderCode;
    // So khớp chặt: số trong app_user phải đúng bằng số điện thoại của đơn sau khi chuẩn hoá.
    if (!found || zalopayHelper.normalizePhone(found.phone) !== phone) return res.json({return_code: -1, return_message: 'invalid payment'});
    const identity = {...reference, phone: found.phone};
    const order = found;
    if (!['unpaid', 'paid'].includes(order.paymentStatus)) return res.json({return_code: -1, return_message: 'invalid payment'});
    const changed = await orderPaymentHelper.markOrderPaid({_id: orderId, phone: found.phone, deleted: false, total: data.amount}, 'zalopay');
    // Callback lặp chỉ được ACK khi cùng identity/amount vẫn là đơn paid hợp lệ.
    if (!changed && !await Order.findOne({...identity, paymentStatus: 'paid'})) return res.json({return_code: -1, return_message: 'invalid payment'});
    return res.json({return_code: 1, return_message: 'success'});
  } catch (error) {
    // Không trả lỗi DB/provider chứa dữ liệu nhạy cảm ra ngoài hoặc ghi MAC vào log; ZaloPay sẽ gọi lại.
    if (received) logPaymentFailure('zalopay', received, error);
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
  // Có giá trị khi VNPay đã xác nhận thanh toán thành công (chữ ký hợp lệ): lỗi sau đó không được im lặng.
  let received;
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
    received = {orderId, amount, reference: verified.txnRef};
    const identity = {_id: orderId, total: amount, paymentMethod: 'vnpay', deleted: false, status: {$ne: 'cancel'}};
    const order = await Order.findOne(identity);
    if (order) received.orderCode = order.orderCode;
    // Từ đây VNPay đã xác nhận thu tiền: mọi nhánh không ghi nhận được đều phải ghi log đối soát và hiện trang đang xử lý.
    if (!order || !['unpaid', 'paid'].includes(order.paymentStatus)) return paymentProcessing(res, 'vnpay', received, 'không có đơn khớp số tiền/phương thức hoặc đơn đã huỷ, xoá, đổi trạng thái thanh toán');
    const changed = await orderPaymentHelper.markOrderPaid({_id: orderId, phone: order.phone, deleted: false, total: amount}, 'vnpay');
    if (!changed && !await Order.findOne({...identity, phone: order.phone, paymentStatus: 'paid'})) return paymentProcessing(res, 'vnpay', received, 'không đánh dấu được đơn đã thanh toán');
    return res.redirect(`${process.env.DOMAIN_WEBSITE}/order/success?orderId=${orderId}&phone=${encodeURIComponent(order.phone)}`);
  } catch (error) {
    if (received) return paymentProcessing(res, 'vnpay', received, error);
    return res.redirect('/');
  }
}
