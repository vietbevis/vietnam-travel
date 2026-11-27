const router = require('express').Router();
const uploadController = require("../../controllers/admin/upload.controller");
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute } = require('../../middlewares/http-route.middleware');
const { upload, storeImages } = require('../../middlewares/admin/image-upload.middleware');

router.post(
  '/image',
  requirePermission(['tour-create', 'tour-edit']),
  upload.single('file'), 
  asyncRoute(storeImages),
  asyncRoute(uploadController.imagePost)
)

module.exports = router;
