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


router.get(
    "/:cluster_id/articles",
    getClusterArticles
);


module.exports =
    router;