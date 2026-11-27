const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const tourController = require("../../controllers/client/tour.controller");

router.get('/detail/:slug', asyncRoute(tourController.detail))

module.exports = router;