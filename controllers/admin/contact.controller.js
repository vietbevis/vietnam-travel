const moment = require("moment");
const Contact = require("../../models/contact.model");
const { paginate } = require("../../helpers/admin-pagination.helper");

module.exports.list = async (req, res) => {
  const find = {
    deleted: false
  };
  const pagination = paginate(req.query, await Contact.countDocuments(find));

  const contactList = await Contact
    .find(find)
    .sort({
      createdAt: "desc",
      _id: "desc"
    }).skip(pagination.skip).limit(pagination.limit);

  for (const item of contactList) {
    item.createdAtFormat = item.createdAt && moment(item.createdAt).utcOffset(420).format("HH:mm - DD/MM/YYYY");
  }

  res.render("admin/pages/contact-list", {
    pageTitle: "Thông tin liên hệ",
    contactList, pagination
  })
}
