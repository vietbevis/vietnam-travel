const router = require('express').Router();
const multer  = require('multer');

const profileController = require("../../controllers/admin/profile.controller");

const cloudinaryHelper = require("../../helpers/cloudinary.helper");

const upload = multer({ storage: cloudinaryHelper.storage });

router.get('/edit', profileController.edit)

router.patch('/edit', upload.single('avatar'), profileController.editPatch)

router.get('/change-password', profileController.changePassword)

module.exports = router;