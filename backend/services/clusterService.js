const clusterRepository = require("../repositories/clusterRepository");
const { getEmbedding, cosineSimilarity } = require("../ai/embedding");

const {
    evaluateMatch,
    getCandidateEmbedding
} = require("./clusterSimilarityService");

const {
    findPrecreationMatch,
    persistPreviousLinks
} = require("./clusterLinkService");

const embeddingCache = new Map();
// 테스트 실행기가 클러스터 판정 결과를 수집하기 위한 리스너
const clusterDecisionListeners = new Set();

function subscribeClusterDecisions(listener) {
    clusterDecisionListeners.add(listener);

    return () => clusterDecisionListeners.delete(listener);
}

const CLUSTER_MATCH_THRESHOLD = 55; // 기존 70/100에서 임시 변경

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

async function findBestCluster(
    analysis,
    title,
    newEmbedding,
    connection = null
) {
    const candidateClusters =
        await clusterRepository.findRecentCandidates(
            connection ?? undefined
        );

    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of candidateClusters) {
        const referenceEmbedding =
            await getCandidateEmbedding(cluster);

        const evaluation = evaluateMatch(
            analysis,
            newEmbedding,
            cluster,
            referenceEmbedding
        );

        if (!evaluation.mergeable) continue;

        console.log(
            "후보:",
            cluster.cluster_id,
            cluster.representative_title,
            "embedding:",
            evaluation.embeddingSimilarity.toFixed(3),
            "최종점수:",
            evaluation.score.toFixed(2)
        );

        if (evaluation.score > bestScore) {
            bestScore = evaluation.score;
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
    currentArticle,
    connection = null
) {
    const articles =
        await clusterRepository.findArticlesByClusterId(
            clusterId,
            connection ?? undefined
        );

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
    riskScore,
    connection = null,
    articleEmbedding = undefined
}) {
    const embeddingText = buildEmbeddingText(
        title,
        analysis.summary
    );

    let newEmbedding = articleEmbedding;

    if (newEmbedding === undefined) {
        newEmbedding = null;

        try {
            newEmbedding =
                await getCachedEmbedding(embeddingText);
        } catch (error) {
            console.error(
                "기사 임베딩 생성 실패:",
                error.message
            );
        }
    }

    const clusterIssueType =
        normalizeIssueTypeForCluster(analysis.issue_type);

    const clusterKey = buildClusterKey(
        analysis,
        title,
        clusterIssueType,
        articleId
    );

    // 1. 기존 일반 기사 편입 판정
    const {
        bestCluster,
        bestScore
    } = await findBestCluster(
        analysis,
        title,
        newEmbedding,
        connection
    );

    let clusterId;
    let selectedCluster = bestCluster;
    let specialMerge = false;
    let specialMergeScore = null;
    let pendingLinks = [];

    // 2. 일반 편입 실패 시에만 전날 연결 및 특수 병합
    if (
        !bestCluster ||
        bestScore < CLUSTER_MATCH_THRESHOLD
    ) {
        const precreation = await findPrecreationMatch({
            analysis,
            articleEmbedding: newEmbedding,
            connection: connection ?? undefined
        });

        pendingLinks = precreation.previousLinks;

        if (precreation.todayCluster) {
            selectedCluster = precreation.todayCluster;
            specialMerge = true;
            specialMergeScore = precreation.mergeScore;
        }
    }

    // 3. 일반 편입 또는 특수 병합 성공
    if (
        specialMerge ||
        (bestCluster && bestScore >= CLUSTER_MATCH_THRESHOLD)
    ) {
        clusterId = selectedCluster.cluster_id;

        const oldCentroid = safeParseEmbedding(
            selectedCluster.centroid_embedding
        );

        const newCentroid = calculateUpdatedCentroid(
            oldCentroid,
            newEmbedding,
            selectedCluster.article_count
        );

        await clusterRepository.updateMatchedCluster(
            clusterId,
            riskScore,
            connection ?? undefined
        );

        const medoid = await findMedoid(
            clusterId,
            newCentroid,
            {
                articleId,
                title,
                embedding: newEmbedding
            },
            connection
        );

        await clusterRepository.updateClusterRepresentation(
            clusterId,
            newCentroid == null
                ? null
                : JSON.stringify(newCentroid),
            medoid.articleId,
            medoid.title,
            connection ?? undefined
        );
    } else {
        // 4. 일반 편입과 특수 병합 모두 실패
        clusterId = await clusterRepository.createCluster(
            {
                clusterKey,
                representativeTitle: title,
                representativeArticleId: articleId,
                centroidEmbedding: newEmbedding
                    ? JSON.stringify(newEmbedding)
                    : null,
                issueType: clusterIssueType,
                riskScore
            },
            connection ?? undefined
        );
    }

    // 5. 연결 가능한 전날 클러스터 관계 저장
    if (pendingLinks.length > 0) {
        await persistPreviousLinks(
            pendingLinks,
            clusterId,
            connection ?? undefined
        );
    }

    const clusterDecision = {
        article_id: articleId,
        candidate_cluster_id: specialMerge
            ? selectedCluster.cluster_id
            : bestCluster?.cluster_id ?? null,
        candidate_cluster_title: specialMerge
            ? selectedCluster.representative_title
            : bestCluster?.representative_title ?? null,
        similarity_score: specialMerge
            ? Number(specialMergeScore.toFixed(4))
            : bestCluster
                ? Number(bestScore.toFixed(4))
                : null,
        max_score: 80,
        threshold: specialMerge
            ? 50
            : CLUSTER_MATCH_THRESHOLD,
        decision: specialMerge
            ? "LINKED_MERGE"
            : !bestCluster
                ? "NO_CANDIDATE"
                : bestScore >= CLUSTER_MATCH_THRESHOLD
                    ? "PASS"
                    : "FAIL",
        assigned_cluster_id: clusterId
    };

    for (const listener of clusterDecisionListeners) {
        try {
            listener(clusterDecision);
        } catch (error) {
            console.error(
                "[EVAL DECISION LISTENER ERROR]",
                error
            );
        }
    }

    return {
        clusterId,
        clusterKey:
            selectedCluster &&
            (specialMerge || bestScore >= CLUSTER_MATCH_THRESHOLD)
                ? selectedCluster.cluster_key
                : clusterKey,
        articleEmbedding: newEmbedding,
        clusterDecision
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


async function recalculateClusterAfterSpamChange(connection, clusterId) {
    const articles =
        await clusterRepository.findNormalArticlesForUpdate(
            connection,
            clusterId
        );

    const articleCount = articles.length;

    // 정상 기사가 하나도 남지 않은 경우 클러스터 삭제
    if (articleCount === 0) {
        await clusterRepository.deleteEmptyCluster(
            connection,
            clusterId
        );

        return;
    }

    // 정상 기사 중 유효한 임베딩만 추출
    const embeddedArticles = articles
        .map(article => ({
            ...article,
            embedding: safeParseEmbedding(
                article.article_embedding
            )
        }))
        .filter(article =>
            Array.isArray(article.embedding) &&
            article.embedding.length > 0 &&
            article.embedding.every(Number.isFinite)
        );

    let centroid = null;
    let representative = articles[0];

    if (embeddedArticles.length > 0) {
        const dimension = embeddedArticles[0].embedding.length;

        const validArticles = embeddedArticles.filter(
            article => article.embedding.length === dimension
        );

        centroid = Array(dimension).fill(0);

        for (const article of validArticles) {
            for (let i = 0; i < dimension; i++) {
                centroid[i] += article.embedding[i];
            }
        }

        centroid = centroid.map(
            value => value / validArticles.length
        );

        // centroid와 가장 가까운 기사를 대표기사로 선정
        let bestSimilarity = -Infinity;

        for (const article of validArticles) {
            const similarity = cosineSimilarity(
                centroid,
                article.embedding
            );

            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                representative = article;
            }
        }
    }

    const maxRiskScore = Math.max(
        0,
        ...articles.map(article =>
            Number(article.risk_score) || 0
        )
    );

    await clusterRepository.updateClusterAfterSpamChange(
        connection,
        clusterId,
        {
            centroidEmbedding: centroid,
            representativeArticleId: representative.article_id,
            representativeTitle: representative.title,
            articleCount,
            maxRiskScore,
            clusterStatus: "active"
        }
    );
}

module.exports = {
    subscribeClusterDecisions,
    assignCluster,
    getClusters,
    getClusterWithArticles,
    recalculateClusterAfterSpamChange
};