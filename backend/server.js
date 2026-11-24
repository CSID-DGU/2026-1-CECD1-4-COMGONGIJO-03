
const app = require("./app");

const {
    startArticleAnalysisWorker
} = require("./services/articleAnalysisWorker");
const { startScheduleFromEnv } = require("./services/crawlerService");
const { initializeSchema } = require("./repositories/riskWeightRepository");

async function start() {
    await initializeSchema();
    const server = app.listen(3000, () => {
        console.log("server start");
        startArticleAnalysisWorker();
        startScheduleFromEnv();
    });
    server.on("error", error => {
        console.error(error.code === "EADDRINUSE"
            ? "3000번 포트가 사용 중입니다. 기존 서버를 종료해 주세요."
            : `웹 서버 시작 실패 (${error.code || "unknown"})`);
        process.exit(1);
    });
}

start().catch(error => {
    console.error(`위험도 학습 테이블을 준비하지 못했습니다 (${error.code || "unknown"}). DB 연결과 CREATE 권한을 확인하세요.`);
    process.exit(1);
});
