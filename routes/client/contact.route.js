const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const contactController = require("../../controllers/client/contact.controller");

router.post('/create', asyncRoute(contactController.createPost))

module.exports = router;