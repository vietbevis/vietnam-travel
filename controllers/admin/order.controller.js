const mongoose = require("mongoose");
const Order = require("../../models/order.model");
const City = require("../../models/city.model");
const Tour = require("../../models/tour.model");
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

class EditRefusal extends Error { }

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


    // Hủy đơn và hoàn tồn kho trong cùng transaction.
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

      try {
        await session.withTransaction(async () => {
          voided = [];

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

          // Không tự hoàn tiền khi hủy.
          if (current.paymentStatus !== "unpaid") {
            throw new EditRefusal(
              "Đơn đã thanh toán cần xử lý hoàn tiền và đối soát riêng."
            );
          }

          // Tránh hủy giao dịch cổng đang chờ callback.
          if (!["money", "bank", "card"].includes(current.paymentMethod)) {
            throw new EditRefusal(
              "Phương thức thanh toán này cần đối soát trước khi hủy."
            );
          }

          const orderId = String(current._id);

          // Debit đã ký hoặc đã gửi có thể đã tới chip.
          const unsafeDebit = await Tx.exists({
            orderId,
            type: "debit",
            $or: [
              { signedOpId: { $exists: true } },
              { status: { $in: ["sent", "done", "reconciliation"] } }
            ]
          }).session(session);

          if (unsafeDebit) {
            throw new EditRefusal(
              "Giao dịch ví thẻ cần đối soát trước khi hủy."
            );
          }

          if (!Array.isArray(current.items) || !current.items.length) {
            throw new EditRefusal("Đơn không có danh sách tour hợp lệ.");
          }

          // Gộp số lượng của các item thuộc cùng một tour.
          const stockByTour = new Map();
          let totalPassengers = 0;

          for (const item of current.items) {
            const tourId = String(item.tourId || "");
            const adult = item.quantityAdult;
            const children = item.quantityChildren;
            const baby = item.quantityBaby;

            if (
              !/^[a-fA-F0-9]{24}$/.test(tourId) ||
              ![adult, children, baby].every(
                n => Number.isSafeInteger(n) && n >= 0
              )
            ) {
              throw new EditRefusal(
                "Số lượng hoặc mã tour trong đơn không hợp lệ."
              );
            }

            const quantity = adult + children + baby;
            if (
              !Number.isSafeInteger(quantity) ||
              !Number.isSafeInteger(totalPassengers + quantity)
            ) {
              throw new EditRefusal("Số lượng khách không hợp lệ.");
            }

            totalPassengers += quantity;

            const previous = stockByTour.get(tourId) || {
              adult: 0,
              children: 0,
              baby: 0
            };

            const next = {
              adult: previous.adult + adult,
              children: previous.children + children,
              baby: previous.baby + baby
            };

            if (!Object.values(next).every(Number.isSafeInteger)) {
              throw new EditRefusal("Số lượng hoàn kho vượt giới hạn.");
            }

            stockByTour.set(tourId, next);
          }

          if (totalPassengers < 1) {
            throw new EditRefusal("Đơn không có hành khách hợp lệ.");
          }

          // Chỉ chuyển trạng thái nếu đơn chưa hủy
          // và chưa từng ghi nhận hoàn tồn kho.
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

          const changed = await Order.updateOne(
            {
              _id: id,
              deleted: false,
              status: current.status,
              paymentStatus: "unpaid",
              paymentMethod: current.paymentMethod,
              stockRestoredAt: { $exists: false }
            },
            { $set: fieldsToSet },
            { session }
          );

          if (changed.modifiedCount !== 1) {
            throw new EditRefusal(
              "Trạng thái đơn đã thay đổi. Hãy tải lại trang."
            );
          }

          // Hoàn chỗ bằng $inc, không ghi đè tồn kho hiện tại.
          for (const [tourId, quantity] of stockByTour) {
            const result = await Tour.updateOne(
              { _id: tourId },
              {
                $inc: {
                  stockAdult: quantity.adult,
                  stockChildren: quantity.children,
                  stockBaby: quantity.baby
                }
              },
              { session }
            );

            if (result.matchedCount !== 1) {
              throw new EditRefusal(
                "Không tìm thấy tour để hoàn chỗ. Đã rollback."
              );
            }
          }

          // Debit chưa ký được đóng trong cùng transaction.
          voided = await cardOpHelper.voidUnsignedDebits(
            { orderId },
            session
          );
        });
      } finally {
        await session.endSession();
      }

      // Transaction đã commit.
      // Các thao tác ghi log / đồng bộ vé thực hiện sau commit.
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

      let ticketSyncWarning = false;

      try {
        await ticketHelper.onOrderCancelled(
          order,
          req.account?.id
        );
      } catch (error) {
        ticketSyncWarning = true;
        console.error("Ticket cancellation sync failed:", error);
      }

      req.flash("success", "Đã hủy đơn và hoàn số chỗ.");

      return res.json({
        code: "success",
        message: "Đã hủy đơn và hoàn tồn kho.",
        ...(ticketSyncWarning
          ? { warning: "Cần kiểm tra đồng bộ vé Smart Card." }
          : {})
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

