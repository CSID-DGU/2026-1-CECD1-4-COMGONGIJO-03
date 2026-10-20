const analyzeArticle = require("../ai/analyzeArticle");
const articleRepository = require("../repositories/articleRepository");
const analysisRepository = require("../repositories/analysisRepository");
const { calculateRiskScore } = require("./riskService");
const { calculateSimilarCrisisHistory } = require("./riskFactorService");
const { assignCluster } = require("./clusterService");
const {
    createClusterAlertIfNeeded,
    createLegacyAlertIfNeeded
} = require("./alertService");

async function createAndAnalyzeArticle(article) {
    const existingArticle =
        await articleRepository.findIdByUrl(
            article.url
        );

    if (existingArticle) {
        return {
            duplicate: true,
            articleId:
                existingArticle.article_id
        };
    }

    const articleId =
        await articleRepository.insertArticle(
            article
        );

    const analysis =
        await analyzeArticle({
            title: article.title,
            content: article.content,
            source: article.source,
            published_at:
                article.published_at
        });

    /*
     * 유사위기 이력은 AI에게 추측시키지 않고
     * 기존 DB의 과거 사건을 이용하여 계산합니다.
     */
    analysis.similar_crisis_history =
        await calculateSimilarCrisisHistory(
            analysis,
            article
        );

    console.log(
        "AI 분석 결과:",
        analysis
    );

    const riskScore =
        calculateRiskScore(
            analysis
        );

    const {
        clusterId,
        clusterKey,
        articleEmbedding = null
    } = await assignCluster({
        articleId,
        analysis,
        title: article.title,
        riskScore
    });

    const analysisId =
        await analysisRepository
            .insertFullAnalysis({
                articleId,
                clusterId,
                analysis,
                riskScore,
                clusterKey,
                articleEmbedding
            });

    const {
        alertCreated,
        alertId
    } =
        await createClusterAlertIfNeeded({
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

async function saveLegacyAnalysis(
    articleId,
    analysis
) {
    const exists =
        await articleRepository
            .existsById(
                articleId
            );

    if (!exists) {
        return {
            articleNotFound: true
        };
    }

    const analysisId =
        await analysisRepository
            .insertLegacyAnalysis(
                articleId,
                analysis
            );

    const {
        alertCreated,
        alertId
    } =
        await createLegacyAlertIfNeeded({
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