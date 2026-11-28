const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const moment = require("moment");
const tierHelper = require("../../helpers/tier.helper");
const { isCategoryId, publicTourCategoryFilter } = require("../../helpers/category.helper");

module.exports.cart = async (req, res) => {
  res.render("client/pages/cart", {
    pageTitle: "Giỏ hàng",
    // Hạng thành viên để giỏ hàng hiển thị mức giảm; null khi chưa đăng nhập
    tier: req.customer ? tierHelper.tierOf(req.customer.totalSpent || 0) : null,
    card: req.card || null
  })
}

module.exports.detail = async (req, res) => {
  const cart = [];
  const category = publicTourCategoryFilter(res.locals.categoryList);

  for (const item of Array.isArray(req.body) ? req.body : []) {
    if (!isCategoryId(item?.tourId) || !isCategoryId(item?.locationFrom)) continue;
    const tourInfo = await Tour.findOne({
      _id: item.tourId,
      status: "active",
      deleted: false,
      ...category
    });

    if (tourInfo) {
      if (!tourInfo.locations?.some(id => String(id).toLowerCase() === item.locationFrom.toLowerCase())) continue;
      if (![tourInfo.priceNewAdult, tourInfo.priceNewChildren, tourInfo.priceNewBaby]
        .every(value => Number.isSafeInteger(value) && value >= 0)) continue;
      const city = await City.findById(item.locationFrom);
      if (!city) continue;
      item.avatar = tourInfo.avatar;
      item.name = tourInfo.name;
      item.slug = tourInfo.slug;
      item.departureDateFormat = moment(tourInfo.departureDate).format("DD/MM/YYYY");
      item.priceNewAdult = tourInfo.priceNewAdult;
      item.priceNewChildren = tourInfo.priceNewChildren;
      item.priceNewBaby = tourInfo.priceNewBaby;
      item.stockAdult = tourInfo.stockAdult;
      item.stockChildren = tourInfo.stockChildren;
      item.stockBaby = tourInfo.stockBaby;

      item.locationFromName = city.name;
      cart.push(item);
    }
  }

  res.json({
    code: "success",
    cart: cart
  })
}
