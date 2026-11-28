const express = require('express');
const router = express.Router();

const orderController = require("../../controllers/admin/order.controller");
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute, requireObjectId } = require('../../middlewares/http-route.middleware');

router.get('/list', requirePermission('order-view'), asyncRoute(orderController.list));
router.get('/trash', requirePermission('order-trash'), asyncRoute(orderController.trash));

router.get('/edit/:id', requirePermission('order-view'), requireObjectId, asyncRoute(orderController.edit));

router.post('/edit/:id', requirePermission('order-view'), requirePermission('order-edit'), requireObjectId,
  express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 12 }), asyncRoute(orderController.editPost));
router.patch('/edit/:id', requirePermission('order-edit'), requireObjectId, asyncRoute(orderController.editPatch));

router.patch('/delete/:id', requirePermission('order-delete'), requireObjectId, asyncRoute(orderController.deletePatch));
router.patch('/undo/:id', requirePermission('order-trash'), requirePermission('order-edit'), requireObjectId,
  asyncRoute(orderController.undoPatch));
router.patch('/trash/change-multi', requirePermission('order-trash'), requirePermission('order-edit'),
  asyncRoute(orderController.trashChangeMultiPatch));

module.exports = router;
