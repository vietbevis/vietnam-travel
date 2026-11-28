const Tour = require("../../models/tour.model");
const moment = require("moment");
const categoryHelper = require("../../helpers/category.helper");

module.exports.home = async (req, res) => {
  const tree = res.locals.categoryList;
  // Section 2
  const tourListSection2 = await Tour
    .find({
      deleted: false,
      status: "active",
      ...categoryHelper.publicTourCategoryFilter(tree)
    })
    .sort({
      position: "desc"
    })
    .limit(6)

  for (const item of tourListSection2) {
    item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
  }
  // End Section 2

  // Section 4: Tour Trong Nước
  const categoryIdSection4 = "67fd050210c7084c1076f7cf"; // id danh mục Tour Trong Nước
  const domesticCategory = categoryHelper.findCategoryNode(tree, category => category.id === categoryIdSection4);
  const listCategoryId = domesticCategory ? categoryHelper.treeIds([domesticCategory]) : [];

  const tourListSection4 = await Tour
    .find({
      category: { $in: categoryHelper.categoryReferences(listCategoryId) },
      deleted: false,
      status: "active"
    })
    .sort({
      position: "desc"
    })
    .limit(8)

  for (const item of tourListSection4) {
    item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
  }
  // End Section 4: Tour Trong Nước

  const foreignCategory = categoryHelper.findCategoryNode(tree, category => category.name === "Tour Nước Ngoài");

  const domesticToursHref = domesticCategory
    ? `/category/${domesticCategory.slug}`
    : "/search";

  const foreignToursHref = foreignCategory
    ? `/category/${foreignCategory.slug}`
    : "/search";

  res.render("client/pages/home", {
    pageTitle: "Trang chủ",
    tourListSection2: tourListSection2,
    domesticToursHref: domesticToursHref,
    foreignToursHref: foreignToursHref,
    tourListSection4: tourListSection4
  })
}
