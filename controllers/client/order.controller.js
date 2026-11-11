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

module.exports.createPost = async (req, res) => {
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

    req.body.orderCode = "OD" + gererateHelper.generateRandomNumber(10);

    // Danh sách tour
    for (const item of req.body.items) {
      // Trạng thái vé do hệ thống quản lý, không nhận từ client
      item.ticketStatus = "none";
      delete item.checkedInAt;
      delete item.checkedInBy;

      const infoTour = await Tour.findOne({
        _id: item.tourId,
        status: "active",
        deleted: false
      })

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

        // Cập nhật lại số lượng còn lại của tour
        if(infoTour.stockAdult < item.quantityAdult || infoTour.stockChildren < item.quantityChildren || infoTour.stockBaby < item.quantityBaby) {
          res.json({
            code: "error",
            message: `Số lượng chỗ của tour ${item.name} đã hết, vui lòng chọn lại`
          })
          return;
        }

        await Tour.updateOne({
          _id: item.tourId
        }, {
          stockAdult: infoTour.stockAdult - item.quantityAdult,
          stockChildren: infoTour.stockChildren - item.quantityChildren,
          stockBaby: infoTour.stockBaby - item.quantityBaby,
        })
      }
    }

    // Thanh toán
    // Tạm tính
    req.body.subTotal = req.body.items.reduce((sum, item) => {
      return sum + ((item.priceNewAdult * item.quantityAdult) + (item.priceNewChildren * item.quantityChildren) + (item.priceNewBaby * item.quantityBaby));
    }, 0);

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

    const newRecord = new Order(req.body);
    await newRecord.save();

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
