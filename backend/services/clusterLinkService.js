const clusterLinkRepository =
    require(
        "../repositories/clusterLinkRepository"
    );

const {
    evaluateClusterSimilarity
} = require(
    "./clusterMergeService"
);

const DEFAULT_LINK_THRESHOLD = 80;
const DEFAULT_LOOKBACK_DAYS = 2;

function normalizeRequestedDate(
    date
) {
    if (
        date === undefined ||
        date === null ||
        date === ""
    ) {
        return null;
    }

    const value =
        String(date).trim();

    if (
        !/^\d{4}-\d{2}-\d{2}$/
            .test(value)
    ) {
        throw new Error(
            "date는 YYYY-MM-DD 형식이어야 합니다."
        );
    }

    return value;
}

function clampInteger(
    value,
    fallback,
    min,
    max
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return fallback;
    }

    return Math.max(
        min,
        Math.min(
            max,
            Math.floor(number)
        )
    );
}

async function linkClustersByDate({
    threshold =
        DEFAULT_LINK_THRESHOLD,

    date = null,

    lookbackDays =
        DEFAULT_LOOKBACK_DAYS
} = {}) {
    const safeThreshold =
        Number.isFinite(
            Number(threshold)
        )
            ? Math.max(
                0,
                Math.min(
                    100,
                    Number(threshold)
                )
            )
            : DEFAULT_LINK_THRESHOLD;

    const safeDate =
        normalizeRequestedDate(
            date
        );

    const safeLookbackDays =
        clampInteger(
            lookbackDays,
            DEFAULT_LOOKBACK_DAYS,
            1,
            30
        );

    const candidates =
        await clusterLinkRepository
            .findLinkCandidates({
                date:
                    safeDate,

                lookbackDays:
                    safeLookbackDays
            });

    const links = [];

    for (
        let i = 0;
        i < candidates.length;
        i++
    ) {
        for (
            let j = i + 1;
            j < candidates.length;
            j++
        ) {
            const clusterA =
                candidates[i];

            const clusterB =
                candidates[j];

            if (
                !clusterA.cluster_date ||
                !clusterB.cluster_date
            ) {
                continue;
            }

            if (
                clusterA.cluster_date ===
                clusterB.cluster_date
            ) {
                continue;
            }

            const evaluation =
                evaluateClusterSimilarity(
                    clusterA,
                    clusterB
                );

            if (
                !evaluation.mergeable
            ) {
                continue;
            }

            if (
                evaluation.score <
                safeThreshold
            ) {
                continue;
            }

            const clusterAIsEarlier =
                clusterA.cluster_date <
                clusterB.cluster_date;

            const earlier =
                clusterAIsEarlier
                    ? clusterA
                    : clusterB;

            const later =
                clusterAIsEarlier
                    ? clusterB
                    : clusterA;

            const similarityScore =
                Number(
                    evaluation.score
                        .toFixed(2)
                );

            await clusterLinkRepository
                .upsertClusterLink({
                    fromClusterId:
                        earlier.cluster_id,

                    toClusterId:
                        later.cluster_id,

                    similarityScore
                });

            links.push({
                fromClusterId:
                    earlier.cluster_id,

                toClusterId:
                    later.cluster_id,

                score:
                    similarityScore
            });
        }
    }

    return {
        date:
            safeDate ||
            "today",

        lookbackDays:
            safeLookbackDays,

        checkedClusterCount:
            candidates.length,

        linkCount:
            links.length,

        threshold:
            safeThreshold,

        links
    };
}

async function getClusterLinks(
    clusterId
) {
    return (
        clusterLinkRepository
            .findLinksByClusterId(
                clusterId
            )
    );
}

module.exports = {
    linkClustersByDate,
    getClusterLinks
};