const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const CardTransaction = require("../../models/card-transaction.model");
const variableConfig = require("../../config/variable");
const moment = require("moment");

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
        message: "Thông tin đơn hàng không hợp lệ!"
      })
      return;
    }

    // Chỉ cho sửa các trường thông tin; tiền, liên kết khách và giao dịch thẻ do hệ thống quản lý.
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const protectedFields = ["total", "subTotal", "discount", "cardTxRef", "customerId", "items", "deleted", "deletedBy", "deletedAt", "orderCode"];
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) => !protectedFields.includes(key) && !key.startsWith("$")));

    if(order.paymentMethod === "card") {
      // Đơn ví thẻ: không đổi phương thức/trạng thái thanh toán thủ công (chỉ receipt hợp lệ mới được chuyển paid).
      if(("paymentMethod" in patch && patch.paymentMethod !== "card") || ("paymentStatus" in patch && patch.paymentStatus !== order.paymentStatus)) {
        res.json({
          code: "error",
          message: "Đơn thanh toán bằng ví thẻ chỉ được cập nhật thanh toán qua biên nhận của thẻ!"
        })
        return;
      }
      // Không hủy đơn khi thẻ có thể đã bị trừ tiền nhưng server chưa nhận biên nhận.
      if(patch.status === "cancel" && order.status !== "cancel" && order.cardTxRef) {
        const tx = await CardTransaction.findOne({ txRef: order.cardTxRef }).lean();
        if(tx && tx.status !== "done" && (tx.status === "sent" || tx.signedOpId)) {
          res.json({
            code: "error",
            message: "Đơn có giao dịch thẻ chưa đối soát, cần đồng bộ thẻ của khách trước khi hủy!"
          })
          return;
        }
      }
    }

    await Order.updateOne({
      _id: id,
      deleted: false
    }, patch);

    req.flash("success", "Cập nhật đơn hàng thành công!");

    res.json({
      code: "success"
    })
  } catch (error) {
    res.json({
      code: "error",
      message: "Thông tin đơn hàng không hợp lệ!"
    })
  }
}