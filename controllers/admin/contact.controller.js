module.exports.list = async (req, res) => {
  res.render("admin/pages/contact-list", {
    pageTitle: "Thông tin liên hệ"
  })
}