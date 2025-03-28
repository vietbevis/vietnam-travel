module.exports.edit = async (req, res) => {
  res.render("admin/pages/profile-edit", {
    pageTitle: "Thông tin cá nhân"
  })
}

module.exports.changePassword = async (req, res) => {
  res.render("admin/pages/profile-change-password", {
    pageTitle: "Đổi mật khẩu"
  })
}