const app = require("./app");

const {
    startArticleAnalysisWorker
} = require("./services/articleAnalysisWorker");
const { startScheduleFromEnv } = require("./services/crawlerService");

const server = app.listen(3000, () => {
    console.log("server start");

    // 서버 시작 후 미분석 기사 처리 작업자 실행
    startArticleAnalysisWorker();

    // .env 에 CRAWL_KEYWORDS 가 있으면 구글 뉴스 자동 수집 시작
    startScheduleFromEnv();
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error("❌ 3000번 포트를 이미 사용 중입니다. 이전에 실행한 서버를 종료한 뒤 다시 실행하세요.");
        process.exit(1);
    }
    throw err;
});