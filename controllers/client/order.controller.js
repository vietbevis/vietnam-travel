const Tour = require("../../models/tour.model");
const Order = require("../../models/order.model");
const CheckoutAttempt = require("../../models/checkout-attempt.model");
const City = require("../../models/city.model");
const Card = require("../../models/card.model");
const Customer = require("../../models/customer.model");
const Tx = require("../../models/card-transaction.model");

const variableConfig = require("../../config/variable");
const gererateHelper = require("../../helpers/generate.helper");
const zalopayHelper = require("../../helpers/zalopay.helper");
const vnpayHelper = require("../../helpers/vnpay.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const tierHelper = require("../../helpers/tier.helper");
const moment = require("moment");
const mongoose = require("mongoose");
const { isPublicCategory } = require("../../helpers/category.helper");
const access = require("../../helpers/checkout-access.helper");
const walletHold = require("../../helpers/wallet-hold.helper");
const { unresolvedFilter } = require("../../helpers/card-op.helper");

const checkoutId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const validQuantity = value => Number.isSafeInteger(value) && value >= 0;
const paymentMethods = new Set(variableConfig.paymentMethod.map(method => method.value));
const refuseBooking = (bookingCode, message) => Object.assign(new Error(message), { bookingCode });

function checkoutInput(body) {
  if (!body || typeof body.fullName !== "string" || typeof body.phone !== "string" ||
      (body.note !== undefined && typeof body.note !== "string") ||
      !paymentMethods.has(body.paymentMethod) || !Array.isArray(body.items) ||
      body.items.length < 1 || body.items.length > 100) return null;

  const fullName = body.fullName.trim();
  const phone = body.phone.trim();
  const note = body.note?.trim() || "";
  if (!fullName || fullName.length > 100 || phone.length > 25 ||
      !/^\+?[0-9 .()\-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 ||
      (note?.length ?? 0) > 1000) return null;

  const items = [];
  let passengers = 0;
  for (const item of body.items) {
    if (!item || !checkoutId(item.tourId) || !checkoutId(item.locationFrom)) return null;
    const { quantityAdult, quantityChildren, quantityBaby } = item;
    const quantities = [quantityAdult, quantityChildren, quantityBaby];
    if (!quantities.every(validQuantity)) return null;
    const total = quantityAdult + quantityChildren + quantityBaby;
    passengers += total;
    if (total < 1 || !Number.isSafeInteger(passengers)) return null;
    items.push({
      tourId: item.tourId.toLowerCase(), locationFrom: item.locationFrom.toLowerCase(),
      quantityAdult, quantityChildren, quantityBaby
    });
  }

  return { fullName, phone, note, paymentMethod: body.paymentMethod, items };
}

module.exports.checkoutSession = (req, res) => {
  res.set("Cache-Control", "no-store");
  const scope = access.openCheckout(req, res);
  if (!scope) return res.status(401).json({ code: "error", message: "Phiên đặt tour không hợp lệ." });
  return res.json({ code: "success", intentId: access.issueIntent(scope), scopeTag: access.hash(scope) });
};

const replyOrder = (res, order, replayed) => res.json({
  code: "success", message: "Đặt hàng thành công!", orderId: order.id,
  paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
  orderStatus: order.status, replayed,
  bookedItems: order.items.map(({ tourId, locationFrom, quantityAdult, quantityChildren, quantityBaby }) =>
    ({ tourId, locationFrom, quantityAdult, quantityChildren, quantityBaby }))
});
const findIntentOrder = (filter, session) => Order.findOne(filter).select("+checkout").session(session || null);
const attemptId = (scope, intent) => access.hash(JSON.stringify([scope, intent.key]));
const intentOrderFilter = (scope, intent) => ({ "checkout.scope": scope, "checkout.intent": intent.key });

function replayOrder(res, order, fingerprint) {
  if (order.checkout.fingerprint !== fingerprint) {
    return res.status(409).json({ code: "error", errorCode: "INTENT_CONFLICT", message: "Hệ thống đã nhận nội dung khác cho lần đặt này. Đang kiểm tra đơn đã ghi nhận." });
  }
  if (order.deleted) return res.status(409).json({ code: "error", errorCode: "INTENT_CLOSED", message: "Đơn đặt tour này đã được xử lý trước đó." });
  return replyOrder(res, order, true);
}

module.exports.checkoutStatus = async (req, res) => {
  res.set("Cache-Control", "no-store");
  const scope = access.checkoutScope(req);
  const intent = access.verifyIntent(scope, req.body?.intentId);
  if (!intent) return res.status(400).json({ code: "error", errorCode: "INVALID_INTENT", message: "Phiên đặt tour không hợp lệ." });
  const filter = intentOrderFilter(scope, intent);
  if (intent.expired && intent.fenced) {
    // The expiry marker and order writer contend on the same unique key.
    // A booked marker exists only when the order transaction committed.
    await CheckoutAttempt.init();
    const attempt = await CheckoutAttempt.findOneAndUpdate(
      { _id: attemptId(scope, intent) }, { $setOnInsert: { state: "expired" } },
      { upsert: true, new: true, writeConcern: { w: "majority" } }
    ).lean();
    if (attempt.state === "expired") return res.status(409).json({
      code: "error", errorCode: "INTENT_EXPIRED_NOT_CREATED",
      message: "Lần đặt trước đã hết hạn và không tạo đơn. Kiểm tra giỏ hàng rồi bấm Đặt tour để bắt đầu lần đặt mới."
    });
  }
  const order = await Order.findOne(filter).readConcern("majority");
  if (order?.deleted) return res.status(409).json({ code: "error", errorCode: "INTENT_CLOSED", message: "Đơn đặt tour này đã được xử lý trước đó." });
  if (!order) return res.status(404).json({ code: "error", errorCode: intent.expired ? "INTENT_EXPIRED" : "ORDER_NOT_FOUND", message: intent.expired ?
    "Lần đặt đã hết hạn và chưa xác định được kết quả. Vui lòng liên hệ hỗ trợ để đối soát trước khi đặt lại." :
    "Chưa tìm thấy đơn đã ghi nhận. Hãy thử đặt lại với lần đặt đang mở." });
  return replyOrder(res, order, true);
};

module.exports.createPost = async (req, res) => {
  res.set("Cache-Control", "no-store");
  const input = checkoutInput(req.body);
  if (!input) return res.json({ code: "error", message: "Thông tin tour, khách hoặc phương thức thanh toán không hợp lệ." });
  if (input.paymentMethod === "card" && !req.customer) {
    return res.json({ code: "error", message: "Vui lòng đăng nhập bằng thẻ để thanh toán bằng ví thẻ" });
  }

  let session;
  let filter, fingerprint;
  try {
    const scope = access.checkoutScope(req);
    const intent = access.verifyIntent(scope, req.body.intentId);
    if (!intent) return res.status(400).json({ code: "error", errorCode: "INVALID_INTENT", message: "Phiên đặt tour không hợp lệ. Vui lòng thử lại trong cùng phiên." });
    if (intent.expired) {
      return res.status(409).json({ code: "error", errorCode: "INTENT_EXPIRED", message: "Lần đặt tour này đã hết thời hạn thử lại. Hãy kiểm tra đơn hiện tại trước khi tạo đơn mới." });
    }

    await Order.init();
    if (intent.fenced) await CheckoutAttempt.init();
    filter = intentOrderFilter(scope, intent);
    fingerprint = access.hash(JSON.stringify(input));
    const existing = await findIntentOrder(filter);
    if (existing) return replayOrder(res, existing, fingerprint);

    session = await mongoose.startSession();
    const orderCode = "OD" + gererateHelper.generateRandomNumber(10);
    let record;
    let replayed;
    await session.withTransaction(async () => {
      replayed = false;
      record = await findIntentOrder(filter, session);
      if (record) {
        replayed = true;
        return;
      }
      if (intent.fenced) {
        const attempt = await CheckoutAttempt.updateOne(
          { _id: attemptId(scope, intent) }, { $setOnInsert: { state: "booked" } },
          { session, upsert: true }
        );
        if (access.intentExpired(intent.issuedAt)) {
          throw refuseBooking("INTENT_EXPIRED", "Lần đặt đã hết hạn. Đang kiểm tra kết quả lần đặt trước.");
        }
        if (!attempt.upsertedCount) throw new Error("Checkout attempt already recorded.");
      }
      const wallet = input.paymentMethod === "card";
      const customerId = req.customer ? String(req.customer._id) : undefined;
      let activeCard;
      let spending = req.customer?.totalSpent || 0;
      if (wallet) {
        // Cùng write lock với ký/đối soát, cấp lại và checkout ví của khách ở tab khác.
        activeCard = await Card.findOneAndUpdate({ cardId: req.card?.cardId, ownerId: customerId, cardType: 'customer', status: 'active', isCurrent: true }, { $inc: { __v: 1 } }, { session, new: true }).lean();
        const customer = await Customer.findOne({ _id: customerId, status: 'active', deleted: false }).select('totalSpent').session(session).lean();
        if (!activeCard || !customer) throw refuseBooking('AUTH_REQUIRED', 'Thẻ không còn hoạt động. Hãy đăng nhập lại bằng thẻ hiện tại.');
        if (await Tx.exists(unresolvedFilter({ cardId: activeCard.cardId })).session(session)) throw refuseBooking('WALLET_RECONCILIATION_REQUIRED', 'Thẻ còn giao dịch cần đối soát. Hãy đồng bộ thẻ trước khi đặt tour.');
        spending = customer.totalSpent || 0;
      }
      const items = [];
      let subTotal = 0;
      for (const selection of input.items) {
        const { tourId, locationFrom, quantityAdult, quantityChildren, quantityBaby } = selection;
        const tour = await Tour.findOneAndUpdate({
          _id: tourId, status: "active", deleted: false,
          stockAdult: { $gte: quantityAdult }, stockChildren: { $gte: quantityChildren }, stockBaby: { $gte: quantityBaby }
        }, {
          $inc: { stockAdult: -quantityAdult, stockChildren: -quantityChildren, stockBaby: -quantityBaby }
        }, { session, new: true });
        if (!tour) throw Object.assign(new Error("Tour không còn đủ chỗ."), { bookingCode: "OUT_OF_STOCK" });
        if (!await isPublicCategory(tour.category, session)) {
          throw refuseBooking("INVALID_TOUR", "Danh mục của tour hiện không mở bán.");
        }

        const { name, avatar, departureDate, priceNewAdult, priceNewChildren, priceNewBaby } = tour;
        if (!Number.isFinite(departureDate?.getTime()) ||
            !tour.locations?.some(id => String(id).toLowerCase() === locationFrom) ||
            !await City.exists({ _id: locationFrom }).session(session) ||
            ![priceNewAdult, priceNewChildren, priceNewBaby].every(validQuantity)) {
          throw Object.assign(new Error("Chuyến khởi hành, điểm xuất phát hoặc giá không hợp lệ."), { bookingCode: "INVALID_TOUR" });
        }
        items.push({ ...selection, name, avatar, departureDate, priceNewAdult, priceNewChildren, priceNewBaby, ticketStatus: "none" });
        subTotal += priceNewAdult * quantityAdult + priceNewChildren * quantityChildren + priceNewBaby * quantityBaby;
        if (!Number.isSafeInteger(subTotal)) throw new Error("Tổng giá trị đơn không hợp lệ.");
      }

      const discount = req.customer ? tierHelper.discountFor(spending, subTotal) : 0;
      const total = subTotal - discount;
      if (wallet && total < 1) throw refuseBooking('INVALID_WALLET_TOTAL', 'Vui lòng chọn phương thức khác cho đơn có tổng tiền bằng 0.');
      if (wallet && await walletHold.availableBalance(activeCard, session) < total) {
        throw refuseBooking('INSUFFICIENT_BALANCE', 'Số dư ví khả dụng không đủ sau giảm giá. Hãy nạp thêm, đợi đơn ví đang giữ chỗ hết hạn hoặc chọn phương thức khác.');
      }
      record = new Order({
        orderCode, fullName: input.fullName, phone: input.phone, note: input.note,
        paymentMethod: input.paymentMethod, items, subTotal, discount, total,
        ...(wallet ? { walletHoldExpiresAt: new Date(Date.now() + walletHold.HOLD_MS) } : {}),
        ...(req.customer ? { customerId: String(req.customer._id) } : {}),
        checkout: { scope, intent: intent.key, fingerprint, issuedAt: new Date(intent.issuedAt) },
        paymentStatus: "unpaid", status: "initial"
      });
      await record.save({ session });
    }, { writeConcern: { w: "majority" } });

    return replayed ? replayOrder(res, record, fingerprint) : replyOrder(res, record, false);
  } catch (error) {
    if (error.code === 11000 && filter) {
      try {
        const winner = await findIntentOrder(filter);
        if (winner) return replayOrder(res, winner, fingerprint);
      } catch {
        // A transient connection failure remains retryable with the same intent.
      }
    }
    const message = error.bookingCode === "OUT_OF_STOCK" ? "Tour không còn đủ chỗ. Vui lòng cập nhật lại giỏ hàng." :
      error.bookingCode ? error.message : "Đặt hàng không thành công!";
    return res.json({ code: "error", errorCode: error.bookingCode || "ORDER_CREATE_FAILED", message });
  } finally {
    if (session) await session.endSession();
  }
};

const successUrl = id => "/order/success?orderId=" + id;
const processingUrl = id => "/order/processing?orderId=" + id;

function findOwnedOrder(req, criteria = {}) {
  const { orderId } = req.query;
  const owner = access.orderAccessFilter(req);
  if (!checkoutId(orderId) || !owner) return null;
  return Order.findOne({ _id: orderId, deleted: false, ...owner, ...criteria });
}

module.exports.success = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const orderDetail = await findOwnedOrder(req);
    if (!orderDetail) {
      const { orderId } = req.query;
      // The existing member cookie is Strict. A fresh same-origin navigation
      // from this neutral page lets the browser attach it after a gateway return.
      if (req.query.return === "payment" && checkoutId(orderId)) {
        res.set('Referrer-Policy', 'no-referrer');
        return res.render("client/pages/order-payment-processing", {
          pageTitle: "Quay lại từ cổng thanh toán",
          returnOnly: true,
          continueUrl: successUrl(orderId) + '&return=resume'
        });
      }
      if (req.query.return === 'resume' && checkoutId(orderId) && !req.customer) return res.redirect('/account/login?orderId=' + orderId);
      return res.redirect("/");
    }

    orderDetail.paymentMethodName = variableConfig.paymentMethod.find(item => item.value === orderDetail.paymentMethod)?.label || "Chưa xác định";

    orderDetail.paymentStatusName = variableConfig.paymentStatus.find(item => item.value === orderDetail.paymentStatus)?.label || "Chưa xác định";

    orderDetail.statusName = variableConfig.orderStatus.find(item => item.value === orderDetail.status)?.label || "Chưa xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("HH:mm - DD/MM/YYYY");

    for (const item of orderDetail.items) {
      const infoTour = await Tour.findOne({
        _id: item.tourId,
        deleted: false
      })

      if (infoTour) {
        item.slug = infoTour.slug;
      }

      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");

      const city = checkoutId(item.locationFrom) ? await City.findById(item.locationFrom) : null;

      if (city) {
        item.locationFromName = city.name;
      }
    }

    res.render("client/pages/order-success", {
      pageTitle: "Đặt hàng thành công",
      orderDetail: orderDetail
    });
  } catch {
    res.redirect("/");
  }
}

module.exports.paymentCard = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!req.customer || !req.card) return res.redirect('/account/login');
    const orderDetail = await findOwnedOrder(req, { paymentMethod: 'card' });
    if (!orderDetail) return res.redirect('/');
    if (orderDetail.paymentStatus !== 'unpaid' || orderDetail.status === 'cancel') return res.redirect(successUrl(orderDetail.id));
    const expired = walletHold.holdExpired(orderDetail);
    if (expired && await walletHold.expireWalletHold(orderDetail._id)) return res.redirect(successUrl(orderDetail.id));
    const unresolved = await Tx.exists(unresolvedFilter({ orderId: orderDetail.id, type: 'debit' }));
    res.render("client/pages/order-payment-card", {
      pageTitle: "Thanh toán bằng ví thẻ",
      orderDetail: orderDetail,
      cardInfo: { cardId: req.card.cardId, balance: req.card.balance }, expired, unresolved,
      holdUntil: orderDetail.walletHoldExpiresAt?.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
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
    error: typeof error === 'string' ? error : 'settlement-failed',
    at: new Date().toISOString()
  }));
}

// VNPay không gọi lại: khách đã trả tiền thì hiện trang "đang xử lý" thay vì im lặng chuyển về trang chủ.
function paymentProcessing(res, gateway, info, error) {
  logPaymentFailure(gateway, info, error);
  res.set("Cache-Control", "no-store");
  res.set('Referrer-Policy', 'no-referrer');
  return res.render("client/pages/order-payment-processing", {
    pageTitle: "Đang xử lý thanh toán",
    continueUrl: processingUrl(info.orderId) + '&return=resume',
    gatewayName: gateway === 'vnpay' ? 'VNPay' : 'ZaloPay'
  });
}

module.exports.processing = async (req, res) => {
  res.set("Cache-Control", "no-store");
  const order = await findOwnedOrder(req, { paymentMethod: { $in: ["vnpay", "zalopay"] } });
  if (!order) {
    if (req.query.return === 'resume' && checkoutId(req.query.orderId) && !req.customer) {
      return res.redirect('/account/login?orderId=' + req.query.orderId + '&destination=processing');
    }
    return res.redirect("/");
  }
  if (order.paymentStatus === "paid") return res.redirect(successUrl(order.id));
  return res.render("client/pages/order-payment-processing", {
    pageTitle: "Trạng thái thanh toán",
    orderCode: order.orderCode,
    amount: order.total,
    gatewayName: order.paymentMethod === "vnpay" ? "VNPay" : "ZaloPay",
    continueUrl: successUrl(order.id),
    statusOnly: true
  });
};

module.exports.paymentZaloPay = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const orderDetail = await findOwnedOrder(req, { paymentStatus: 'unpaid', paymentMethod: 'zalopay', status: { $ne: 'cancel' } });
    if (!orderDetail) return res.redirect('/');
    // Số điện thoại nhập tự do ("0901 234 567") được chuẩn hoá trước khi đưa vào app_user của ZaloPay.
    const appPhone = zalopayHelper.normalizePhone(orderDetail.phone);
    // Callback chỉ nhận ^\+?\d{8,15}: số không đạt thì báo lỗi ngay, không để khách trả tiền rồi callback bị từ chối.
    if (!/^\+?\d{8,15}$/.test(appPhone)) {
      if (typeof req.flash === 'function') req.flash('error', 'Số điện thoại của đơn hàng không hợp lệ để thanh toán qua ZaloPay. Vui lòng liên hệ hỗ trợ hoặc chọn phương thức thanh toán khác.');
      return res.redirect(successUrl(orderDetail.id));
    }
    const url = await zalopayHelper.createOrder({
      appUser: `${appPhone}-${orderDetail.id}`,
      amount: orderDetail.total,
      description: `Thanh toán đơn hàng ${orderDetail.orderCode}`,
      redirectUrl: process.env.DOMAIN_WEBSITE + successUrl(orderDetail.id) + '&return=payment',
      callbackPath: '/order/payment-zalopay-result'
    });
    return res.redirect(url || '/');
  } catch {
    return res.redirect('/');
  }
}

module.exports.paymentZaloPayResultPost = async (req, res) => {
  res.set("Cache-Control", "no-store");
  let received;
  try {
    const verified = zalopayHelper.verifyCallback(req.body);
    if (!verified.valid) return res.json({ return_code: -1, return_message: 'mac not equal' });
    const data = verified.data;
    if (!/^\+?\d{8,15}-[a-fA-F0-9]{24}$/.test(data.app_user)) return res.json({ return_code: -1, return_message: 'invalid payment' });
    const [phone, orderId] = data.app_user.split('-');
    received = { orderId, amount: data.amount, reference: data.app_trans_id };
    const reference = {
      _id: orderId, total: data.amount, paymentMethod: 'zalopay', deleted: false, status: { $ne: 'cancel' }
    };
    const found = await Order.findOne(reference);
    if (found) received.orderCode = found.orderCode;
    // So khớp chặt: số trong app_user phải đúng bằng số điện thoại của đơn sau khi chuẩn hoá.
    if (!found || zalopayHelper.normalizePhone(found.phone) !== phone) return res.json({ return_code: -1, return_message: 'invalid payment' });
    const identity = { ...reference, phone: found.phone };
    const order = found;
    if (!['unpaid', 'paid'].includes(order.paymentStatus)) return res.json({ return_code: -1, return_message: 'invalid payment' });
    const changed = await orderPaymentHelper.markOrderPaid({ _id: orderId, phone: found.phone, deleted: false, total: data.amount }, 'zalopay');
    // Callback lặp chỉ được ACK khi cùng identity/amount vẫn là đơn paid hợp lệ.
    if (!changed && !await Order.findOne({ ...identity, paymentStatus: 'paid' })) return res.json({ return_code: -1, return_message: 'invalid payment' });
    return res.json({ return_code: 1, return_message: 'success' });
  } catch (error) {
    // Không trả lỗi DB/provider chứa dữ liệu nhạy cảm ra ngoài hoặc ghi MAC vào log; ZaloPay sẽ gọi lại.
    if (received) logPaymentFailure('zalopay', received, error);
    return res.json({ return_code: 0, return_message: 'processing failed' });
  }
}

module.exports.paymentVNPay = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const orderDetail = await findOwnedOrder(req, { paymentStatus: 'unpaid', paymentMethod: 'vnpay', status: { $ne: 'cancel' } });
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
  res.set("Cache-Control", "no-store");
  // Có giá trị khi VNPay đã xác nhận thanh toán thành công (chữ ký hợp lệ): lỗi sau đó không được im lặng.
  let received;
  try {
    const verified = vnpayHelper.verifyReturn(req.query);
    if (!verified.valid) return res.redirect('/');
    // Chỉ signed reference chọn đơn; không dùng orderId tự khai trong query.
    const reference = /^([a-fA-F0-9]{24})-([0-9]{13})$/.exec(verified.txnRef);
    const rawAmount = req.query.vnp_Amount;
    if (!reference || !process.env.VNPAY_CODE || req.query.vnp_TmnCode !== process.env.VNPAY_CODE || typeof rawAmount !== 'string' || !/^[1-9][0-9]*$/.test(rawAmount)) return res.redirect('/');
    const scaled = Number(rawAmount);
    if (!Number.isSafeInteger(scaled) || scaled % 100 !== 0) return res.redirect('/');
    const orderId = reference[1];
    const amount = scaled / 100;
    if (!verified.success) return res.redirect(process.env.DOMAIN_WEBSITE + successUrl(orderId) + '&return=payment');
    received = { orderId, amount, reference: verified.txnRef };
    const identity = { _id: orderId, total: amount, paymentMethod: 'vnpay', deleted: false, status: { $ne: 'cancel' } };
    const order = await Order.findOne(identity);
    if (order) received.orderCode = order.orderCode;
    // Từ đây VNPay đã xác nhận thu tiền: mọi nhánh không ghi nhận được đều phải ghi log đối soát và hiện trang đang xử lý.
    if (!order || !['unpaid', 'paid'].includes(order.paymentStatus)) return paymentProcessing(res, 'vnpay', received, 'không có đơn khớp số tiền/phương thức hoặc đơn đã huỷ, xoá, đổi trạng thái thanh toán');
    const changed = await orderPaymentHelper.markOrderPaid({ _id: orderId, phone: order.phone, deleted: false, total: amount }, 'vnpay');
    if (!changed && !await Order.findOne({ ...identity, phone: order.phone, paymentStatus: 'paid' })) return paymentProcessing(res, 'vnpay', received, 'không đánh dấu được đơn đã thanh toán');
    return res.redirect(process.env.DOMAIN_WEBSITE + successUrl(orderId) + '&return=payment');
  } catch (error) {
    if (received) return paymentProcessing(res, 'vnpay', received, error);
    return res.redirect('/');
  }
}
