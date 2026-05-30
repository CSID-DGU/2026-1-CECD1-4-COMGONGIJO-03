// ollama 호출 
const buildAnalysisPrompt = require("./buildAnalysisPrompt");

async function analyzeArticle(article) {

    const prompt = buildAnalysisPrompt(article);

    const response = await fetch(
        "http://localhost:11434/api/generate",
        {
            method: "POST",
            headers: {
                "Content-Type":"application/json"
            },
            body: JSON.stringify({

                model:"qwen3:8b",

                prompt,

                stream:false,

                format:"json",

                options:{
                    temperature:0,
                    top_p:0.1
                }
            })
        }
    );

    const data = await response.json();

    return JSON.parse(data.response);
}

module.exports = analyzeArticle;