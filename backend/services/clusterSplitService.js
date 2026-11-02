
const repository = require("../repositories/clusterSplitRepository");
const { evaluateClusterSimilarity } = require("./clusterMergeService");
const { cosineSimilarity } = require("../ai/embedding");

const DEFAULT_SPLIT_THRESHOLD = 70;
const MAX_ARTICLES_PER_CLUSTER = 100;

function parseEmbedding(value) {
    let vector = value;

    if (typeof vector === "string") {
        try {
            vector = JSON.parse(vector);
        } catch {
            return null;
        }
    }

    if (
        !Array.isArray(vector) ||
        vector.length === 0 ||
        !vector.every(Number.isFinite)
    ) {
        return null;
    }

    return vector;
}

function normalizeIssueType(value) {
    const type = String(value || "etc").trim();

    return [
        "safety",
        "accident",
        "facility",
        "service_disruption"
    ].includes(type) ? "incident" : (type || "etc");
}

function parseTimestamp(value) {
    if (!value) return null;

    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

// 분할된 그룹의 centroid와 대표기사를 재계산합니다.
function getMetadata(groupArticles, sourceCluster) {
    const vectors = groupArticles
        .map(article => parseEmbedding(article.article_embedding))
        .filter(Boolean);

    if (!vectors.length) return null;

    const dimension = vectors[0].length;
    const validVectors = vectors.filter(
        vector => vector.length === dimension
    );

    const centroid = Array(dimension).fill(0);

    for (const vector of validVectors) {
        for (let i = 0; i < dimension; i++) {
            centroid[i] += vector[i];
        }
    }

    for (let i = 0; i < dimension; i++) {
        centroid[i] /= validVectors.length;
    }

    const bestArticle = groupArticles
        .filter(article => {
            const vector = parseEmbedding(article.article_embedding);
            return vector && vector.length === dimension;
        })
        .map(article => ({
            article,
            similarity: cosineSimilarity(
                centroid,
                parseEmbedding(article.article_embedding)
            )
        }))
        .sort(
            (a, b) =>
                b.similarity - a.similarity ||
                a.article.article_id - b.article.article_id
        )[0].article;

    const timestamps = groupArticles
        .map(article =>
            parseTimestamp(article.collected_at) ??
            parseTimestamp(article.analyzed_at)
        )
        .filter(time => time !== null);

    const fallbackStart =
        parseTimestamp(sourceCluster.first_detected) ?? Date.now();

    const fallbackEnd =
        parseTimestamp(sourceCluster.last_detected) ?? fallbackStart;

    return {
        articleIds: groupArticles
            .map(article => article.article_id)
            .sort((a, b) => a - b),

        representativeArticleId: bestArticle.article_id,
        representativeTitle: bestArticle.title,

        issueType: normalizeIssueType(
            bestArticle.issue_type || sourceCluster.issue_type
        ),

        centroid,

        firstDetected: new Date(
            timestamps.length ? Math.min(...timestamps) : fallbackStart
        ),

        lastDetected: new Date(
            timestamps.length ? Math.max(...timestamps) : fallbackEnd
        ),

        maxRiskScore: Math.max(
            0,
            ...groupArticles.map(
                article => Number(article.risk_score) || 0
            )
        )
    };
}

/*
// Complete-link 방식으로 기사들을 그룹화합니다.
// 두 그룹의 모든 기사 쌍이 기준을 통과해야 합칩니다.
function completeLinkGroups(articles, threshold) {
    const pairScores = Array.from(
        { length: articles.length },
        () => Array(articles.length).fill(null)
    );

    for (let i = 0; i < articles.length; i++) {
        for (let j = i + 1; j < articles.length; j++) {
            const result = evaluateClusterSimilarity(
                {
                    ...articles[i],
                    centroid_embedding: articles[i].article_embedding
                },
                {
                    ...articles[j],
                    centroid_embedding: articles[j].article_embedding
                }
            );

            pairScores[i][j] = pairScores[j][i] =
                result.mergeable ? result.score : null;
        }
    }

    const groups = articles.map((_, index) => [index]);

    while (groups.length > 1) {
        let best = null;

        for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
                let minimum = Infinity;
                let total = 0;
                let count = 0;
                let compatible = true;

                for (const a of groups[i]) {
                    for (const b of groups[j]) {
                        const score = pairScores[a][b];

                        if (score === null || score < threshold) {
                            compatible = false;
                            break;
                        }

                        minimum = Math.min(minimum, score);
                        total += score;
                        count++;
                    }

                    if (!compatible) break;
                }

                if (!compatible) continue;

                const average = total / count;

                if (
                    !best ||
                    minimum > best.minimum ||
                    (
                        minimum === best.minimum &&
                        average > best.average
                    )
                ) {
                    best = { i, j, minimum, average };
                }
            }
        }

        if (!best) break;

        groups[best.i].push(...groups[best.j]);
        groups[best.i].sort((a, b) => a - b);
        groups.splice(best.j, 1);
    }

    return groups.map(
        indices => indices.map(index => articles[index])
    );
}
*/

// DBSCAN 방식으로 기사들을 그룹화합니다.
function dbscanGroups(articles, threshold) {
    const count = articles.length;
    if (!count) return [];

    // 자기 자신을 포함한 최소 이웃 수입니다.
    const minSamples = count < 5 ? 2 : 3;

    const neighbors = Array.from(
        { length: count },
        (_, i) => [i]
    );

    // 기존 유사도 계산 방식과 강제 불일치 조건을 재사용합니다.
    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            const result = evaluateClusterSimilarity(
                {
                    ...articles[i],
                    centroid_embedding:
                        articles[i].article_embedding
                },
                {
                    ...articles[j],
                    centroid_embedding:
                        articles[j].article_embedding
                }
            );

            if (
                result.mergeable &&
                result.score >= threshold
            ) {
                neighbors[i].push(j);
                neighbors[j].push(i);
            }
        }
    }

    // -1은 미방문, -2는 이상치를 의미합니다.
    const labels = Array(count).fill(-1);

    const core = neighbors.map(
        items => items.length >= minSamples
    );

    let clusterNumber = 0;

    for (let i = 0; i < count; i++) {
        if (labels[i] !== -1) continue;

        if (!core[i]) {
            labels[i] = -2;
            continue;
        }

        labels[i] = clusterNumber;

        const queue = [i];

        for (
            let head = 0;
            head < queue.length;
            head++
        ) {
            const current = queue[head];

            // 경계점에서는 군집을 확장하지 않습니다.
            if (!core[current]) continue;

            for (const neighbor of neighbors[current]) {
                if (labels[neighbor] === -2) {
                    // 이상치를 경계점으로 편입합니다.
                    labels[neighbor] = clusterNumber;
                } else if (labels[neighbor] === -1) {
                    labels[neighbor] = clusterNumber;

                    if (core[neighbor]) {
                        queue.push(neighbor);
                    }
                }
            }
        }

        clusterNumber++;
    }

    const groups = Array.from(
        { length: clusterNumber },
        () => []
    );

    for (let i = 0; i < count; i++) {
        if (labels[i] >= 0) {
            groups[labels[i]].push(articles[i]);
        } else {
            // 이상치는 개별 클러스터로 분리합니다.
            groups.push([articles[i]]);
        }
    }

    return groups;
}

// 클러스터 분할 계획을 작성합니다.
function buildSplitPlan(
    snapshot,
    threshold = DEFAULT_SPLIT_THRESHOLD
) {
    if (!snapshot) {
        return {
            status: "not_found",
            reason: "cluster_not_found"
        };
    }

    const { cluster, articles } = snapshot;

    if (cluster.cluster_status !== "active") {
        return {
            status: "skipped",
            reason: "inactive_cluster",
            clusterId: cluster.cluster_id
        };
    }

    if (articles.length < 2) {
        return {
            status: "unchanged",
            reason: "fewer_than_two_articles",
            clusterId: cluster.cluster_id
        };
    }

    if (articles.length > MAX_ARTICLES_PER_CLUSTER) {
        return {
            status: "skipped",
            reason: "too_many_articles",
            clusterId: cluster.cluster_id
        };
    }

    // 임베딩 차원이 다른 이전 데이터를 구분합니다.
    const dimensionCounts = new Map();

    for (const article of articles) {
        const vector = parseEmbedding(article.article_embedding);

        if (vector) {
            dimensionCounts.set(
                vector.length,
                (dimensionCounts.get(vector.length) || 0) + 1
            );
        }
    }

    const preferredDimension = [...dimensionCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const valid = [];
    const unknown = [];

    for (const article of articles) {
        const vector = parseEmbedding(article.article_embedding);

        if (!vector || vector.length !== preferredDimension) {
            unknown.push(article);
        } else {
            valid.push(article);
        }
    }

    if (valid.length < 2) {
        return {
            status: "skipped",
            reason: "insufficient_embeddings",
            clusterId: cluster.cluster_id
        };
    }

    // 기존 Complete-link 방식입니다.
    // const separated = completeLinkGroups(valid, threshold);

    // 변경된 DBSCAN 방식입니다.
    const separated = dbscanGroups(valid, threshold);

    if (separated.length === 1) {
        return {
            status: "unchanged",
            reason: "same_event",
            clusterId: cluster.cluster_id
        };
    }

    // 원래 대표기사가 속한 그룹에 기존 ID를 유지합니다.
    let retainedIndex = separated.findIndex(group =>
        group.some(
            article =>
                article.article_id === cluster.representative_article_id
        )
    );

    if (retainedIndex === -1) {
        retainedIndex = separated.reduce(
            (best, group, index) =>
                group.length > separated[best].length ? index : best,
            0
        );
    }

    // 임베딩이 없는 기사는 원본 그룹에 남깁니다.
    separated[retainedIndex].push(...unknown);

    const groups = separated.map(
        group => getMetadata(group, cluster)
    );

    return {
        status: "would_split",
        clusterId: cluster.cluster_id,
        retainedIndex,
        groups,
        unknownArticleIds: unknown.map(article => article.article_id)
    };
}

// API 응답에 필요한 정보만 반환합니다.
function describePlan(plan) {
    const { groups, retainedIndex, ...rest } = plan;

    if (!groups) return rest;

    return {
        ...rest,
        groupCount: groups.length,

        groups: groups.map((group, index) => ({
            retainsOriginal: index === retainedIndex,
            articleIds: group.articleIds,
            representativeArticleId: group.representativeArticleId,
            representativeTitle: group.representativeTitle,
            issueType: group.issueType,
            maxRiskScore: group.maxRiskScore
        }))
    };
}

function validateOptions({
    clusterId,
    date,
    threshold,
    dryRun
} = {}) {
    if (
        clusterId !== null &&
        clusterId !== undefined &&
        clusterId !== ""
    ) {
        if (
            !Number.isSafeInteger(Number(clusterId)) ||
            Number(clusterId) < 1
        ) {
            throw new Error("cluster_id는 양의 정수여야 합니다.");
        }
    }

    if (date !== undefined && date !== null && date !== "") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
        }
    }

    if (
        threshold !== undefined &&
        threshold !== null &&
        threshold !== ""
    ) {
        if (
            !Number.isFinite(Number(threshold)) ||
            Number(threshold) < 0 ||
            Number(threshold) > 100
        ) {
            throw new Error("threshold는 0~100의 숫자여야 합니다.");
        }
    }

    if (dryRun !== undefined && typeof dryRun !== "boolean") {
        throw new Error("dry_run은 true 또는 false여야 합니다.");
    }

    return {
        clusterId:
            clusterId === undefined ||
            clusterId === null ||
            clusterId === ""
                ? null
                : Number(clusterId),

        date: date || null,

        threshold:
            threshold === undefined ||
            threshold === null ||
            threshold === ""
                ? DEFAULT_SPLIT_THRESHOLD
                : Number(threshold),

        dryRun: dryRun === undefined ? true : dryRun
    };
}

// 단일 클러스터를 검사하거나 분할합니다.
async function splitOneCluster(clusterId, threshold, dryRun) {
    if (dryRun) {
        const plan = buildSplitPlan(
            await repository.getSnapshot(clusterId),
            threshold
        );

        return describePlan(plan);
    }

    return repository.withLockedSnapshot(
        clusterId,
        async (connection, snapshot) => {
            const plan = buildSplitPlan(snapshot, threshold);

            if (plan.status !== "would_split") {
                return describePlan(plan);
            }

            const applied = await repository.applySplit(
                connection,
                snapshot.cluster,
                plan.groups,
                plan.retainedIndex
            );

            return {
                ...describePlan(plan),
                status: "split",
                ...applied
            };
        }
    );
}

// API에서 호출하는 진입점입니다.
async function splitClusters({
    cluster_id,
    date,
    threshold,
    dry_run
} = {}) {
    const options = validateOptions({
        clusterId: cluster_id,
        date,
        threshold,
        dryRun: dry_run
    });

    const candidateIds = options.clusterId === null
        ? await repository.findSplitCandidateIds(options.date)
        : [options.clusterId];

    const results = [];

    for (const clusterId of candidateIds) {
        results.push(
            await splitOneCluster(
                clusterId,
                options.threshold,
                options.dryRun
            )
        );
    }

    return {
        date: options.date ||
            (options.clusterId === null ? "today" : null),

        dryRun: options.dryRun,
        threshold: options.threshold,
        checkedClusterCount: candidateIds.length,

        splitCount: results.filter(
            result => ["split", "would_split"].includes(result.status)
        ).length,

        results
    };
}

module.exports = {
    splitClusters,
    buildSplitPlan,

    // 기존 Complete-link 방식입니다.
    // completeLinkGroups,

    // 변경된 DBSCAN 방식입니다.
    dbscanGroups,

    validateOptions
};
