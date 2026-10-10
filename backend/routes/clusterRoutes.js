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


// 같은 날짜 내부의 과분할 클러스터를 병합합니다.
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