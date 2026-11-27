const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const Tour = require("../../models/tour.model");
const Tx = require("../../models/card-transaction.model");
const Card = require("../../models/card.model");
const Customer = require("../../models/customer.model");
const variableConfig = require("../../config/variable");
const moment = require("moment");
const ticketHelper = require("../../helpers/ticket.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const cardOpHelper = require("../../helpers/card-op.helper");
const cardLogHelper = require("../../helpers/card-log.helper");
const cardCrypto = require("../../helpers/card-crypto.helper");
const { restoreOrderStock } = require("../../helpers/order-stock.helper");

// Debit ví thẻ đã gửi/đã ký mà chưa done: thẻ có thể đã trừ tiền, chỉ biên nhận của thẻ mới kết thúc được giao dịch.
const IN_FLIGHT_MESSAGE = "Đơn đang có giao dịch ví thẻ chưa đối soát; hãy để khách cắm thẻ đồng bộ trước";
const PAID_BY_CARD_MESSAGE = "Đơn đã được thanh toán bằng ví thẻ, không thể chuyển về chưa thanh toán!";
const SETTLE_FAILED_MESSAGE = "Không thể ghi nhận thanh toán cho đơn hàng này!";
const INVALID_MESSAGE = "Thông tin đơn hàng không hợp lệ!";
const GUARDED_FIELDS = ["paymentMethod", "paymentStatus", "status"];
const FIELD_OPTIONS = {
  paymentMethod: variableConfig.paymentMethod,
  paymentStatus: variableConfig.paymentStatus,
  status: variableConfig.orderStatus
};

const PAID_REFUND_MANUAL_MESSAGE = "Đơn đã thanh toán cần xử lý hoàn tiền và đối soát riêng.";
const REFUND_EVIDENCE_MESSAGE = "Không tìm thấy giao dịch trừ ví thẻ đã hoàn tất của đơn; cần đối soát thủ công trước khi huỷ.";
const ALREADY_REFUNDED_MESSAGE = "Đơn đã được hoàn tiền vào ví thẻ, không hoàn lần hai.";
const NO_ACTIVE_CARD_MESSAGE = "Khách hàng không còn thẻ đang hoạt động để nhận hoàn tiền. Hãy cấp lại thẻ cho khách rồi huỷ đơn, hoặc xử lý hoàn tiền thủ công.";
const CARD_LOCKED_MESSAGE = "Thẻ hiện tại của khách đang bị khoá. Hãy mở khoá hoặc cấp lại thẻ trước khi huỷ đơn để hoàn tiền vào ví thẻ.";
const CARD_ISSUING_MESSAGE = "Thẻ của khách đang trong quá trình phát hành/cấp lại. Hãy hoàn tất phát hành thẻ trước khi huỷ đơn để hoàn tiền vào ví thẻ.";
const CARD_CHANGED_MESSAGE = "Trạng thái thẻ của khách vừa thay đổi. Hãy tải lại trang.";
const USED_TICKET_MESSAGE = "Đơn có vé đã check-in, không thể huỷ và hoàn tiền tự động. Vui lòng xử lý thủ công.";
const CHECKIN_PENDING_MESSAGE = "Đơn có vé đang chờ xác nhận check-in. Cần đối soát trước khi hủy hoặc hoàn tiền.";
// Vé đã check-in (use-ticket ghi ticketStatus used + checkedInAt): tour đã được dùng, không huỷ/hoàn tự động.
const hasUsedTicket = order => Array.isArray(order?.items) && order.items.some(item => item?.ticketStatus === "used" || !!item?.checkedInAt);
const hasPendingCheckin = order => order.items?.some(item => Boolean(item.checkinOpId));
// Trần số dư chip (applet từ chối credit vượt mức); đồng bộ sẽ giữ khoản vượt trần chờ đối soát.
const WALLET_CAP = 50_000_000;
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const validAmount = value => Number.isSafeInteger(value) && value > 0 && value <= WALLET_CAP;
const formatMoney = value => value.toLocaleString("vi-VN");

class EditRefusal extends Error { }

// Huỷ đơn đã trừ ví thẻ: kiểm chứng cứ debit đã có biên nhận và chọn thẻ nhận hoàn tiền (trong transaction của caller).
// Tiền hoàn về thẻ HIỆN TẠI của khách: thẻ thanh toán có thể đã bị thu hồi/cấp lại (số dư đã chuyển sang thẻ mới).
async function prepareCardRefund(current, session) {
  const orderId = String(current._id);

  if (!validAmount(current.total) || !OBJECT_ID.test(String(current.customerId || "")) || typeof current.cardTxRef !== "string") {
    throw new EditRefusal(REFUND_EVIDENCE_MESSAGE);
  }

  // Debit chỉ thành done khi biên nhận chữ ký thẻ đã được kiểm (receiptInSession).
  const debit = await Tx.findOne({
    orderId,
    txRef: current.cardTxRef.toUpperCase(),
    type: "debit",
    source: "order",
    status: "done"
  }).session(session).lean();

  if (!debit || debit.amount !== current.total || !debit.signedOpId || !debit.receiptHex) {
    throw new EditRefusal(REFUND_EVIDENCE_MESSAGE);
  }

  if (await Tx.exists({ orderId, type: "credit", source: "refund" }).session(session)) {
    throw new EditRefusal(ALREADY_REFUNDED_MESSAGE);
  }

  const card = await Card.findOne({
    ownerId: current.customerId,
    cardType: "customer",
    isCurrent: true
  }).session(session).lean();

  if (!card) {
    throw new EditRefusal(NO_ACTIVE_CARD_MESSAGE);
  }

  if (card.status === "locked") {
    throw new EditRefusal(CARD_LOCKED_MESSAGE);
  }

  if (card.status !== "active" || !card.publicKeyModulus) {
    throw new EditRefusal(CARD_ISSUING_MESSAGE);
  }

  // Khoá ví như nạp tiền mặt: ghi Card cùng ký/xác nhận/thu hồi/cấp lại để không lọt snapshot cũ.
  const locked = await Card.findOneAndUpdate(
    { _id: card._id, status: "active", isCurrent: true },
    { $inc: { __v: 1 } },
    { session, new: true }
  ).lean();

  if (!locked) {
    throw new EditRefusal(CARD_CHANGED_MESSAGE);
  }

  // Cùng cách tính nghĩa vụ credit chờ ghi thẻ như nạp tiền mặt.
  const [pending] = await Tx.aggregate([
    {
      $match: {
        cardId: locked.cardId,
        type: "credit",
        $or: [
          { status: { $in: ["pending-card", "sent"] } },
          { status: "failed", signedOpId: { $exists: true } }
        ]
      }
    },
    { $group: { _id: null, sum: { $sum: "$amount" } } }
  ]).session(session);

  const pendingSum = pending?.sum || 0;
  const balance = Number.isSafeInteger(locked.balance) ? locked.balance : WALLET_CAP;

  return {
    debit,
    card: locked,
    amount: debit.amount,
    txRef: cardCrypto.randomHex(8),
    pendingSum,
    // Không từ chối: khoản hoàn vẫn được ghi nhận pending-card; đồng bộ giữ lại (capHeldAt + nhật ký)
    // cho tới khi ví còn đủ hạn mức hoặc được đối soát thủ công.
    overCap: balance + pendingSum + debit.amount > WALLET_CAP
  };
}

// Ghi credit hoàn tiền (pending-card: lần cắm thẻ tiếp theo đồng bộ sẽ ký CREDIT), trừ lại chi tiêu và ghi nhật ký.
async function applyCardRefund(current, refund, req, session) {
  const orderId = String(current._id);

  await Tx.create([{
    txRef: refund.txRef,
    cardId: refund.card.cardId,
    type: "credit",
    source: "refund",
    amount: refund.amount,
    orderId,
    status: "pending-card",
    createdBy: req.account?.id
  }], { session });

  // Thanh toán ví đã cộng total vào totalSpent (settlement); hoàn tiền trừ lại đúng phần đó, không âm.
  let spent = null;
  const owner = await Customer.findOne({ _id: current.customerId }).session(session).lean();

  if (owner && Number.isSafeInteger(owner.totalSpent) && owner.totalSpent >= 0) {
    const after = Math.max(0, owner.totalSpent - refund.amount);
    const result = await Customer.updateOne(
      { _id: owner._id, totalSpent: owner.totalSpent },
      { $set: { totalSpent: after } },
      { session, runValidators: true }
    );

    if (result.matchedCount !== 1) {
      throw new Error("Không thể cập nhật chi tiêu khách hàng.");
    }

    spent = { before: owner.totalSpent, after };
  }

  // Nhật ký trong transaction: lỗi ghi nhật ký rollback cả hoàn tiền.
  await cardLogHelper.write({
    action: "card-refund",
    cardId: refund.card.cardId,
    actorType: "admin",
    actorId: req.account?.id,
    result: "success",
    detail: {
      orderId,
      orderCode: current.orderCode,
      txRef: refund.txRef,
      amount: refund.amount,
      debitTxRef: refund.debit.txRef,
      paidCardId: refund.debit.cardId,
      reason: "order-cancel",
      ...(refund.overCap
        ? { overCap: true, balance: refund.card.balance, pendingSum: refund.pendingSum }
        : {}),
      ...(spent
        ? { totalSpentBefore: spent.before, totalSpentAfter: spent.after }
        : {})
    },
    req
  }, { session });
}

function refundMessage(refund) {
  let message = `Đã huỷ đơn và hoàn ${formatMoney(refund.amount)} đ vào ví thẻ. Tiền sẽ được ghi lên thẻ ở lần cắm thẻ tiếp theo.`;

  if (refund.card.cardId !== refund.debit.cardId) {
    message += " Khoản hoàn được ghi vào thẻ hiện tại của khách (thẻ đã dùng thanh toán không còn hoạt động).";
  }

  if (refund.overCap) {
    message += ` Lưu ý: số dư ví cộng khoản hoàn vượt hạn mức ${formatMoney(WALLET_CAP)} đ nên khi đồng bộ khoản này sẽ được giữ lại cho tới khi ví còn đủ hạn mức hoặc được đối soát thủ công.`;
  }

  return message;
}

const REFUND_STATUS_LABELS = {
  "pending-card": "Chờ ghi lên thẻ ở lần cắm thẻ tiếp theo",
  sent: "Đang ghi lên thẻ, chờ biên nhận",
  done: "Đã ghi lên thẻ",
  reconciliation: "Chờ đối soát"
};

function refundStatusLabel(tx) {
  if (!tx) return "Không tìm thấy giao dịch hoàn tiền";
  if (tx.status === "failed" && tx.failReason === "moved") return "Đã chuyển sang thẻ mới khi cấp lại thẻ";
  if (tx.status === "failed" && tx.failReason === "refunded") return "Đã hoàn tiền mặt khi thu hồi thẻ";
  if (tx.status === "pending-card" && tx.capHeldAt) return "Đang giữ do vượt hạn mức ví, chờ đối soát";
  return REFUND_STATUS_LABELS[tx.status] || tx.status;
}

module.exports.list = async (req, res) => {
  try {
    const text = value =>
      typeof value === "string" ? value.trim() : "";

    const escapeRegex = value =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      deleted: false
    };

    // Tìm kiếm mã đơn, tên hoặc số điện thoại
    const q = text(req.query.q).slice(0, 80);

    if (q) {
      const keyword = new RegExp(escapeRegex(q), "i");

      query.$or = [
        { orderCode: keyword },
        { fullName: keyword },
        { phone: keyword }
      ];
    }

    // Trạng thái đơn
    const status = text(req.query.status);
    if (variableConfig.orderStatus.some(x => x.value === status)) {
      query.status = status;
    }

    // Phương thức thanh toán
    const paymentMethod = text(req.query.paymentMethod);
    if (variableConfig.paymentMethod.some(
      x => x.value === paymentMethod
    )) {
      query.paymentMethod = paymentMethod;
    }

    // Trạng thái thanh toán
    const paymentStatus = text(req.query.paymentStatus);
    if (variableConfig.paymentStatus.some(
      x => x.value === paymentStatus
    )) {
      query.paymentStatus = paymentStatus;
    }

    // Lọc ngày tạo đơn theo giờ Việt Nam
    const startDate = text(req.query.startDate);
    const endDate = text(req.query.endDate);

    const parseDay = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

      const date = new Date(`${value}T00:00:00+07:00`);

      if (Number.isNaN(date.getTime())) return null;

      const back = new Date(
        date.getTime() + 7 * 60 * 60 * 1000
      ).toISOString().slice(0, 10);

      return back === value ? date : null;
    };

    const start = parseDay(startDate);
    const end = parseDay(endDate);

    if (start || end) {
      query.createdAt = {};

      if (start) query.createdAt.$gte = start;

      if (end) {
        query.createdAt.$lt = new Date(
          end.getTime() + 24 * 60 * 60 * 1000
        );
      }
    }

    // Phân trang
    const limit = 10;
    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.max(
      1,
      Math.ceil(totalOrders / limit)
    );

    const requestedPage = Number(req.query.page);

    const page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, totalPages)
        : 1;

    const skip = (page - 1) * limit;

    const orderList = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit);

    for (const order of orderList) {
      order.paymentMethodName =
        variableConfig.paymentMethod.find(
          x => x.value === order.paymentMethod
        )?.label || order.paymentMethod || "Không rõ";

      order.paymentStatusName =
        variableConfig.paymentStatus.find(
          x => x.value === order.paymentStatus
        )?.label || order.paymentStatus || "Không rõ";

      order.statusName =
        variableConfig.orderStatus.find(
          x => x.value === order.status
        )?.label || order.status || "Không rõ";

      order.createdAtTime =
        moment(order.createdAt).format("HH:mm");

      order.createdAtDate =
        moment(order.createdAt).format("DD/MM/YYYY");
    }

    res.render("admin/pages/order-list", {
      pageTitle: "Quản lý đơn hàng",
      orderList,
      totalOrders,
      totalPages,
      page,
      pages: Array.from(
        { length: totalPages },
        (_, i) => i + 1
      ),
      startRecord: totalOrders === 0 ? 0 : skip + 1,
      endRecord: Math.min(skip + limit, totalOrders),
      filters: {
        q,
        status,
        paymentMethod,
        paymentStatus,
        startDate,
        endDate
      },
      orderStatuses: variableConfig.orderStatus,
      paymentMethods: variableConfig.paymentMethod,
      paymentStatuses: variableConfig.paymentStatus
    });
  } catch (error) {
    console.error("Order list error:", error);
    res.status(500).send("Không tải được danh sách đơn hàng.");
  }
};


module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;

    const orderDetail = await Order.findOne({
      _id: id,
      deleted: false
    })
    if (!orderDetail) return res.status(404).render("admin/pages/error-404", { pageTitle: "Không tìm thấy đơn hàng" });

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("YYYY-MM-DDTHH:mm");

    for (const item of orderDetail.items) {
      const city = OBJECT_ID.test(String(item.locationFrom || "")) ? await City.findById(item.locationFrom) : null;
      item.locationFromName = city?.name || "Chưa xác định";
      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
    }

    // Đơn có vé đã check-in: không cho huỷ (và hoàn tiền tự động) từ form.
    const usedTicket = orderDetail.status !== "cancel" && hasUsedTicket(orderDetail);
    const pendingCheckin = orderDetail.status !== "cancel" && hasPendingCheckin(orderDetail);

    // Đơn đã trừ ví thẻ (debit có biên nhận): huỷ đơn sẽ tự hoàn tiền về ví thẻ của khách.
    let cardRefund = null;
    if (
      !usedTicket && !pendingCheckin &&
      orderDetail.paymentMethod === "card" &&
      orderDetail.paymentStatus === "paid" &&
      orderDetail.status !== "cancel" &&
      orderDetail.cardTxRef
    ) {
      const debit = await Tx.findOne({
        orderId: String(orderDetail._id),
        txRef: orderDetail.cardTxRef,
        type: "debit",
        source: "order",
        status: "done"
      }).select("amount").lean();
      if (debit) cardRefund = { amount: debit.amount };
    }

    let refundInfo = null;
    if (orderDetail.refundTxRef) {
      const refundTx = await Tx.findOne({ txRef: orderDetail.refundTxRef })
        .select("amount status failReason capHeldAt").lean();
      refundInfo = {
        txRef: orderDetail.refundTxRef,
        amount: refundTx?.amount,
        statusLabel: refundStatusLabel(refundTx)
      };
    }

    res.render("admin/pages/order-edit", {
      pageTitle: `Đơn hàng: ${orderDetail.orderCode}`,
      orderDetail: orderDetail,
      cardRefund,
      refundInfo,
      usedTicket,
      pendingCheckin,
      paymentMethod: variableConfig.paymentMethod,
      paymentStatus: variableConfig.paymentStatus,
      orderStatus: variableConfig.orderStatus
    })
  } catch (error) {
    res.redirect(`/${pathAdmin}/order/list`);
  }
}

module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;

    const order = await Order.findOne({
      _id: id,
      deleted: false
    });

    if (!order) {
      res.json({
        code: "error",
        message: INVALID_MESSAGE
      })
      return;
    }

    // Huỷ đơn là trạng thái cuối: vé đã được dọn khỏi thẻ, không cho mở lại.
    if (order.status === "cancel" && req.body.status !== undefined && req.body.status !== "cancel") {
      res.json({
        code: "error",
        message: "Đơn hàng đã huỷ, không thể đổi sang trạng thái khác!"
      })
      return;
    }

    // Chỉ ghi các trường form sửa đơn gửi lên; không nhận ticketStatus, orderCode, items... từ body.
    const update = {};
    for (const field of ["fullName", "phone", "note", "paymentMethod", "paymentStatus", "status"]) {
      if (typeof req.body[field] === "string") {
        update[field] = req.body[field];
      }
    }

    // Trạng thái và phương thức thanh toán chỉ nhận giá trị có trong cấu hình.
    for (const field of GUARDED_FIELDS) {
      if (update[field] !== undefined && !FIELD_OPTIONS[field].some(item => item.value === update[field])) {
        res.json({
          code: "error",
          message: INVALID_MESSAGE
        })
        return;
      }
    }

    // Form luôn gửi lại đủ trường: giá trị không đổi thì không coi là thay đổi tiền/trạng thái.
    for (const field of GUARDED_FIELDS) {
      if (update[field] === order[field]) {
        delete update[field];
      }
    }


    // Hủy đơn, hoàn tồn kho, hoàn tiền ví thẻ (nếu đơn đã trừ ví) và dọn vé trong cùng một transaction.
    if (update.status === "cancel") {
      if (!req.permissions?.includes("order-edit")) {
        return res.status(403).json({
          code: "error",
          message: "Bạn không có quyền sửa đơn hàng."
        });
      }

      // Không cho vừa hủy vừa đổi thanh toán.
      if (
        update.paymentMethod !== undefined ||
        update.paymentStatus !== undefined
      ) {
        return res.status(409).json({
          code: "error",
          message: "Hãy xử lý thanh toán riêng trước khi hủy."
        });
      }

      const session = await mongoose.startSession();
      let voided = [];
      let refund = null;

      try {
        await session.withTransaction(async () => {
          // Driver có thể chạy lại callback khi write conflict: tính lại mọi thứ từ đầu.
          voided = [];
          refund = null;

          // Đọc trạng thái mới nhất bên trong transaction.
          const current = await Order.findOne({
            _id: id,
            deleted: false
          }).session(session).lean();

          if (
            !current ||
            !["initial", "done"].includes(current.status) ||
            current.stockRestoredAt
          ) {
            throw new EditRefusal(
              "Đơn đã hủy hoặc không còn hợp lệ để hoàn chỗ."
            );
          }

          const orderId = String(current._id);
          if (hasPendingCheckin(current)) throw new EditRefusal(CHECKIN_PENDING_MESSAGE);

          // Debit đã ký hoặc đã gửi mà chưa có biên nhận: thẻ có thể đã trừ tiền,
          // chỉ lần cắm thẻ đồng bộ tiếp theo mới kết thúc được giao dịch.
          if (await Tx.exists(cardOpHelper.unresolvedFilter({ orderId, type: "debit" })).session(session)) {
            throw new EditRefusal(IN_FLIGHT_MESSAGE);
          }

          if (current.paymentStatus === "paid") {
            // Chỉ ví thẻ được hoàn tự động; tiền mặt/chuyển khoản/cổng vẫn đối soát thủ công.
            if (current.paymentMethod !== "card") {
              throw new EditRefusal(PAID_REFUND_MANUAL_MESSAGE);
            }
            // Đọc trong transaction: check-in đồng thời ghi cùng document đơn nên sẽ write-conflict, không lọt qua.
            if (hasUsedTicket(current)) {
              throw new EditRefusal(USED_TICKET_MESSAGE);
            }
            refund = await prepareCardRefund(current, session);
          } else {
            if (current.paymentStatus !== "unpaid") {
              throw new EditRefusal(PAID_REFUND_MANUAL_MESSAGE);
            }

            // Đơn chưa thanh toán không thể có vé check-in (vé chỉ ghi/dùng khi đã paid); dữ liệu legacy lệch vẫn bị chặn.
            if (hasUsedTicket(current)) {
              throw new EditRefusal(USED_TICKET_MESSAGE);
            }

            // Tránh hủy giao dịch cổng đang chờ callback.
            if (!["money", "bank", "card"].includes(current.paymentMethod)) {
              throw new EditRefusal(
                "Phương thức thanh toán này cần đối soát trước khi hủy."
              );
            }

            // Đơn chưa thanh toán mà đã có debit hoàn tất: dữ liệu lệch, cần đối soát.
            const unsafeDebit = await Tx.exists({
              orderId,
              type: "debit",
              status: { $in: ["sent", "done", "reconciliation"] }
            }).session(session);

            if (unsafeDebit) {
              throw new EditRefusal(
                "Giao dịch ví thẻ cần đối soát trước khi hủy."
              );
            }
          }

          // và chưa từng ghi nhận hoàn tồn kho / hoàn tiền.
          const fieldsToSet = {
            status: "cancel",
            stockRestoredAt: new Date(),
            updatedBy: req.account.id
          };

          for (const field of ["fullName", "phone", "note"]) {
            if (typeof req.body[field] === "string") {
              fieldsToSet[field] = req.body[field];
            }
          }

          const compare = {
            _id: id,
            deleted: false,
            status: current.status,
            paymentStatus: current.paymentStatus,
            paymentMethod: current.paymentMethod,
            stockRestoredAt: { $exists: false },
            // Chốt lại trong điều kiện ghi: không phần tử nào đã check-in.
            "items.ticketStatus": { $ne: "used" },
            "items.checkedInAt": { $exists: false },
            "items.checkinOpId": { $exists: false }
          };

          if (refund) {
            compare.cardTxRef = refund.debit.txRef;
            compare.total = refund.amount;
            compare.refundTxRef = { $exists: false };
            fieldsToSet.refundTxRef = refund.txRef;
          }

          const changed = await Order.updateOne(
            compare,
            { $set: fieldsToSet },
            { session }
          );

          if (changed.modifiedCount !== 1) {
            throw new EditRefusal(
              "Trạng thái đơn đã thay đổi. Hãy tải lại trang."
            );
          }

          await restoreOrderStock(current.items, session, message => new EditRefusal(message));

          if (refund) {
            await applyCardRefund(current, refund, req, session);
          }

          // Debit chưa ký được đóng trong cùng transaction.
          voided = await cardOpHelper.voidUnsignedDebits(
            { orderId },
            session
          );

          // Vé: written -> pending-delete, pending -> none; commit/rollback cùng đơn.
          await ticketHelper.onOrderCancelled(
            { _id: current._id },
            req.account?.id,
            session
          );
        });
      } catch (error) {
        // Unique index hoàn tiền theo đơn: lượt thứ hai (double-click/retry) không tạo khoản hoàn mới.
        if (error?.code === 11000) {
          throw new EditRefusal(ALREADY_REFUNDED_MESSAGE);
        }
        throw error;
      } finally {
        await session.endSession();
      }

      // Transaction đã commit.
      if (voided.length) {
        try {
          await cardLogHelper.write({
            action: "card-debit-void",
            cardId: voided[0].cardId,
            actorType: "admin",
            actorId: req.account?.id,
            result: "success",
            detail: {
              orderId: String(order._id),
              reason: "order-cancel",
              txRefs: voided.map(tx => tx.txRef)
            },
            req
          });
        } catch (error) {
          console.error("Card cancellation log failed:", error);
        }
      }

      if (refund) {
        const message = refundMessage(refund);
        req.flash("success", message);
        return res.json({
          code: "success",
          message,
          refund: {
            amount: refund.amount,
            txRef: refund.txRef,
            cardId: refund.card.cardId,
            overCap: refund.overCap
          }
        });
      }

      req.flash("success", "Đã hủy đơn và hoàn số chỗ.");

      return res.json({
        code: "success",
        message: "Đã hủy đơn và hoàn tồn kho."
      });
    }


    const orderId = String(order._id);
    const guardedChange = GUARDED_FIELDS.some(field => update[field] !== undefined);
    // Chuyển sang đã thanh toán phải đi qua settlement chung để vé điện tử và chi tiêu khách được cập nhật.
    const markPaid = update.paymentStatus === "paid";
    // Chỉ engine xác minh biên nhận mới được ghi nhận thanh toán ví; form admin không có chứng cứ debit.
    const manualCardPayment = (markPaid && (update.paymentMethod || order.paymentMethod) === "card") ||
      update.paymentMethod === "card" ||
      (order.paymentMethod === "card" && order.paymentStatus === "paid" && update.paymentMethod !== undefined);
    const fields = { ...update };
    if (markPaid) {
      delete fields.paymentStatus;
    }

    // Lưu lại đơn đã huỷ vẫn chạy lại phần dọn dẹp (idempotent).
    const cancelled = (update.status || order.status) === "cancel";
    let voided = [];
    const apply = async session => {
      voided = [];
      const options = session ? { session } : {};
      if (guardedChange) {
        if (await Tx.exists({ orderId, type: "debit", status: { $ne: "done" }, $or: [{ status: "sent" }, { signedOpId: { $exists: true } }] }).session(session || null)) {
          throw new EditRefusal(IN_FLIGHT_MESSAGE);
        }
        if (manualCardPayment) throw new EditRefusal("Thanh toán ví thẻ chỉ được xác nhận bằng biên nhận trừ tiền hợp lệ!");
        // Huỷ thanh toán không hoàn tiền ví (spec 1.2); mở lại đơn đã trừ ví sẽ cho phép trừ lần hai.
        if (order.paymentStatus === "paid" && update.paymentStatus !== undefined && await Tx.exists({ orderId, type: "debit", status: "done" }).session(session || null)) {
          throw new EditRefusal(PAID_BY_CARD_MESSAGE);
        }
      }
      if (Object.keys(fields).length) {
        await Order.updateOne({
          _id: id,
          deleted: false
        }, { $set: fields }, options);
      }
      if (markPaid) {
        const method = update.paymentMethod || order.paymentMethod;
        const settled = session
          ? await orderPaymentHelper.markOrderPaidInSession({ _id: orderId }, method, session)
          : await orderPaymentHelper.markOrderPaid({ _id: orderId }, method);
        if (!settled) {
          throw new EditRefusal(SETTLE_FAILED_MESSAGE);
        }
      }
      // Debit chưa từng ký của đơn huỷ chắc chắn chưa tới thẻ: đóng lại để không cản thu hồi/cấp lại thẻ.
      if (cancelled) {
        voided = await cardOpHelper.voidUnsignedDebits({ orderId }, session);
      }
    };

    // Đơn gắn khách hàng có thể có giao dịch ví thẻ: kiểm tra và ghi trong cùng transaction với việc ký debit.
    if (order.customerId && guardedChange) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(() => apply(session));
      } finally {
        await session.endSession();
      }
    } else {
      await apply(null);
    }

    if (voided.length) {
      await cardLogHelper.write({
        action: "card-debit-void",
        cardId: voided[0].cardId,
        actorType: "admin",
        actorId: req.account?.id,
        result: "success",
        detail: { orderId, reason: "order-cancel", txRefs: voided.map(tx => tx.txRef) },
        req
      });
    }

    // Huỷ đơn: dọn vé điện tử (written -> pending-delete, pending -> none); idempotent nên lưu lại lần nữa là an toàn.
    if (cancelled) {
      await ticketHelper.onOrderCancelled(order, req.account?.id);
    }

    req.flash("success", "Cập nhật đơn hàng thành công!");

    res.json({
      code: "success"
    })
  } catch (error) {
    res.json({
      code: "error",
      message: error instanceof EditRefusal ? error.message : INVALID_MESSAGE
    })
  }
}

module.exports.deletePatch = async (req, res) => {
  try {
    if (!req.permissions?.includes("order-delete")) {
      return res.status(403).json({
        code: "error",
        message: "Bạn không có quyền xóa đơn hàng."
      });
    }

    const origin = req.get("origin");
    const expectedOrigin =
      `${req.protocol}://${req.get("host")}`;

    if (origin !== expectedOrigin) {
      return res.status(403).json({
        code: "error",
        message: "Yêu cầu không hợp lệ."
      });
    }

    const id = req.params.id;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({
        code: "error",
        message: "ID đơn hàng không hợp lệ."
      });
    }

    const order = await Order.findOne({
      _id: id,
      deleted: false
    }).lean();

    if (!order) {
      return res.status(404).json({
        code: "error",
        message: "Không tìm thấy đơn hàng."
      });
    }

    // Không xóa đơn đang hoạt động, đã thanh toán
    // hoặc có liên kết khách hàng / Smart Card.
    if (
      order.status !== "cancel" ||
      order.paymentStatus !== "unpaid" ||
      order.customerId ||
      order.cardTxRef
    ) {
      return res.status(409).json({
        code: "error",
        message: "Chỉ có thể ẩn đơn khách vãng lai đã hủy và chưa thanh toán."
      });
    }

    // Không ẩn đơn nếu vẫn có trạng thái vé cần xử lý.
    if (order.items?.some(item =>
      (item.ticketStatus &&
        item.ticketStatus !== "none") ||
      item.checkedInAt ||
      item.writeSignedAt
    )) {
      return res.status(409).json({
        code: "error",
        message: "Đơn còn dữ liệu vé cần đối soát."
      });
    }

    // Dù chưa thanh toán cũng phải kiểm tra
    // xem đã từng phát sinh giao dịch thẻ hay chưa.
    if (await Tx.exists({ orderId: String(order._id) })) {
      return res.status(409).json({
        code: "error",
        message: "Đơn có lịch sử giao dịch thẻ, không thể ẩn."
      });
    }

    const result = await Order.updateOne(
      {
        _id: id,
        deleted: false,
        status: "cancel",
        paymentStatus: "unpaid",
        customerId: { $exists: false },
        cardTxRef: { $exists: false }
      },
      {
        $set: {
          deleted: true,
          deletedBy: req.account.id,
          deletedAt: new Date()
        }
      }
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).json({
        code: "error",
        message: "Trạng thái đơn đã thay đổi. Hãy tải lại trang."
      });
    }

    return res.json({
      code: "success",
      message: "Đã ẩn đơn hàng khỏi danh sách."
    });
  } catch (error) {
    console.error("Order delete error:", error);

    return res.status(500).json({
      code: "error",
      message: "Không thể xử lý đơn hàng."
    });
  }
};

