const router = require('express').Router();

const profileController = require("../../controllers/admin/profile.controller");

const { asyncRoute } = require('../../middlewares/http-route.middleware');
const { cardInput } = require('../../controllers/admin/account.controller');
const { upload, storeImages } = require('../../middlewares/admin/image-upload.middleware');

router.get('/edit', profileController.edit)

router.patch('/edit', upload.single('avatar'), asyncRoute(storeImages), asyncRoute(profileController.editPatch))

router.get('/change-password', profileController.changePassword)

router.patch('/change-password', cardInput(), asyncRoute(profileController.changePasswordPatch))

module.exports = router;
