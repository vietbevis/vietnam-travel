const Tour = require("../../models/tour.model");

module.exports.list = async (req, res) => {
  const tourList = await Tour.find({});

  console.log(tourList);

  res.render("client/pages/tour-list", {
    pageTitle: "Danh sách tour",
    tourList: tourList
  })
}