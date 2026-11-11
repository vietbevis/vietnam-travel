const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const Tx = require("../../models/card-transaction.model");
const variableConfig = require("../../config/variable");
const moment = require("moment");
const ticketHelper = require("../../helpers/ticket.helper");
const orderPaymentHelper = require("../../helpers/order-payment.helper");
const cardOpHelper = require("../../helpers/card-op.helper");
const cardLogHelper = require("../../helpers/card-log.helper");

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

class EditRefusal extends Error {}

module.exports.list = async (req, res) => {
  const find = {
    deleted: false
  };

  const orderList = await Order
    .find(find)
    .sort({
      createdAt: "desc"
    });

  for (const orderDetail of orderList) {
    orderDetail.paymentMethodName = variableConfig.paymentMethod.find(item => item.value == orderDetail.paymentMethod).label;
    
    orderDetail.paymentStatusName = variableConfig.paymentStatus.find(item => item.value == orderDetail.paymentStatus).label;

    orderDetail.statusName = variableConfig.orderStatus.find(item => item.value == orderDetail.status).label;

    orderDetail.createdAtTime = moment(orderDetail.createdAt).format("HH:mm");
    orderDetail.createdAtDate = moment(orderDetail.createdAt).format("DD/MM/YYYY");
  }

  res.render("admin/pages/order-list", {
    pageTitle: "Quản lý đơn hàng",
    orderList: orderList
  })
}

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;

    const orderDetail = await Order.findOne({
      _id: id,
      deleted: false
    })

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("YYYY-MM-DDTHH:mm");

    for (const item of orderDetail.items) {
      const city = await City.findOne({
        _id: item.locationFrom
      });
      item.locationFromName = city.name;
      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
    }

    res.render("admin/pages/order-edit", {
      pageTitle: `Đơn hàng: ${orderDetail.orderCode}`,
      orderDetail: orderDetail,
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

    if(!order) {
      res.json({
        code: "error",
        message: INVALID_MESSAGE
      })
      return;
    }

    // Huỷ đơn là trạng thái cuối: vé đã được dọn khỏi thẻ, không cho mở lại.
    if(order.status === "cancel" && req.body.status !== undefined && req.body.status !== "cancel") {
      res.json({
        code: "error",
        message: "Đơn hàng đã huỷ, không thể đổi sang trạng thái khác!"
      })
      return;
    }

    // Chỉ ghi các trường form sửa đơn gửi lên; không nhận ticketStatus, orderCode, items... từ body.
    const update = {};
    for(const field of ["fullName", "phone", "note", "paymentMethod", "paymentStatus", "status"]) {
      if(typeof req.body[field] === "string") {
        update[field] = req.body[field];
      }
    }

    // Trạng thái và phương thức thanh toán chỉ nhận giá trị có trong cấu hình.
    for(const field of GUARDED_FIELDS) {
      if(update[field] !== undefined && !FIELD_OPTIONS[field].some(item => item.value === update[field])) {
        res.json({
          code: "error",
          message: INVALID_MESSAGE
        })
        return;
      }
    }

    // Form luôn gửi lại đủ trường: giá trị không đổi thì không coi là thay đổi tiền/trạng thái.
    for(const field of GUARDED_FIELDS) {
      if(update[field] === order[field]) {
        delete update[field];
      }
    }

    const orderId = String(order._id);
    const guardedChange = GUARDED_FIELDS.some(field => update[field] !== undefined);
    // Chuyển sang đã thanh toán phải đi qua settlement chung để vé điện tử và chi tiêu khách được cập nhật.
    const markPaid = update.paymentStatus === "paid";
    const fields = {...update};
    if(markPaid) {
      delete fields.paymentStatus;
    }

    // Lưu lại đơn đã huỷ vẫn chạy lại phần dọn dẹp (idempotent).
    const cancelled = (update.status || order.status) === "cancel";
    let voided = [];
    const apply = async session => {
      voided = [];
      const options = session ? {session} : {};
      if(guardedChange) {
        if(await Tx.exists({orderId, type: "debit", status: {$ne: "done"}, $or: [{status: "sent"}, {signedOpId: {$exists: true}}]}).session(session || null)) {
          throw new EditRefusal(IN_FLIGHT_MESSAGE);
        }
        // Huỷ thanh toán không hoàn tiền ví (spec 1.2); mở lại đơn đã trừ ví sẽ cho phép trừ lần hai.
        if(order.paymentStatus === "paid" && update.paymentStatus !== undefined && await Tx.exists({orderId, type: "debit", status: "done"}).session(session || null)) {
          throw new EditRefusal(PAID_BY_CARD_MESSAGE);
        }
      }
      if(Object.keys(fields).length) {
        await Order.updateOne({
          _id: id,
          deleted: false
        }, {$set: fields}, options);
      }
      if(markPaid) {
        const method = update.paymentMethod || order.paymentMethod;
        const settled = session
          ? await orderPaymentHelper.markOrderPaidInSession({_id: orderId}, method, session)
          : await orderPaymentHelper.markOrderPaid({_id: orderId}, method);
        if(!settled) {
          throw new EditRefusal(SETTLE_FAILED_MESSAGE);
        }
      }
      // Debit chưa từng ký của đơn huỷ chắc chắn chưa tới thẻ: đóng lại để không cản thu hồi/cấp lại thẻ.
      if(cancelled) {
        voided = await cardOpHelper.voidUnsignedDebits({orderId}, session);
      }
    };

    // Đơn gắn khách hàng có thể có giao dịch ví thẻ: kiểm tra và ghi trong cùng transaction với việc ký debit.
    if(order.customerId && guardedChange) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(() => apply(session));
      } finally {
        await session.endSession();
      }
    } else {
      await apply(null);
    }

    if(voided.length) {
      await cardLogHelper.write({
        action: "card-debit-void",
        cardId: voided[0].cardId,
        actorType: "admin",
        actorId: req.account?.id,
        result: "success",
        detail: {orderId, reason: "order-cancel", txRefs: voided.map(tx => tx.txRef)},
        req
      });
    }

    // Huỷ đơn: dọn vé điện tử (written -> pending-delete, pending -> none); idempotent nên lưu lại lần nữa là an toàn.
    if(cancelled) {
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