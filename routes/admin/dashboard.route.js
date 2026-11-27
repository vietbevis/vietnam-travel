const router = require('express').Router();

const dashboardController = require("../../controllers/admin/dashboard.controller");
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute } = require('../../middlewares/http-route.middleware');

router.get('/', requirePermission('dashboard-view'), asyncRoute(dashboardController.dashboard));

router.post('/revenue-chart', requirePermission('dashboard-view'), asyncRoute(dashboardController.revenueChartPost));

module.exports = router;
