const { getEmbedding, cosineSimilarity } = require("../ai/embedding");

const embeddingCache = new Map();

function parseEmbedding(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "string") return null;

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\w가-힣]/g, "");
}

function textSimilarity(a, b) {
    const x = normalize(a);
    const y = normalize(b);

    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.8;

    const bigrams = text => new Set(
        Array.from(
            { length: Math.max(0, text.length - 1) },
            (_, i) => text.slice(i, i + 2)
        )
    );

    const left = bigrams(x);
    const right = bigrams(y);

    if (!left.size || !right.size) return 0;

    let matches = 0;

    for (const token of left) {
        if (right.has(token)) matches++;
    }

    return matches / Math.max(left.size, right.size);
}

// 기사 편입과 연결, 병합에서 공통으로 사용하는 80점 평가식
function evaluateMatch(
    analysis,
    articleEmbedding,
    cluster,
    clusterEmbedding = undefined
) {
    const current = parseEmbedding(articleEmbedding);

    const reference = parseEmbedding(
        clusterEmbedding === undefined
            ? cluster?.centroid_embedding
            : clusterEmbedding
    );

    if (
        !current ||
        !reference ||
        !current.length ||
        current.length !== reference.length
    ) {
        return {
            score: 0,
            mergeable: false,
            reason: "embedding_missing_or_invalid"
        };
    }

    const similarity = Math.max(
        0,
        cosineSimilarity(current, reference)
    );

    if (!Number.isFinite(similarity)) {
        return {
            score: 0,
            mergeable: false,
            reason: "embedding_invalid"
        };
    }

    let score = similarity * 60;

    if (analysis?.event_name && cluster?.event_name) {
        score += textSimilarity(
            analysis.event_name,
            cluster.event_name
        ) * 10;
    }

    const locationA = String(
        analysis?.event_location || ""
    ).trim();

    const locationB = String(
        cluster?.event_location || ""
    ).trim();

    score += locationA && locationB
        ? textSimilarity(locationA, locationB) * 10
        : 5;

    return {
        score,
        mergeable: true,
        reason: null,
        embeddingSimilarity: similarity
    };
}

async function getCandidateEmbedding(cluster) {
    let embedding = parseEmbedding(
        cluster?.centroid_embedding
    );

    if (!embedding) {
        embedding = parseEmbedding(
            cluster?.article_embedding
        );
    }

    if (!embedding && cluster?.representative_title) {
        const title = cluster.representative_title;

        if (!embeddingCache.has(title)) {
            embeddingCache.set(
                title,
                await getEmbedding(title)
            );
        }

        embedding = parseEmbedding(
            embeddingCache.get(title)
        );
    }

    return embedding;
}

module.exports = {
    evaluateMatch,
    getCandidateEmbedding,
    parseEmbedding
};