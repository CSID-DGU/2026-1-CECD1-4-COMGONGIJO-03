const { getEmbedding } = require("../ai/embedding");

const cache = new Map();
const MAX_CACHE_ENTRIES = 500;
const EMBEDDING_TIMEOUT_MS = 30000;

async function embedEventName(eventName) {
    if (typeof eventName !== "string") return null;

    const name = eventName.trim().replace(/\s+/g, " ");
    if (!name) return null;

    if (!cache.has(name)) {
        cache.set(name, getEmbedding(name, {
            signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)
        }));

        if (cache.size > MAX_CACHE_ENTRIES) {
            cache.delete(cache.keys().next().value);
        }
    }

    try {
        const vector = await cache.get(name);

        if (
            !Array.isArray(vector) ||
            vector.length === 0 ||
            !vector.every(Number.isFinite)
        ) {
            throw new Error("유효하지 않은 사건명 임베딩 벡터");
        }

        return vector;
    } catch (error) {
        cache.delete(name);
        console.error("[EVENT NAME EMBEDDING ERROR]", error.message);
        return null;
    }
}

module.exports = { embedEventName };