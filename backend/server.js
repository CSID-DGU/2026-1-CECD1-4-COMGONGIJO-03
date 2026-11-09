const app = require("./app");

const {
    startArticleAnalysisWorker
} = require("./services/articleAnalysisWorker");

app.listen(3000, () => {
    console.log("server start");

    // 서버 시작 후 미분석 기사 처리 작업자 실행
    startArticleAnalysisWorker();
});