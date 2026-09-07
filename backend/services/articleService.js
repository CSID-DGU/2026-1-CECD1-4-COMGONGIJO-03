const analyzeArticle = require("../ai/analyzeArticle");
const articleRepository = require("../repositories/articleRepository");
const analysisRepository = require("../repositories/analysisRepository");
const { calculateRiskScore } = require("./riskService");
const { assignCluster } = require("./clusterService");
const {
    createClusterAlertIfNeeded,
    createLegacyAlertIfNeeded
} = require("./alertService");

async function createAndAnalyzeArticle(article) {
    const existingArticle = await articleRepository.findIdByUrl(article.url);
    if (existingArticle) {
        return {
            duplicate: true,
            articleId: existingArticle.article_id
        };
    }

    const articleId = await articleRepository.insertArticle(article);

    // 기존 동작을 유지하기 위해 AI에는 제목과 본문만 전달합니다.
    const analysis = await analyzeArticle({
        title: article.title,
        content: article.content
    });

    console.log("AI 분석 결과:", analysis);

    const riskScore = calculateRiskScore(analysis);
    const { clusterId, clusterKey } = await assignCluster({
        analysis,
        title: article.title,
        riskScore
    });

    const analysisId = await analysisRepository.insertFullAnalysis({
        articleId,
        clusterId,
        analysis,
        riskScore,
        clusterKey
    });

    const { alertCreated, alertId } = await createClusterAlertIfNeeded({
        articleId,
        clusterId,
        analysis,
        riskScore
    });

    return {
        duplicate: false,
        articleId,
        analysisId,
        clusterId,
        clusterKey,
        riskScore,
        alertCreated,
        alertId,
        analysis
    };
}

async function saveLegacyAnalysis(articleId, analysis) {
    const exists = await articleRepository.existsById(articleId);
    if (!exists) {
        return {
            articleNotFound: true
        };
    }

    const analysisId = await analysisRepository.insertLegacyAnalysis(articleId, analysis);
    const { alertCreated, alertId } = await createLegacyAlertIfNeeded({
        articleId,
        analysis
    });

    return {
        articleNotFound: false,
        analysisId,
        alertCreated,
        alertId
    };
}

module.exports = {
    createAndAnalyzeArticle,
    saveLegacyAnalysis
};
