
const app = require("./app");

const {
    startArticleAnalysisWorker
} = require("./services/articleAnalysisWorker");
const { startScheduleFromEnv } = require("./services/crawlerService");

const server = app.listen(3000, () => {
    console.log("server start");

    // 서버 시작 후 미분석 기사 처리 작업자 실행
    startArticleAnalysisWorker();
    startScheduleFromEnv();
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error("3000번 포트가 사용 중입니다. 기존 서버를 종료해 주세요.");
        process.exit(1);
    }
    throw error;
});
