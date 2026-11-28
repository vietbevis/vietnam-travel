const categoryHelper = require("../../helpers/category.helper");

module.exports.list = async (req, res, next) => {
  res.locals.categoryList = await categoryHelper.publicCategoryTree();

  next();
}
