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
const uploadRoutes = require("./upload.route");

const authMiddleware = require("../../middlewares/admin/auth.middleware");
const { hasPermission } = require("../../config/permission");

const landingPages = [
  ['dashboard-view', '/dashboard'], ['category-view', '/category/list'], ['tour-view', '/tour/list'],
  ['tour-trash', '/tour/trash'], ['order-view', '/order/list'], ['card-view', '/card/list'],
  ['card-issue', '/card/issue'], ['card-checkin', '/card/checkin'], ['card-log-view', '/card/log'],
  ['contact-view', '/contact/list'], ['website-view', '/setting/website-info'],
  ['account-admin-view', '/setting/account-admin/list'], ['role-view', '/setting/role/list']
];

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    const parsed = new URL(origin);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin &&
        parsed.host.toLowerCase() === req.get('host')?.toLowerCase()) return next();
  } catch {}
  return res.status(403).json({ code: 'error', message: 'Nguồn yêu cầu không hợp lệ.' });
})

router.use('/account', accountRoutes)
router.use('/dashboard', authMiddleware.verifyToken, dashboardRoutes)
router.use('/category', authMiddleware.verifyToken, categoryRoutes)
router.use('/tour', authMiddleware.verifyToken, tourRoutes)
router.use('/order', authMiddleware.verifyToken, orderRoutes)
router.use('/user', authMiddleware.verifyToken, userRoutes)
router.use('/contact', authMiddleware.verifyToken, contactRoutes)
router.use('/setting', authMiddleware.verifyToken, settingRoutes)
router.use('/profile', authMiddleware.verifyToken, profileRoutes)
router.use('/upload', authMiddleware.verifyToken, uploadRoutes)
router.use('/card', require('../../controllers/admin/card.controller').authenticate, authMiddleware.verifyToken, require('./card.route'))

router.get(['/','/start'], authMiddleware.verifyToken, (req, res) => {
  const landing = landingPages.find(([permission]) => hasPermission(req.permissions, permission));
  return res.redirect(req.baseUrl + (landing?.[1] || '/profile/edit'));
});

router.get('*', authMiddleware.verifyToken, (req, res) => {
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(404).json({ code: 'error', message: 'Không tìm thấy tài nguyên.' });
  }
  res.status(404).render("admin/pages/error-404", {
    pageTitle: "404 Not Found"
  })
})

module.exports = router;
