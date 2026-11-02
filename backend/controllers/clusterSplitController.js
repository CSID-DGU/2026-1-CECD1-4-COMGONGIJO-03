const { splitClusters } = require("../services/clusterSplitService");

async function splitClustersController(req, res) {
    try {
        const result = await splitClusters(req.body || {});

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error("클러스터 분할 오류:", error);

        const isInputError =
            /^(cluster_id|date|threshold|dry_run)/.test(error.message);

        return res.status(isInputError ? 400 : 500).json({
            success: false,
            message: "클러스터 분할 실패",
            error: error.message
        });
    }
}

module.exports = { splitClustersController };