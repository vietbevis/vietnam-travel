const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const Tour = require("../../models/tour.model");
const Tx = require("../../models/card-transaction.model");
const Card = require("../../models/card.model");
const Customer = require("../../models/customer.model");
const variableConfig = require("../../config/variable");
const ticketHelper = require("../../helpers/ticket.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const cardOpHelper = require("../../helpers/card-op.helper");
const cardLogHelper = require("../../helpers/card-log.helper");
const cardCrypto = require("../../helpers/card-crypto.helper");
const { restoreOrderStock } = require("../../helpers/order-stock.helper");
const inTransaction = require("../../helpers/mongo-transaction.helper");
const { vietnamDate, selectedIds, personSearch, listPage, listActors } = require("../../helpers/admin-list.helper");

// Debit ví thẻ đã gửi/đã ký mà chưa done: thẻ có thể đã trừ tiền, chỉ biên nhận của thẻ mới kết thúc được giao dịch.
const IN_FLIGHT_MESSAGE = "Đơn đang có giao dịch ví thẻ chưa đối soát; hãy để khách cắm thẻ đồng bộ trước";
const PAID_BY_CARD_MESSAGE = "Đơn đã được thanh toán bằng ví thẻ, không thể chuyển về chưa thanh toán!";
const SETTLE_FAILED_MESSAGE = "Không thể ghi nhận thanh toán cho đơn hàng này!";
const INVALID_MESSAGE = "Thông tin đơn hàng không hợp lệ!";
const GUARDED_FIELDS = ["paymentMethod", "paymentStatus", "status"];
const CONTACT_FIELDS = { fullName: 100, phone: 25, note: 1000 };
const MANUAL_PAYMENT = ["money", "bank"];
const liveOrder = { deleted: { $ne: true } };
const orderTrash = { deleted: true, adminVisibleAfterRestore: { $ne: true } };
const adminVisibleOrder = { $and: [{ $or: [liveOrder, { adminVisibleAfterRestore: true }] }] };
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

function orderList(trash) {
  return async (req, res) => {
    const where = trash ? orderTrash : adminVisibleOrder;
    const page = await listPage(Order, req.query, {
      where, searchKey: "q", search: personSearch,
      enums: Object.fromEntries(Object.entries(FIELD_OPTIONS).map(([field, options]) => [field, options.map(option => option.value)])),
      idFields: trash ? ["deletedBy"] : [], dateField: trash ? "deletedAt" : "createdAt",
      sort: trash ? { deletedAt: -1, _id: -1 } : { createdAt: -1, _id: -1 }
    });
    const orderList = page.rows;
    const accountAdminList = trash ? await listActors(Order, where, orderList, ["deletedBy"]) : [];
    const deletable = !trash && req.permissions.includes("order-delete") ? orderList.filter(canHideOrder).map(order => order.id) : [];
    const transactions = deletable.length ? await Tx.distinct("orderId", { orderId: { $in: deletable } }) : [];
    const canHide = new Set(deletable);
    for (const id of transactions) canHide.delete(id);
    for (const order of orderList) {
      order.paymentMethodName = labelOf("paymentMethod", order.paymentMethod);
      order.paymentStatusName = labelOf("paymentStatus", order.paymentStatus);
      order.statusName = labelOf("status", order.status);
      order.createdAtTime = vietnamDate(order.createdAt, "HH:mm");
      order.createdAtDate = vietnamDate(order.createdAt, "DD/MM/YYYY");
      order.deletedAtFormat = vietnamDate(order.deletedAt);
    }
    return res.status(page.listError ? 400 : 200).render("admin/pages/order-list", {
      ...page, pageTitle: trash ? "Thùng rác đơn hàng" : "Quản lý đơn hàng",
      orderList, accountAdminList, canHide, trash,
      orderStatuses: variableConfig.orderStatus, paymentMethods: variableConfig.paymentMethod,
      paymentStatuses: variableConfig.paymentStatus
    });
  };
}

const labelOf = (field, value) => FIELD_OPTIONS[field].find(item => item.value === value)?.label || value || "Không có dữ liệu";
const canHideOrder = order => order.deleted !== true && order.status === "cancel" && order.paymentStatus === "unpaid" &&
  order.customerId === undefined && order.cardTxRef === undefined && !hasActiveOrderTicket(order);
const hasActiveOrderTicket = order => order.items?.some(item =>
  (item.ticketStatus && item.ticketStatus !== "none") || item.checkedInAt || item.writeSignedAt || item.checkinOpId);
const canEditPayment = order => order.status !== "cancel" && order.paymentStatus === "unpaid" &&
  MANUAL_PAYMENT.includes(order.paymentMethod) && !order.cardTxRef && !order.refundTxRef;

module.exports.list = orderList(false);
module.exports.trash = orderList(true);

async function restoreOrders(req, res, values, option) {
  const ids = selectedIds(values);
  if (!ids || option !== "undo") return res.status(400).json({ code: "error", message: "Thao tác hoặc danh sách đơn hàng không hợp lệ." });
  const restored = await inTransaction(async session => {
    const filter = { _id: { $in: ids }, ...orderTrash };
    if (await Order.countDocuments(filter, { session }) !== ids.length) return false;
    // Giữ deleted cho cả đơn đã hủy, vì đồng bộ vé vẫn dùng nó để chặn lệnh xóa vé cũ.
    const result = await Order.updateMany(filter, { $set: { adminVisibleAfterRestore: true } },
      { session, timestamps: false });
    if (result.matchedCount !== ids.length) throw new Error("Đơn hàng đã thay đổi trong lúc khôi phục.");
    return true;
  });
  if (!restored) return res.status(409).json({ code: "error", message: "Tất cả đơn được chọn phải còn trong thùng rác." });
  req.flash("success", "Đã khôi phục khả năng hiển thị của đơn hàng.");
  return res.json({ code: "success", count: ids.length });
}

module.exports.undoPatch = (req, res) => restoreOrders(req, res, [req.params.id], "undo");
module.exports.trashChangeMultiPatch = (req, res) => restoreOrders(req, res, req.body?.ids, req.body?.option);


async function renderOrderEdit(req, res, formError) {
  try {
    const id = req.params.id;

    const orderDetail = await Order.findOne({
      _id: id,
      ...adminVisibleOrder
    })
    if (!orderDetail) return res.status(404).render("admin/pages/error-404", { pageTitle: "Không tìm thấy đơn hàng" });

    orderDetail.createdAtFormat = vietnamDate(orderDetail.createdAt, "YYYY-MM-DDTHH:mm");

    for (const item of orderDetail.items) {
      const city = OBJECT_ID.test(String(item.locationFrom || "")) ? await City.findById(item.locationFrom) : null;
      item.locationFromName = city?.name || "Chưa xác định";
      item.departureDateFormat = vietnamDate(item.departureDate, "DD/MM/YYYY");
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
      viewOnly: orderDetail.deleted === true,
      formError,
      cardRefund,
      refundInfo,
      usedTicket,
      pendingCheckin,
      paymentEditable: canEditPayment(orderDetail),
      paymentMethod: canEditPayment(orderDetail)
        ? variableConfig.paymentMethod.filter(item => MANUAL_PAYMENT.includes(item.value)) : variableConfig.paymentMethod,
      paymentStatus: variableConfig.paymentStatus,
      orderStatus: variableConfig.orderStatus
    })
  } catch (error) {
    res.redirect(`/${pathAdmin}/order/list`);
  }
}

module.exports.edit = (req, res) => renderOrderEdit(req, res);

async function editOrder(req, res, native = false) {
  const reply = (data, status = 200) => {
    if (!native) return res.status(status).json(data);
    if (data.code === "success") return res.redirect(303, req.baseUrl + "/edit/" + req.params.id);
    return renderOrderEdit(req, res.status(status === 200 ? 400 : status), data.message);
  };
  if (!req.permissions?.includes("order-edit")) return reply({ code: "error", message: "Bạn không có quyền sửa đơn hàng." }, 403);
  try {
    const id = req.params.id;

    const order = await Order.findOne({
      _id: id,
      ...liveOrder
    });

    if (!order) {
      return reply({ code: "error", message: INVALID_MESSAGE });
    }

    // Huỷ đơn là trạng thái cuối: vé đã được dọn khỏi thẻ, không cho mở lại.
    if (order.status === "cancel" && req.body?.status !== undefined && req.body.status !== "cancel") {
      return reply({ code: "error", message: "Đơn hàng đã huỷ, không thể đổi sang trạng thái khác!" });
    }

    // Chỉ ghi các trường form sửa đơn gửi lên; không nhận ticketStatus, orderCode, items... từ body.
    const update = {};
    for (const field of [...Object.keys(CONTACT_FIELDS), ...GUARDED_FIELDS]) {
      const value = req.body?.[field];
      if (value === undefined || value === order[field]) continue;
      if (typeof value !== "string" || (CONTACT_FIELDS[field] !== undefined && value.length > CONTACT_FIELDS[field])) {
        throw new EditRefusal(INVALID_MESSAGE);
      }
      if ((field === "fullName" || field === "phone") && !value.trim()) throw new EditRefusal(INVALID_MESSAGE);
      update[field] = value;
    }

    if (native && GUARDED_FIELDS.some(field => update[field] !== undefined)) {
      return reply({ code: "error", message: "Hãy bật JavaScript để mở hộp xác nhận thay đổi trạng thái hoặc thanh toán." }, 409);
    }

    // Trạng thái và phương thức thanh toán chỉ nhận giá trị có trong cấu hình.
    for (const field of GUARDED_FIELDS) {
      if (update[field] !== undefined && !FIELD_OPTIONS[field].some(item => item.value === update[field])) {
        return reply({ code: "error", message: INVALID_MESSAGE });
      }
    }

    // Hủy đơn, hoàn tồn kho, hoàn tiền ví thẻ (nếu đơn đã trừ ví) và dọn vé trong cùng một transaction.
    if (update.status === "cancel") {

      // Không cho vừa hủy vừa đổi thanh toán.
      if (
        update.paymentMethod !== undefined ||
        update.paymentStatus !== undefined
      ) {
        return reply({
          code: "error",
          message: "Hãy xử lý thanh toán riêng trước khi hủy."
        }, 409);
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
            ...liveOrder
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

          for (const field of Object.keys(CONTACT_FIELDS)) {
            if (update[field] !== undefined) fieldsToSet[field] = update[field];
          }

          const compare = {
            _id: id,
            ...liveOrder,
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
        return reply({
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

      return reply({
        code: "success",
        message: "Đã hủy đơn và hoàn tồn kho."
      });
    }


    const orderId = String(order._id);
    const guardedChange = GUARDED_FIELDS.some(field => update[field] !== undefined);
    const paymentChange = update.paymentMethod !== undefined || update.paymentStatus !== undefined;
    const markPaid = update.paymentStatus === "paid";
    const fields = { ...update };
    delete fields.paymentStatus;

    const voided = await inTransaction(async session => {
      const current = await Order.findOne({ _id: id, ...liveOrder }).session(session).lean();
      if (!current || (guardedChange && GUARDED_FIELDS.some(field => current[field] !== order[field]))) {
        throw new EditRefusal("Trạng thái đơn đã thay đổi. Hãy tải lại trang.");
      }
      if (guardedChange && await Tx.exists(cardOpHelper.unresolvedFilter({ orderId, type: "debit" })).session(session)) {
        throw new EditRefusal(IN_FLIGHT_MESSAGE);
      }
      if (paymentChange) {
        if (current.paymentMethod === "card" && current.paymentStatus === "paid") throw new EditRefusal(PAID_BY_CARD_MESSAGE);
        if (current.paymentMethod === "card" || update.paymentMethod === "card") {
          throw new EditRefusal("Thanh toán ví thẻ chỉ được xác nhận bằng biên nhận trừ tiền hợp lệ!");
        }
        if (!canEditPayment(current) || (update.paymentMethod && !MANUAL_PAYMENT.includes(update.paymentMethod)) ||
            (update.paymentStatus !== undefined && !markPaid)) {
          throw new EditRefusal("Chỉ có thể xác nhận thanh toán tiền mặt hoặc chuyển khoản đang chờ. Giao dịch đã ghi nhận và thanh toán online cần đối soát riêng.");
        }
      }
      if (Object.keys(fields).length || markPaid) {
        const changed = await Order.updateOne(
          { _id: id, ...liveOrder, status: current.status, paymentMethod: current.paymentMethod, paymentStatus: current.paymentStatus },
          { $set: { ...fields, updatedBy: req.account.id } }, { session }
        );
        if (!changed.matchedCount) throw new EditRefusal("Trạng thái đơn đã thay đổi. Hãy tải lại trang.");
      }
      if (markPaid && !await orderPaymentHelper.markOrderPaidInSession({ _id: orderId }, update.paymentMethod || current.paymentMethod, session)) {
        throw new EditRefusal(SETTLE_FAILED_MESSAGE);
      }
      if (native || current.status !== "cancel") return [];
      const transactions = await cardOpHelper.voidUnsignedDebits({ orderId }, session);
      await ticketHelper.onOrderCancelled(current, req.account.id, session);
      return transactions;
    });

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

    req.flash("success", "Cập nhật đơn hàng thành công!");

    return reply({ code: "success" });
  } catch (error) {
    return reply({
      code: "error",
      message: error instanceof EditRefusal ? error.message : INVALID_MESSAGE
    });
  }
}

module.exports.editPatch = (req, res) => editOrder(req, res);
module.exports.editPost = (req, res) => {
  if (req.get("origin") !== req.protocol + "://" + req.get("host")) {
    return res.status(403).send("Nguồn yêu cầu không hợp lệ.");
  }
  return editOrder(req, res, true);
};

module.exports.deletePatch = async (req, res) => {
  const fail = (status, message) => res.status(status).json({ code: "error", message });
  if (!req.permissions?.includes("order-delete")) return fail(403, "Bạn không có quyền xóa đơn hàng.");
  if (req.get("origin") !== req.protocol + "://" + req.get("host")) return fail(403, "Yêu cầu không hợp lệ.");
  const id = req.params.id;
  if (!OBJECT_ID.test(id)) return fail(400, "ID đơn hàng không hợp lệ.");

  try {
    const refusal = await inTransaction(async session => {
      const order = await Order.findOne({ _id: id, ...liveOrder }).session(session).lean();
      if (!order) return [404, "Không tìm thấy đơn hàng."];
      if (order.status !== "cancel" || order.paymentStatus !== "unpaid" || order.customerId !== undefined || order.cardTxRef !== undefined) {
        return [409, "Chỉ có thể ẩn đơn khách vãng lai đã hủy và chưa thanh toán."];
      }
      if (hasActiveOrderTicket(order)) return [409, "Đơn còn dữ liệu vé cần đối soát."];
      if (await Tx.exists({ orderId: String(order._id) }).session(session)) {
        return [409, "Đơn có lịch sử giao dịch thẻ, không thể ẩn."];
      }
      const changed = await Order.updateOne(
        { _id: id, ...liveOrder, status: "cancel", paymentStatus: "unpaid", customerId: { $exists: false }, cardTxRef: { $exists: false } },
        { $set: { deleted: true, deletedBy: req.account.id, deletedAt: new Date() } }, { session }
      );
      if (changed.modifiedCount !== 1) return [409, "Trạng thái đơn đã thay đổi. Hãy tải lại trang."];
    });
    if (refusal) return fail(...refusal);
    req.flash("success", "Đã ẩn đơn hàng khỏi danh sách.");
    return res.json({ code: "success", message: "Đã ẩn đơn hàng khỏi danh sách." });
  } catch {
    return fail(500, "Không thể xử lý đơn hàng.");
  }
};
