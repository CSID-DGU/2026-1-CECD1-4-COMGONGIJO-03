const articleRepository = require("../repositories/articleRepository");
const { processArticleAnalysis } = require("./articleService");

const POLL_INTERVAL = 10000;
const RETRY_DELAY = 60000;

const retryAfter = new Map();

let running = false;
let stopped = false;

async function processPendingArticles() {
    if (running || stopped) return;

    running = true;

    try {
        const articles =
            await articleRepository.findUnanalyzedArticles(10);

        for (const article of articles) {
            if (stopped) break;

            const articleId = article.article_id;
            const nextRetry = retryAfter.get(articleId) || 0;

            if (Date.now() < nextRetry) {
                continue;
            }

            try {
                console.log(`[ANALYSIS START] ${articleId}`);

                const result =
                    await processArticleAnalysis(article);

                retryAfter.delete(articleId);

                console.log(
                    `[ANALYSIS DONE] ${articleId}`,
                    result.skipped ? "skipped" : "completed"
                );
            } catch (error) {
                console.error(
                    `[ANALYSIS ERROR] ${articleId}`,
                    error
                );

                retryAfter.set(
                    articleId,
                    Date.now() + RETRY_DELAY
                );
            }
        }
    } catch (error) {
        console.error("[WORKER ERROR]", error);
    } finally {
        running = false;
    }
}

function startArticleAnalysisWorker() {
    console.log("[WORKER] Article analysis worker started");

    const timer = setInterval(
        processPendingArticles,
        POLL_INTERVAL
    );

    processPendingArticles();

    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

module.exports = {
    startArticleAnalysisWorker
};