const router = require('express').Router();
const homeRoutes = require("./home.route");
const tourRoutes = require("./tour.route");
const cartRoutes = require("./cart.route");

const settingMiddleware = require("../../middlewares/client/setting.middleware");
const categoryMiddleware = require("../../middlewares/client/category.middleware");

router.use(settingMiddleware.websiteInfo);
router.use(categoryMiddleware.list);

router.use('/', homeRoutes)
router.use('/tours', tourRoutes)
router.use('/cart', cartRoutes)

module.exports = router;