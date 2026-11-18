
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
            signal: AbortSignal.timeout(120000),
            body: JSON.stringify({
                model: "qwen3:8b",
                prompt,
                stream: false,
                format: "json",
                options: {
                    temperature: 0,
                    top_p: 0.1,
                    num_ctx: 8192,
                    num_predict: 3072
                }
            })
        }
    );

    const data = await response.json();
    
    console.log("[OLLAMA TOKEN USAGE]", {
        article_id: article.article_id,
        input_tokens: data.prompt_eval_count,
        output_tokens: data.eval_count,
        done_reason: data.done_reason,
        output_seconds: data.eval_duration
            ? (data.eval_duration / 1e9).toFixed(2)
            : null
    });

    if (data.done_reason === "length") {
        throw new Error(
            `Ollama 출력 토큰 제한 초과: ${data.eval_count} tokens`
        );
    }

    if (data.done !== true || data.done_reason !== "stop") {
        throw new Error(
            `Ollama 비정상 종료: ${data.done_reason ?? "unknown"}`
        );
    }

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
