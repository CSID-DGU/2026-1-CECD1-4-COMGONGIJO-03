
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

    let analysis;

    try {
        analysis = JSON.parse(data.response);
    } catch (error) {
        throw new Error(
            `Ollama JSON 파싱 실패: ${data.response}`,
            { cause: error }
        );
    }

    if (
        !analysis ||
        typeof analysis !== "object" ||
        Array.isArray(analysis)
    ) {
        throw new Error("Ollama 분석 결과가 객체가 아닙니다.");
    }

    if (typeof analysis.target_related !== "boolean") {
        throw new Error(
            `잘못된 target_related: ${analysis.target_related}`
        );
    }

    const riskFactors = [
        "issue_severity",
        "target_responsibility",
        "norm_violation",
        "similar_crisis_history"
    ];

    for (const key of riskFactors) {
        const value = analysis[key];

        if (
            typeof value !== "number" &&
            typeof value !== "string"
        ) {
            throw new Error(
                `위험도 지표 누락 또는 자료형 오류: ${key}`
            );
        }

        const number = Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0 ||
            number > 1
        ) {
            throw new Error(
                `위험도 지표 범위 오류: ${key}=${value}`
            );
        }

        analysis[key] = Math.round(number * 10) / 10;
    }

    // 파급력 지표는 기존 저장 기사/테스트 스텁과의 호환을 위해 누락시
    // null로 남깁니다. 누락을 0점으로 위장하지 않습니다.
    for (const key of ["public_relevance", "title_sensationalism", "media_influence"]) {
        const value = analysis[key];
        if (value === undefined || value === null || value === "") {
            analysis[key] = null;
            continue;
        }
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 1) {
            analysis[key] = null;
            continue;
        }
        analysis[key] = Math.round(number * 10) / 10;
    }

    return analysis;
}

module.exports = analyzeArticle;
