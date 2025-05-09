const Category = require("../../models/category.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const moment = require("moment");
const categoryHelper = require("../../helpers/category.helper");

module.exports.list = async (req, res) => {
  // Lấy slug từ params
  const slug = req.params.slug;

  // Tìm danh mục theo slug
  const category = await Category.findOne({
    slug: slug,
    deleted: false,
    status: "active"
  })

  if(category) {
    // Breadcrumb
    const breadcrumb = {
      image: category.avatar,
      title: category.name,
      list: [
        {
          link: "/",
          title: "Trang Chủ"
        }
      ]
    };

    // Tìm danh mục cha
    if(category.parent) {
      const parentCategory = await Category.findOne({
        _id: category.parent,
        deleted: false,
        status: "active"
      })

      if(parentCategory) {
        breadcrumb.list.push({
          link: `/category/${parentCategory.slug}`,
          title: parentCategory.name
        })
      }
    }

    // Thêm danh mục hiện tại
    breadcrumb.list.push({
      link: `/category/${category.slug}`,
      title: category.name
    })
    // End Breadcrumb

    // Danh sách tour
    const listCategoryId = await categoryHelper.getAllSubcategoryIds(category.id);
    const find = {
      category: { $in: listCategoryId },
      deleted: false,
      status: "active"
    };

    const totalTour = await Tour.countDocuments(find);

    const tourList = await Tour
      .find(find)
      .sort({
        position: "desc"
      })

    for(const item of tourList) {
      item.departureDateFormat = moment(item.departureDate).format("DD/MM/YYYY");
    }
    // Hết Danh sách tour

    // Danh sách thành phố
    const cityList = await City.find({});
    // Hết Danh sách thành phố

    res.render("client/pages/tour-list", {
      pageTitle: "Danh sách tour",
      breadcrumb: breadcrumb,
      category: category,
      tourList: tourList,
      totalTour: totalTour,
      cityList: cityList
    });
  } else {
    res.redirect("/");
  }
}