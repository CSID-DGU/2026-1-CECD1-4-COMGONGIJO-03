const express = require("express");
const {
    getClusterList,
    getClusterArticles
} = require("../controllers/clusterController");

const router = express.Router();

router.get("/", getClusterList);
router.get("/:cluster_id/articles", getClusterArticles);

module.exports = router;
