const router = require('express').Router();

const tourController = require("../../controllers/admin/tour.controller");

const tourValidate = require("../../validates/admin/tour.validate");
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute, requireObjectId } = require('../../middlewares/http-route.middleware');
const { upload, storeTourImages } = require('../../middlewares/admin/image-upload.middleware');

router.get('/list', requirePermission('tour-view'), asyncRoute(tourController.list));

router.get('/create', requirePermission('tour-create'), asyncRoute(tourController.create));

router.post(
  '/create',
  requirePermission('tour-create'),
  upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]),
  tourValidate.createPost,
  asyncRoute(storeTourImages),
  asyncRoute(tourController.createPost)
)

router.get('/trash', requirePermission('tour-trash'), asyncRoute(tourController.trash));

router.get('/edit/:id', requirePermission('tour-edit'), requireObjectId, asyncRoute(tourController.edit));

router.patch(
  '/edit/:id',
  requirePermission('tour-edit'),
  requireObjectId,
  upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]), 
  tourValidate.createPost,
  asyncRoute(tourController.prepareTourImages),
  asyncRoute(storeTourImages),
  asyncRoute(tourController.editPatch)
)

router.patch('/delete/:id', requirePermission('tour-delete'), requireObjectId, asyncRoute(tourController.deletePatch));

router.patch('/undo/:id', requirePermission('tour-trash'), requireObjectId, asyncRoute(tourController.undoPatch));

router.patch('/delete-destroy/:id', requirePermission('tour-trash'), requireObjectId, asyncRoute(tourController.deleteDestroyPatch));

router.patch('/trash/change-multi', requirePermission('tour-trash'), asyncRoute(tourController.trashChangeMultiPatch));

module.exports = router;
