const articleRepository = require("../repositories/articleRepository");
const { processArticleAnalysis } = require("./articleService");

const POLL_INTERVAL = 10000;
const RETRY_DELAY = 60000;
const MAX_ATTEMPTS = 3;

const retryAfter = new Map();
const attemptCounts = new Map();
const failedArticles = new Map();

let running = false;
let stopped = false;

async function processPendingArticles() {
    if (running || stopped) return;

    running = true;

    try {
        const now = Date.now();

        // 재시도 대기 중이거나 최종 실패한 기사는
        // 이번 조회에서 제외합니다.
        const excludedIds = [
            ...failedArticles.keys(),
            ...[...retryAfter.entries()]
                .filter(([, retryTime]) => retryTime > now)
                .map(([articleId]) => articleId)
        ];

        const articles =
            await articleRepository.findUnanalyzedArticles(
                10,
                excludedIds
            );

        for (const article of articles) {
            if (stopped) break;

            const articleId = Number(article.article_id);

            const attempts =
                (attemptCounts.get(articleId) || 0) + 1;

            attemptCounts.set(articleId, attempts);

            try {
                console.log(
                    `[ANALYSIS START] ${articleId} ` +
                    `attempt=${attempts}/${MAX_ATTEMPTS}`
                );

                const result =
                    await processArticleAnalysis(article);

                retryAfter.delete(articleId);
                attemptCounts.delete(articleId);

                console.log(
                    `[ANALYSIS DONE] ${articleId}`,
                    result.skipped ? "skipped" : "completed"
                );
            } catch (error) {
                console.error(
                    `[ANALYSIS ERROR] ${articleId} ` +
                    `attempt=${attempts}/${MAX_ATTEMPTS}`,
                    error
                );

                if (attempts >= MAX_ATTEMPTS) {
                    retryAfter.delete(articleId);

                    failedArticles.set(articleId, {
                        attempts,
                        error: error.message
                    });

                    console.error(
                        `[ANALYSIS FINAL FAILURE] ${articleId}`,
                        {
                            attempts,
                            reason: error.message
                        }
                    );
                } else {
                    retryAfter.set(
                        articleId,
                        Date.now() + RETRY_DELAY
                    );
                }
            }
        }
    } catch (error) {
        console.error("[WORKER ERROR]", error);
    } finally {
        running = false;
    }
}

function startArticleAnalysisWorker() {
    // 테스트에서 Worker를 다시 시작할 경우 초기화합니다.
    stopped = false;
    retryAfter.clear();
    attemptCounts.clear();
    failedArticles.clear();

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

function getFailedArticles() {
    return new Map(failedArticles);
}

module.exports = {
    startArticleAnalysisWorker,
    getFailedArticles
};