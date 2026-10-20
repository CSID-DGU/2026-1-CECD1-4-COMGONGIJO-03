const express =
    require("express");

const {
    getClusterList,
    getClusterArticles
} = require(
    "../controllers/clusterController"
);

const {
    mergeClusters
} = require(
    "../controllers/clusterMergeController"
);

const {
    linkClusters,
    getLinks
} = require(
    "../controllers/clusterLinkController"
);

const router =
    express.Router();

router.get(
    "/",
    getClusterList
);

router.post(
    "/merge",
    mergeClusters
);

router.post(
    "/link",
    linkClusters
);

router.get(
    "/:cluster_id/links",
    getLinks
);

router.get(
    "/:cluster_id/articles",
    getClusterArticles
);

module.exports =
    router;