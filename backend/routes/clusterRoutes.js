const express = require("express");

const {
    getClusterList,
    getClusterArticles
} = require("../controllers/clusterController");

const {
    mergeClusters
} = require("../controllers/clusterMergeController");

const {
    linkClusters,
    getLinks
} = require("../controllers/clusterLinkController");

const {
    splitClustersController
} = require("../controllers/clusterSplitController");

const impactController = require("../controllers/impactController");

const router = express.Router();

router.get("/", getClusterList);

router.post("/split", splitClustersController);

router.post("/merge", mergeClusters);

router.post("/link", linkClusters);

router.get("/:cluster_id/impact", impactController.getClusterImpact);
router.post("/:cluster_id/impact/snapshot", impactController.recalculateClusterImpact);
router.post("/:cluster_id/impact/confirm", impactController.confirmClusterImpact);
router.get("/:cluster_id/links", getLinks);

router.get("/:cluster_id/articles", getClusterArticles);

module.exports = router;