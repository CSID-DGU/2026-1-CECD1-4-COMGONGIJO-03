const {
    mergeClustersByDate
} = require(
    "../services/clusterMergeService"
);


async function mergeClusters(
    req,
    res
) {
    try {
        const result =
            await mergeClustersByDate({
                threshold:
                    req.body?.threshold,

                date:
                    req.body?.date
            });


        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error(
            "클러스터 병합 오류:",
            error
        );


        return res
            .status(500)
            .json({
                success: false,

                message:
                    "클러스터 병합 실패",

                error:
                    error.message
            });
    }
}


module.exports = {
    mergeClusters
};