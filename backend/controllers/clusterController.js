const {
    getClusters,
    getClusterWithArticles
} = require("../services/clusterService");

async function getClusterList(req, res) {
    try {
        const clusters = await getClusters();
        return res.json({
            success: true,
            count: clusters.length,
            clusters
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "클러스터 조회 실패"
        });
    }
}

async function getClusterArticles(req, res) {
    try {
        const { cluster_id } = req.params;
        const result = await getClusterWithArticles(cluster_id);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "해당 클러스터를 찾을 수 없습니다."
            });
        }

        return res.json({
            success: true,
            cluster: result.cluster,
            count: result.articles.length,
            articles: result.articles
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "클러스터 기사 목록 조회 실패"
        });
    }
}

module.exports = {
    getClusterList,
    getClusterArticles
};
