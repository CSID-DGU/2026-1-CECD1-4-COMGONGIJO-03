const clusterLinkRepository =
    require(
        "../repositories/clusterLinkRepository"
    );

const {
    evaluateMatch,
    getCandidateEmbedding
} = require("./clusterSimilarityService");

const DEFAULT_LINK_THRESHOLD = 55;
const LINKED_MERGE_THRESHOLD = 50;
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

            const evaluation = evaluateMatch(
                clusterA,
                await getCandidateEmbedding(clusterA),
                clusterB,
                await getCandidateEmbedding(clusterB)
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

async function findPrecreationMatch({
    analysis,
    articleEmbedding,
    clusterDate,
    connection
}) {
    const previousClusters = await clusterLinkRepository
        .findYesterdayCandidates(clusterDate, connection);

    const previousLinks = [];

    // 전날 클러스터와 55점 기준 연결 판정
    for (const previous of previousClusters) {
        const reference = await getCandidateEmbedding(previous);

        const evaluation = evaluateMatch(
            analysis,
            articleEmbedding,
            previous,
            reference
        );

        if (
            !evaluation.mergeable ||
            evaluation.score < DEFAULT_LINK_THRESHOLD
        ) {
            continue;
        }

        previousLinks.push({
            fromClusterId: previous.cluster_id,
            score: evaluation.score
        });
    }

    if (previousLinks.length === 0) {
        return {
            previousLinks,
            todayCluster: null,
            mergeScore: null
        };
    }

    // 연결된 전날 클러스터가 공유되는 오늘 클러스터 탐색
    const todayCandidates = await clusterLinkRepository
        .findTodayLinkedCandidates(
            previousLinks.map(item => item.fromClusterId),
            clusterDate,
            connection
        );

    let todayCluster = null;
    let mergeScore = null;

    // 50점 기준 특수 병합 판정
    for (const cluster of todayCandidates) {
        const reference = await getCandidateEmbedding(cluster);

        const evaluation = evaluateMatch(
            analysis,
            articleEmbedding,
            cluster,
            reference
        );

        if (
            !evaluation.mergeable ||
            evaluation.score < LINKED_MERGE_THRESHOLD
        ) {
            continue;
        }

        if (
            mergeScore === null ||
            evaluation.score > mergeScore
        ) {
            todayCluster = cluster;
            mergeScore = evaluation.score;
        }
    }

    return {
        previousLinks,
        todayCluster,
        mergeScore
    };
}

async function persistPreviousLinks(
    previousLinks,
    toClusterId,
    connection
) {
    for (const previous of previousLinks) {
        if (
            Number(previous.fromClusterId) ===
            Number(toClusterId)
        ) {
            continue;
        }

        await clusterLinkRepository.upsertClusterLink({
            fromClusterId: previous.fromClusterId,
            toClusterId,
            similarityScore: Number(
                previous.score.toFixed(2)
            ),
            connection
        });
    }
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
    findPrecreationMatch,
    persistPreviousLinks,
    getClusterLinks
};