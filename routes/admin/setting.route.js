const router = require('express').Router();

const settingController = require("../../controllers/admin/setting.controller");

const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute, requireObjectId } = require('../../middlewares/http-route.middleware');
const { upload, storeImages } = require('../../middlewares/admin/image-upload.middleware');

router.get('/list', requirePermission(['website-view', 'account-admin-view', 'role-view']), asyncRoute(settingController.list))

router.get('/website-info', requirePermission('website-view'), asyncRoute(settingController.websiteInfo))

router.patch(
  '/website-info',
  requirePermission('website-edit'),
  upload.fields(
    [
      { name: 'logo', maxCount: 1 },
      { name: 'favicon', maxCount: 1 }
    ]
  ),
  asyncRoute(storeImages),
  asyncRoute(settingController.websiteInfoPatch)
)

router.get('/account-admin/list', requirePermission('account-admin-view'), asyncRoute(settingController.accountAdminList))

router.get('/account-admin/create', requirePermission('account-admin-create'), asyncRoute(settingController.accountAdminCreate))

router.post(
  '/account-admin/create',
  requirePermission('account-admin-create'),
  upload.single("avatar"), 
  asyncRoute(storeImages),
  asyncRoute(settingController.accountAdminCreatePost)
)

router.get('/account-admin/edit/:id', requirePermission('account-admin-edit'), requireObjectId, asyncRoute(settingController.accountAdminEdit))

router.patch(
  '/account-admin/edit/:id',
  requirePermission('account-admin-edit'),
  requireObjectId,
  upload.single("avatar"), 
  asyncRoute(storeImages),
  asyncRoute(settingController.accountAdminEditPatch)
)

router.get('/role/list', requirePermission('role-view'), asyncRoute(settingController.roleList))

router.get('/role/create', requirePermission('role-create'), asyncRoute(settingController.roleCreate))

router.post('/role/create', requirePermission('role-create'), asyncRoute(settingController.roleCreatePost))

router.get('/role/edit/:id', requirePermission('role-edit'), requireObjectId, asyncRoute(settingController.roleEdit))

router.patch('/role/edit/:id', requirePermission('role-edit'), requireObjectId, asyncRoute(settingController.roleEditPatch))

module.exports = router;
