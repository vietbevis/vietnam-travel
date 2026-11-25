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

  if (category) {
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
      title: category.name
    })
    // End Breadcrumb

    // Danh sách tour
    const listCategoryId =
      await categoryHelper.getAllSubcategoryIds(category.id);

    const find = {
      category: { $in: listCategoryId },
      deleted: false,
      status: "active"
    };

    const totalTour = await Tour.countDocuments(find);

    // Phân trang
    const limit = 9;
    const totalPages = Math.ceil(totalTour / limit);

    const requestedPage = Number(req.query.page);

    const page = Number.isSafeInteger(requestedPage) &&
      requestedPage > 0
      ? Math.min(requestedPage, Math.max(1, totalPages))
      : 1;

    const startPage = Math.max(
      1,
      Math.min(page - 2, totalPages - 4)
    );

    // Tạo mảng số trang
    const pageNumbers = Array.from(
      { length: Math.min(5, totalPages) },
      (_, index) => startPage + index
    );

    // Sắp xếp
    const allowedSorts = [
      "price_asc",
      "price_desc",
      "discount_desc",
      "views_desc"
    ];

    const sortKey = allowedSorts.includes(req.query.sort)
      ? req.query.sort
      : "discount_desc";

    const sortOptions = {
      price_asc: {
        priceNewAdult: 1,
        _id: 1
      },
      price_desc: {
        priceNewAdult: -1,
        _id: 1
      },
      discount_desc: {
        discountRate: -1,
        position: -1,
        _id: 1
      },
      views_desc: {
        viewCount: -1,
        position: -1,
        _id: 1
      }
    };

    // Tính tỷ lệ giảm giá từ giá gốc và giá mới
    const tourList = await Tour.aggregate([
      { $match: find },
      {
        $addFields: {
          discountRate: {
            $cond: [
              { $gt: ["$priceAdult", 0] },
              {
                $divide: [
                  {
                    $subtract: [
                      "$priceAdult",
                      {
                        $ifNull: [
                          "$priceNewAdult",
                          "$priceAdult"
                        ]
                      }
                    ]
                  },
                  "$priceAdult"
                ]
              },
              0
            ]
          }
        }
      },
      { $sort: sortOptions[sortKey] },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    for (const item of tourList) {
      item.departureDateFormat =
        moment(item.departureDate).format("DD/MM/YYYY");
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
      cityList: cityList,
      page: page,
      totalPages: totalPages,
      pageNumbers: pageNumbers,
      sortKey: sortKey
    });
  } else {
    res.redirect("/");
  }
}