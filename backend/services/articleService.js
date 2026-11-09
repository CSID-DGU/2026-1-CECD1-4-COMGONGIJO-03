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
        await articleRepository.findIdByUrl(article.url);

    if (existingArticle) {
        return {
            duplicate: true,
            articleId: existingArticle.article_id
        };
    }

    const articleId =
        await articleRepository.insertArticle(article);

    return {
        duplicate: false,
        articleId,
        analysisStatus: "pending"
    };
}

async function processArticleAnalysis(article) {
    const articleId = article.article_id;

    const existing =
        await articleRepository.findByIdWithAnalysis(articleId);

    if (!existing) {
        throw new Error(`Article not found: ${articleId}`);
    }

    if (existing.analysis_id != null) {
        return {
            skipped: true,
            articleId
        };
    }

    const analysis = await analyzeArticle({
        title: article.title,
        content: article.content,
        source: article.source,
        published_at: article.published_at
    });

    analysis.similar_crisis_history =
        await calculateSimilarCrisisHistory(
            analysis,
            article
        );

    const riskScore = calculateRiskScore(analysis);

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
        await analysisRepository.insertFullAnalysis({
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
    } = await createClusterAlertIfNeeded({
        articleId,
        clusterId,
        analysis,
        riskScore
    });

    return {
        skipped: false,
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
    processArticleAnalysis,
    saveLegacyAnalysis
};