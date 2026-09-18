const clusterRepository = require("../repositories/clusterRepository");
const { getEmbedding, cosineSimilarity } = require("../ai/embedding");

const embeddingCache = new Map();
const CLUSTER_MATCH_THRESHOLD = 70;

async function getCachedEmbedding(text) {
    if (!text) return null;

    if (embeddingCache.has(text)) {
        return embeddingCache.get(text);
    }

    const embedding = await getEmbedding(text);
    embeddingCache.set(text, embedding);

    return embedding;
}

function safeParseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// DB에 문자열로 저장된 embedding을 다시 배열로 변환합니다.
function safeParseEmbedding(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);

        return Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}

function getTextSimilarity(a, b) {
    const textA = normalizeText(a);
    const textB = normalizeText(b);

    if (!textA || !textB) return 0;
    if (textA === textB) return 1;

    if (
        textA.includes(textB) ||
        textB.includes(textA)
    ) {
        return 0.8;
    }

    const getBigrams = str => {
        const bigrams = new Set();

        for (let i = 0; i < str.length - 1; i++) {
            bigrams.add(str.substring(i, i + 2));
        }

        return bigrams;
    };

    const setA = getBigrams(textA);
    const setB = getBigrams(textB);

    if (setA.size === 0 || setB.size === 0) {
        return 0;
    }

    let intersection = 0;

    for (const token of setA) {
        if (setB.has(token)) {
            intersection++;
        }
    }

    return intersection / Math.max(setA.size, setB.size);
}

// 두 기사의 핵심 엔티티가 얼마나 겹치는지 계산합니다.
function getEntityOverlapScore(a, b) {
    const setA = new Set(
        (a || []).map(normalizeText).filter(Boolean)
    );

    const setB = new Set(
        (b || []).map(normalizeText).filter(Boolean)
    );

    if (setA.size === 0 || setB.size === 0) {
        return 0;
    }

    let intersection = 0;

    for (const value of setA) {
        if (setB.has(value)) {
            intersection++;
        }
    }

    const union = new Set([
        ...setA,
        ...setB
    ]).size;

    return intersection / union;
}

function normalizeIssueTypeForCluster(issueType) {
    const type = String(issueType || "etc").trim();

    if (
        [
            "safety",
            "accident",
            "facility",
            "service_disruption"
        ].includes(type)
    ) {
        return "incident";
    }

    return type || "etc";
}

// 키워드 10개 대신 제목 + 요약문 전체를 BGE-M3 입력으로 사용합니다.
function buildEmbeddingText(title, summary) {
    return [
        title ? `제목: ${title}` : "",
        summary ? `요약: ${summary}` : ""
    ]
        .filter(Boolean)
        .join("\n");
}

// cluster_key는 동일사건 판정용이 아니라 DB 식별용으로만 사용합니다.
function buildClusterKey(
    analysis,
    title,
    clusterIssueType,
    articleId
) {
    const eventName =
        normalizeText(
            analysis.event_name || title
        ).slice(0, 100) || "no_event";

    return `${clusterIssueType}-${eventName}-${articleId}`;
}

function getDateDifferenceDays(a, b) {
    if (!a || !b) return null;

    const dateA = new Date(a);
    const dateB = new Date(b);

    if (
        Number.isNaN(dateA.getTime()) ||
        Number.isNaN(dateB.getTime())
    ) {
        return null;
    }

    return Math.abs(
        dateA.getTime() - dateB.getTime()
    ) / (1000 * 60 * 60 * 24);
}

// 기존 centroid에 새 기사 embedding을 누적 평균으로 반영합니다.
function calculateUpdatedCentroid(
    oldCentroid,
    newEmbedding,
    oldArticleCount
) {
    if (!newEmbedding) {
        return oldCentroid;
    }

    if (
        !oldCentroid ||
        oldCentroid.length !== newEmbedding.length
    ) {
        return newEmbedding;
    }

    const count = Number(oldArticleCount) || 0;

    return oldCentroid.map(
        (value, index) =>
            (
                value * count +
                newEmbedding[index]
            ) /
            (count + 1)
    );
}

// 새 기사와 각 클러스터 centroid를 비교하고
// 장소/날짜/엔티티 등 핵심정보로 동일사건 여부를 보정합니다.
async function findBestCluster(
    analysis,
    title,
    newEmbedding
) {
    const candidateClusters =
        await clusterRepository.findRecentCandidates();

    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of candidateClusters) {
        let clusterEmbedding =
            safeParseEmbedding(
                cluster.centroid_embedding
            );

        // 기존 데이터 등 centroid가 없는 경우를 위한 임시 fallback입니다.
        if (!clusterEmbedding) {
            clusterEmbedding =
                safeParseEmbedding(
                    cluster.article_embedding
                );
        }

        if (
            !clusterEmbedding &&
            cluster.representative_title
        ) {
            clusterEmbedding =
                await getCachedEmbedding(
                    cluster.representative_title
                );
        }

        if (!newEmbedding || !clusterEmbedding) {
            continue;
        }

        const embeddingSimilarity =
            Math.max(
                0,
                cosineSimilarity(
                    newEmbedding,
                    clusterEmbedding
                )
            );

        let weightedScore =
            embeddingSimilarity * 60;

        let totalWeight = 60;

        // 사건명 비교
        if (
            analysis.event_name &&
            cluster.event_name
        ) {
            const eventNameSimilarity =
                getTextSimilarity(
                    analysis.event_name,
                    cluster.event_name
                );

            weightedScore +=
                eventNameSimilarity * 10;

            totalWeight += 10;
        }

        // 장소 비교
        let locationSimilarity = null;

        if (
            analysis.event_location &&
            cluster.event_location
        ) {
            locationSimilarity =
                getTextSimilarity(
                    analysis.event_location,
                    cluster.event_location
                );

            weightedScore +=
                locationSimilarity * 10;

            totalWeight += 10;
        }

        // 핵심 엔티티 비교
        const newEntities =
            Array.isArray(analysis.event_entities)
                ? analysis.event_entities
                : [];

        const oldEntities =
            safeParseJsonArray(
                cluster.event_entities
            );

        if (
            newEntities.length > 0 &&
            oldEntities.length > 0
        ) {
            const entitySimilarity =
                getEntityOverlapScore(
                    newEntities,
                    oldEntities
                );

            weightedScore +=
                entitySimilarity * 10;

            totalWeight += 10;
        }

        // 사건 발생 날짜 비교
        const dateDifference =
            getDateDifferenceDays(
                analysis.event_date,
                cluster.event_date
            );

        if (dateDifference !== null) {
            let dateScore = 0;

            if (dateDifference === 0) {
                dateScore = 1;
            } else if (dateDifference <= 1) {
                dateScore = 0.5;
            }

            weightedScore +=
                dateScore * 5;

            totalWeight += 5;
        }

        // 이슈 타입 비교
        if (
            analysis.issue_type &&
            cluster.issue_type
        ) {
            const newIssueType =
                normalizeIssueTypeForCluster(
                    analysis.issue_type
                );

            const issueScore =
                newIssueType === cluster.issue_type
                    ? 1
                    : 0;

            weightedScore +=
                issueScore * 5;

            totalWeight += 5;
        }

        let score =
            (weightedScore / totalWeight) * 100;

        /*
         * 의미는 비슷해도 핵심 장소나 발생 날짜가 명확하게 다르면
         * 서로 다른 사건일 가능성이 높으므로 편입을 제한합니다.
         */
        if (
            locationSimilarity !== null &&
            locationSimilarity < 0.25
        ) {
            score = Math.min(score, 55);
        }

        if (
            dateDifference !== null &&
            dateDifference > 1
        ) {
            score = Math.min(score, 60);
        }

        console.log(
            "후보:",
            cluster.cluster_id,
            cluster.representative_title,
            "embedding:",
            embeddingSimilarity.toFixed(3),
            "최종점수:",
            score.toFixed(2)
        );

        if (score > bestScore) {
            bestScore = score;
            bestCluster = cluster;
        }
    }

    return {
        bestCluster,
        bestScore
    };
}

// centroid와 가장 가까운 실제 기사를 대표기사(medoid)로 선택합니다.
async function findMedoid(
    clusterId,
    centroid,
    currentArticle
) {
    const articles =
        await clusterRepository
            .findArticlesByClusterId(clusterId);

    const candidates = [];

    for (const article of articles) {
        const embedding =
            safeParseEmbedding(
                article.article_embedding
            );

        if (!embedding) continue;

        candidates.push({
            articleId: article.article_id,
            title: article.title,
            embedding
        });
    }

    // 현재 기사는 아직 article_analysis에 저장되기 전이므로 직접 추가합니다.
    if (currentArticle.embedding) {
        candidates.push(currentArticle);
    }

    let bestArticle = currentArticle;
    let bestSimilarity = -Infinity;

    for (const article of candidates) {
        const similarity =
            cosineSimilarity(
                centroid,
                article.embedding
            );

        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestArticle = article;
        }
    }

    return bestArticle;
}

async function assignCluster({
    articleId,
    analysis,
    title,
    riskScore
}) {
    // 3번: 제목 + 요약문 전체를 BGE-M3로 임베딩합니다.
    const embeddingText =
        buildEmbeddingText(
            title,
            analysis.summary
        );

    let newEmbedding = null;

    try {
        newEmbedding =
            await getCachedEmbedding(
                embeddingText
            );
    } catch (error) {
        console.error(
            "기사 임베딩 생성 실패:",
            error.message
        );
    }

    const clusterIssueType =
        normalizeIssueTypeForCluster(
            analysis.issue_type
        );

    const clusterKey =
        buildClusterKey(
            analysis,
            title,
            clusterIssueType,
            articleId
        );

    const {
        bestCluster,
        bestScore
    } = await findBestCluster(
        analysis,
        title,
        newEmbedding
    );

    let clusterId;

    if (
        bestCluster &&
        bestScore >= CLUSTER_MATCH_THRESHOLD
    ) {
        clusterId =
            bestCluster.cluster_id;

        // 새 기사를 반영하여 centroid를 갱신합니다.
        const oldCentroid =
            safeParseEmbedding(
                bestCluster.centroid_embedding
            );

        const newCentroid =
            calculateUpdatedCentroid(
                oldCentroid,
                newEmbedding,
                bestCluster.article_count
            );

        await clusterRepository
            .updateMatchedCluster(
                clusterId,
                riskScore
            );

        // 4번: 새 centroid 기준 medoid를 다시 선정합니다.
        const medoid =
            await findMedoid(
                clusterId,
                newCentroid,
                {
                    articleId,
                    title,
                    embedding: newEmbedding
                }
            );

        await clusterRepository
            .updateClusterRepresentation(
                clusterId,
                JSON.stringify(newCentroid),
                medoid.articleId,
                medoid.title
            );

    } else {
        // 새 클러스터에서는 첫 기사 자체가 centroid이자 medoid입니다.
        clusterId =
            await clusterRepository.createCluster({
                clusterKey,
                representativeTitle: title,
                representativeArticleId: articleId,
                centroidEmbedding:
                    newEmbedding
                        ? JSON.stringify(newEmbedding)
                        : null,
                issueType: clusterIssueType,
                riskScore
            });
    }

    return {
        clusterId,
        clusterKey,

        // article_analysis 저장 시 같이 넣기 위해 반환합니다.
        articleEmbedding: newEmbedding
    };
}

async function getClusters() {
    const rows =
        await clusterRepository.findAllWithArticles();

    const clusterMap = new Map();

    for (const row of rows) {
        if (!clusterMap.has(row.cluster_id)) {
            clusterMap.set(
                row.cluster_id,
                {
                    cluster_id: row.cluster_id,
                    cluster_key: row.cluster_key,
                    representative_title:
                        row.representative_title,
                    representative_article_id:
                        row.representative_article_id,
                    issue_type: row.issue_type,
                    first_detected:
                        row.first_detected,
                    last_detected:
                        row.last_detected,
                    article_count:
                        row.article_count,
                    max_risk_score:
                        row.max_risk_score,
                    cluster_status:
                        row.cluster_status,
                    articles: []
                }
            );
        }

        if (row.article_id) {
            clusterMap
                .get(row.cluster_id)
                .articles.push({
                    article_id: row.article_id,
                    title: row.title,
                    url: row.url,
                    source: row.source,
                    risk_score: row.risk_score,
                    event_name: row.event_name
                });
        }
    }

    return Array.from(
        clusterMap.values()
    );
}

async function getClusterWithArticles(clusterId) {
    const cluster =
        await clusterRepository.findById(
            clusterId
        );

    if (!cluster) {
        return null;
    }

    const articles =
        await clusterRepository
            .findArticlesByClusterId(
                clusterId
            );

    return {
        cluster,
        articles
    };
}

module.exports = {
    assignCluster,
    getClusters,
    getClusterWithArticles
};