const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const homeController = require("../../controllers/client/home.controller");

router.get('/', asyncRoute(homeController.home))

module.exports = router;