const {
    linkClustersByDate,
    getClusterLinks
} = require(
    "../services/clusterLinkService"
);

async function linkClusters(
    req,
    res
) {
    try {
        const result =
            await linkClustersByDate({
                threshold:
                    req.body?.threshold,

                date:
                    req.body?.date,

                lookbackDays:
                    req.body?.lookbackDays
            });

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(
            "클러스터 연결 오류:",
            error
        );

        return res
            .status(500)
            .json({
                success: false,

                message:
                    "클러스터 연결 실패",

                error:
                    error.message
            });
    }
}

async function getLinks(
    req,
    res
) {
    try {
        const links =
            await getClusterLinks(
                req.params.cluster_id
            );

        return res.json({
            success: true,
            count:
                links.length,
            links
        });

    } catch (error) {
        console.error(
            "클러스터 연결 조회 오류:",
            error
        );

        return res
            .status(500)
            .json({
                success: false,

                message:
                    "클러스터 연결 조회 실패",

                error:
                    error.message
            });
    }
}

module.exports = {
    linkClusters,
    getLinks
};