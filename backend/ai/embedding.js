const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "bge-m3:latest";

async function getEmbedding(text) {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: text
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`임베딩 생성 실패: ${response.status}`);
    }

    const data = await response.json();

    return data.embeddings[0];
}

function cosineSimilarity(vectorA, vectorB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        dot += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
    getEmbedding,
    cosineSimilarity
};