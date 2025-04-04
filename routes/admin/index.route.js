const router = require('express').Router();
const accountRoutes = require("./account.route");
const dashboardRoutes = require("./dashboard.route");
const categoryRoutes = require("./category.route");
const tourRoutes = require("./tour.route");
const orderRoutes = require("./order.route");
const userRoutes = require("./user.route");
const contactRoutes = require("./contact.route");
const settingRoutes = require("./setting.route");
const profileRoutes = require("./profile.route");

const authMiddleware = require("../../middlewares/admin/auth.middleware");

router.use('/account', accountRoutes)
router.use('/dashboard', authMiddleware.verifyToken, dashboardRoutes)
router.use('/category', authMiddleware.verifyToken, categoryRoutes)
router.use('/tour', authMiddleware.verifyToken, tourRoutes)
router.use('/order', authMiddleware.verifyToken, orderRoutes)
router.use('/user', authMiddleware.verifyToken, userRoutes)
router.use('/contact', authMiddleware.verifyToken, contactRoutes)
router.use('/setting', authMiddleware.verifyToken, settingRoutes)
router.use('/profile', authMiddleware.verifyToken, profileRoutes)

router.get('*', authMiddleware.verifyToken, (req, res) => {
  res.render("admin/pages/error-404", {
    pageTitle: "404 Not Found"
  })
})

module.exports = router;