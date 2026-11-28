const Category = require("../../models/category.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const moment = require("moment");
const { sanitizeTourHtml } = require("../../helpers/tour-rich-text.helper");
const { publicTourCategoryFilter } = require("../../helpers/category.helper");

module.exports.detail = async (req, res) => {
  const slug = req.params.slug;

  // Tìm tour theo slug
  const tourDetail = await Tour.findOneAndUpdate(
    {
      slug: slug,
      status: "active",
      deleted: false,
      ...publicTourCategoryFilter(res.locals.categoryList)
    },
    {
      $inc: { viewCount: 1 }
    },
    {
      new: true
    }
  );

  if (tourDetail) {
    tourDetail.information = sanitizeTourHtml(tourDetail.information);
    tourDetail.schedules = (tourDetail.schedules || []).map(item => ({
      ...item, description: sanitizeTourHtml(item?.description)
    }));
    // Breadcrumb
    const breadcrumb = {
      image: tourDetail.avatar,
      title: tourDetail.name,
      list: [
        {
          link: "/",
          title: "Trang Chủ"
        }
      ]
    };

    const category = await Category.findOne({
      _id: tourDetail.category,
      deleted: false,
      status: "active"
    })

    if (category) {
      // Tìm danh mục cha
      if (category.parent) {
        const parentCategory = await Category.findOne({
          _id: category.parent,
          deleted: false,
          status: "active"
        })

        if (parentCategory) {
          breadcrumb.list.push({
            link: `/category/${parentCategory.slug}`,
            title: parentCategory.name
          })
        }
      }

      // Thêm danh mục hiện tại
      breadcrumb.list.push({
        link: `/category/${category.slug}`,
        title: category.name,
      })
    }

    breadcrumb.list.push({
      link: `/tour/detail/${slug}`,
      title: tourDetail.name
    });
    // End Breadcrumb

    // Thông tin chi tiết
    tourDetail.departureDateFormat = moment(tourDetail.departureDate).format("DD/MM/YYYY");

    const cityList = await City.find({
      _id: { $in: tourDetail.locations }
    })
    // Hết Thông tin chi tiết

    res.render("client/pages/tour-detail", {
      pageTitle: "Chi tiết tour",
      breadcrumb: breadcrumb,
      tourDetail: tourDetail,
      cityList: cityList
    })
  } else {
    res.status(404).render('client/pages/error-404', { pageTitle: 'Không tìm thấy tour' });
  }
  // Hết Tìm tour theo slug
}
