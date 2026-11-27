const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const cartController = require("../../controllers/client/cart.controller");

router.get('/', asyncRoute(cartController.cart))

router.post('/detail', asyncRoute(cartController.detail))

module.exports = router;