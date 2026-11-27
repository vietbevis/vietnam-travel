const router = require('express').Router();
const homeRoutes = require("./home.route");
const tourRoutes = require("./tour.route");
const cartRoutes = require("./cart.route");
const contactRoutes = require("./contact.route");
const categoryRoutes = require("./category.route");
const searchRoutes = require("./search.route");
const orderRoutes = require("./order.route");

const settingMiddleware = require("../../middlewares/client/setting.middleware");
const categoryMiddleware = require("../../middlewares/client/category.middleware");
const { asyncRoute } = require('../../middlewares/http-route.middleware');

router.use('/card-api', require('./card-api.route'));
router.use(require('../../middlewares/client/customer-auth.middleware').optional);
function loadPageLocals(middleware) {
  return asyncRoute((req, res, next) => {
    if ((req.method === 'POST' && req.path === '/order/payment-zalopay-result') ||
        (req.method === 'GET' && req.path === '/order/payment-vnpay-result')) return next();
    return middleware(req, res, next);
  });
}
router.use((req, res, next) => {
  res.locals.settingWebsiteInfo = {};
  res.locals.categoryList = [];
  next();
});
router.use(loadPageLocals(settingMiddleware.websiteInfo));
router.use(loadPageLocals(categoryMiddleware.list));
router.use('/account',require('./account.route'));

router.use('/', homeRoutes)
router.use('/tour', tourRoutes)
router.use('/cart', cartRoutes)
router.use('/contact', contactRoutes)
router.use('/category', categoryRoutes)
router.use('/search', searchRoutes)
router.use('/order', orderRoutes)

router.get('*', (req, res, next) => {
  if (/^\/(?:assets|api|card-api)\b/.test(req.path) || /\.[a-z\d]+$/i.test(req.path)) return next();
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(404).json({ code: 'error', message: 'Không tìm thấy tài nguyên.' });
  }
  if (!req.accepts('html')) return next();
  return res.status(404).render('client/pages/error-404', { pageTitle: 'Không tìm thấy trang' });
});

module.exports = router;
