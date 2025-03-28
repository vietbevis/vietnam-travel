module.exports.list = async (req, res) => {
  res.render("admin/pages/order-list", {
    pageTitle: "Quản lý đơn hàng"
  })
}

module.exports.edit = async (req, res) => {
  res.render("admin/pages/order-edit", {
    pageTitle: "Đơn hàng: OD000001"
  })
}