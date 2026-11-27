const router = require('express').Router();
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { asyncRoute } = require('../../middlewares/http-route.middleware');

const contactController = require("../../controllers/admin/contact.controller");

router.get('/list', requirePermission('contact-view'), asyncRoute(contactController.list))

module.exports = router;
