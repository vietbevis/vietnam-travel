const router = require('express').Router();

const orderController = require("../../controllers/admin/order.controller");
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute, requireObjectId } = require('../../middlewares/http-route.middleware');

router.get('/list', requirePermission('order-view'), asyncRoute(orderController.list));

router.get('/edit/:id', requirePermission('order-view'), requireObjectId, asyncRoute(orderController.edit));

router.patch('/edit/:id', requirePermission('order-edit'), requireObjectId, asyncRoute(orderController.editPatch));

router.patch('/delete/:id', requirePermission('order-delete'), requireObjectId, asyncRoute(orderController.deletePatch));

module.exports = router;
