module.exports.list = async (req, res) => {
  res.render("admin/pages/tour-list", {
    pageTitle: "Quản lý tour"
  })
}

module.exports.create = async (req, res) => {
  res.render("admin/pages/tour-create", {
    pageTitle: "Tạo tour"
  })
}

module.exports.trash = async (req, res) => {
  res.render("admin/pages/tour-trash", {
    pageTitle: "Thùng rác tour"
  })
}