const baseUrl = process.env.OLLAMA_BASE_URL;

async function request(path, body, timeout) {
    const response = await fetch(baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) throw new Error("Ollama request failed");
    return response.json();
}

async function main() {
    const generated = await request("/api/generate", {
        model: "qwen3:8b",
        prompt: "Reply with OK.",
        stream: false,
        think: false,
        keep_alive: 0,
        options: { num_predict: 12, num_ctx: 2048 }
    }, 240_000);
    if (!generated.done || !generated.response?.trim()) throw new Error("No generation");

    const embedded = await request("/api/embed", {
        model: "bge-m3:latest",
        input: "서울교통공사",
        keep_alive: 0
    }, 120_000);
    if (!embedded.embeddings?.[0]?.length || !embedded.embeddings[0].every(Number.isFinite)) {
        throw new Error("No valid embedding");
    }
}

main().catch(() => { process.exitCode = 1; });
