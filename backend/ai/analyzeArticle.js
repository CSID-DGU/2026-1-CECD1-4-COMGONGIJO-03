
const buildAnalysisPrompt = require("./buildAnalysisPrompt");

async function analyzeArticle(article) {
    const prompt = buildAnalysisPrompt(article);

    const response = await fetch(
        `${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}/api/generate`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "qwen3:8b",
                prompt,
                stream: false,
                format: "json",
                options: {
                    temperature: 0,
                    top_p: 0.1
                }
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `Ollama API 오류 (${response.status}): ${JSON.stringify(data)}`
        );
    }

    if (typeof data.response !== "string" || !data.response.trim()) {
        throw new Error(
            `Ollama 응답 형식 오류: ${JSON.stringify(data)}`
        );
    }

    try {
        return JSON.parse(data.response);
    } catch (error) {
        throw new Error(
            `Ollama JSON 파싱 실패: ${data.response}`,
            { cause: error }
        );
    }
}

module.exports = analyzeArticle;
