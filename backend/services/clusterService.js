const clusterRepository = require("../repositories/clusterRepository");
const { getEmbedding, cosineSimilarity } = require("../ai/embedding");

const embeddingCache = new Map();
const CLUSTER_MATCH_THRESHOLD = 70;

async function getCachedEmbedding(text) {
    if (!text) return null;

    if (embeddingCache.has(text)) {
        console.log("캐시 히트");
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
    } catch (error) {
        return [];
    }
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}

function normalizeKeyword(value) {
    return normalizeText(value)
        .replace(/사고$/, "")
        .replace(/논란$/, "")
        .replace(/문제$/, "");
}

function getTextSimilarity(a, b) {
    const textA = normalizeText(a);
    const textB = normalizeText(b);

    if (!textA || !textB) return 0;
    if (textA === textB) return 1;
    if (textA.includes(textB) || textB.includes(textA)) return 0.8;

    const getBigrams = str => {
        const bigrams = new Set();
        for (let i = 0; i < str.length - 1; i++) {
            bigrams.add(str.substr(i, 2));
        }
        return bigrams;
    };

    const setA = getBigrams(textA);
    const setB = getBigrams(textB);

    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) intersection++;
    }

    return intersection / Math.max(setA.size, setB.size);
}

function getKeywordMatchScore(newKeywords, oldKeywords) {
    const newSet = [...new Set((newKeywords || []).map(normalizeKeyword).filter(Boolean))];
    const oldSet = [...new Set((oldKeywords || []).map(normalizeKeyword).filter(Boolean))];

    if (newSet.length === 0 || oldSet.length === 0) {
        return {
            score: 0,
            exactMatchCount: 0,
            similarMatchCount: 0,
            matchedKeywords: []
        };
    }

    let exactMatchCount = 0;
    let similarMatchCount = 0;
    const matchedKeywords = [];

    for (const newKeyword of newSet) {
        let matched = false;

        for (const oldKeyword of oldSet) {
            if (newKeyword === oldKeyword) {
                exactMatchCount++;
                matchedKeywords.push(newKeyword);
                matched = true;
                break;
            }
        }

        if (matched) continue;

        for (const oldKeyword of oldSet) {
            const similarity = getTextSimilarity(newKeyword, oldKeyword);

            if (similarity >= 0.75) {
                similarMatchCount++;
                matchedKeywords.push(`${newKeyword}~${oldKeyword}`);
                break;
            }
        }
    }

    return {
        score: Math.min(100, exactMatchCount * 15 + similarMatchCount * 8),
        exactMatchCount,
        similarMatchCount,
        matchedKeywords
    };
}

function isSimilarIssueType(a, b) {
    const typeA = String(a || "").trim();
    const typeB = String(b || "").trim();

    if (!typeA || !typeB) return false;
    if (typeA === typeB) return true;

    const similarGroups = [
        ["safety", "accident", "facility", "service_disruption"],
        ["service", "service_disruption", "congestion"],
        ["labor", "strike"]
    ];

    return similarGroups.some(group =>
        group.includes(typeA) && group.includes(typeB)
    );
}

function normalizeIssueTypeForCluster(issueType) {
    const type = String(issueType || "etc").trim();

    if (["safety", "accident", "facility", "service_disruption"].includes(type)) {
        return "incident";
    }

    return type || "etc";
}

function makeKeywordSentence(keywords) {
    return [...new Set((keywords || []).map(normalizeKeyword).filter(Boolean))]
        .slice(0, 10)
        .join(" ");
}

function buildClusterKey(analysis, title, clusterIssueType, newKeywords) {
    return [
        clusterIssueType,
        newKeywords.map(normalizeKeyword).filter(Boolean).slice(0, 5).join("-") ||
            normalizeText(analysis.event_name || title) ||
            "no_event"
    ].join("-");
}

async function findBestCluster(analysis, title, newKeywords, newEmbedding, clusterIssueType) {
    const candidateClusters = await clusterRepository.findRecentCandidates();
    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of candidateClusters) {
        let score = 0;
        const oldKeywords = safeParseJsonArray(cluster.event_keywords);
        const keywordResult = getKeywordMatchScore(newKeywords, oldKeywords);

        let embeddingSimilarity = 0;
        let embeddingScore = 0;

        try {
            const oldKeywordSentence = makeKeywordSentence(oldKeywords);

            if (newEmbedding && oldKeywordSentence) {
                const oldEmbedding = await getCachedEmbedding(oldKeywordSentence);
                embeddingSimilarity = cosineSimilarity(newEmbedding, oldEmbedding);
                embeddingScore = embeddingSimilarity * 100;
            }
        } catch (error) {
            console.error("기존 클러스터 임베딩 생성 실패:", error.message);
        }

        score += embeddingScore * 0.45;
        score += keywordResult.score * 0.3;

        const eventNameSimilarity = getTextSimilarity(
            analysis.event_name || title,
            cluster.event_name || cluster.representative_title
        );
        score += eventNameSimilarity * 35;

        if (
            keywordResult.exactMatchCount === 0 &&
            keywordResult.similarMatchCount === 0 &&
            eventNameSimilarity < 0.2
        ) {
            score = Math.min(score, 45);
        }

        const normalizedNewName = normalizeText(analysis.event_name || title);
        const normalizedOldName = normalizeText(cluster.event_name || cluster.representative_title);
        if (
            normalizedNewName &&
            normalizedOldName &&
            (normalizedNewName.includes(normalizedOldName) || normalizedOldName.includes(normalizedNewName))
        ) {
            score += 20;
        }

        const locationSimilarity = getTextSimilarity(
            analysis.event_location,
            cluster.event_location
        );
        score += locationSimilarity * 5;

        if (cluster.issue_type === clusterIssueType || cluster.issue_type === analysis.issue_type) {
            score += 10;
        } else if (isSimilarIssueType(cluster.issue_type, analysis.issue_type)) {
            score += 5;
        }

        const totalMatchCount = keywordResult.exactMatchCount + keywordResult.similarMatchCount;
        if (totalMatchCount < 1 && eventNameSimilarity < 0.6) {
            score = Math.min(score, 40);
        }

        console.log(
            "후보:", cluster.cluster_id, cluster.representative_title,
            "최종점수:", score,
            "키워드일치:", keywordResult.exactMatchCount,
            "사건명유사도:", eventNameSimilarity
        );

        if (score > bestScore) {
            bestScore = score;
            bestCluster = cluster;
        }
    }

    return { bestCluster, bestScore };
}

async function assignCluster({ analysis, title, riskScore }) {
    const newKeywords = Array.isArray(analysis.event_keywords)
        ? analysis.event_keywords
        : [];
    const newKeywordSentence = makeKeywordSentence(newKeywords);

    let newEmbedding = null;
    try {
        if (newKeywordSentence) {
            newEmbedding = await getCachedEmbedding(newKeywordSentence);
        }
    } catch (error) {
        console.error("새 기사 임베딩 생성 실패:", error.message);
    }

    const clusterIssueType = normalizeIssueTypeForCluster(analysis.issue_type);
    const clusterKey = buildClusterKey(analysis, title, clusterIssueType, newKeywords);

    const { bestCluster, bestScore } = await findBestCluster(
        analysis,
        title,
        newKeywords,
        newEmbedding,
        clusterIssueType
    );

    let clusterId;
    if (bestCluster && bestScore >= CLUSTER_MATCH_THRESHOLD) {
        clusterId = bestCluster.cluster_id;
        await clusterRepository.updateMatchedCluster(clusterId, riskScore);
    } else {
        clusterId = await clusterRepository.createCluster({
            clusterKey,
            representativeTitle: analysis.event_name || title,
            issueType: clusterIssueType,
            riskScore
        });
    }

    return {
        clusterId,
        clusterKey
    };
}

async function getClusters() {
    const rows = await clusterRepository.findAllWithArticles();
    const clusterMap = new Map();

    for (const row of rows) {
        if (!clusterMap.has(row.cluster_id)) {
            clusterMap.set(row.cluster_id, {
                cluster_id: row.cluster_id,
                cluster_key: row.cluster_key,
                representative_title: row.representative_title,
                issue_type: row.issue_type,
                first_detected: row.first_detected,
                last_detected: row.last_detected,
                article_count: row.article_count,
                max_risk_score: row.max_risk_score,
                cluster_status: row.cluster_status,
                articles: []
            });
        }

        if (row.article_id) {
            clusterMap.get(row.cluster_id).articles.push({
                article_id: row.article_id,
                title: row.title,
                url: row.url,
                source: row.source,
                risk_score: row.risk_score,
                event_name: row.event_name
            });
        }
    }

    return Array.from(clusterMap.values());
}

async function getClusterWithArticles(clusterId) {
    const cluster = await clusterRepository.findById(clusterId);
    if (!cluster) return null;

    const articles = await clusterRepository.findArticlesByClusterId(clusterId);
    return { cluster, articles };
}

module.exports = {
    assignCluster,
    getClusters,
    getClusterWithArticles
};
