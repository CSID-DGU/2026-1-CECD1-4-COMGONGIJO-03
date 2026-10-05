const express = require("express");
const router = express.Router();

const spamController = require("../controllers/spamController");

router.get("/", spamController.getSpamArticles);

module.exports = router;