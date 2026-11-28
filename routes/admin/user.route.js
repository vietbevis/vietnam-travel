const router = require('express').Router();

const userController = require("../../controllers/admin/user.controller");
const { customerListPermissions } = require('../../config/permission');
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute } = require('../../middlewares/http-route.middleware');

router.get('/list', requirePermission(customerListPermissions, 'Bạn không có quyền sử dụng tính năng này!'), asyncRoute(userController.list));
router.get('/detail/:id', requirePermission('customer-view'), asyncRoute(userController.detail));

module.exports = router;
