const analyzeArticle = require("../ai/analyzeArticle");
const articleRepository = require("../repositories/articleRepository");
const analysisRepository = require("../repositories/analysisRepository");
const spamRepository = require("../repositories/spamRepository");
const { calculateRiskScore } = require("./riskService");
const { assignCluster } = require("./clusterService");
const {
    createClusterAlertIfNeeded,
    createLegacyAlertIfNeeded
} = require("./alertService");

/*
 * 신규 기사를 저장한 뒤
 * AI 분석 → 위험도 계산 → 클러스터링 → 분석 결과 저장 → 알림 생성
 * 순서로 전체 처리 흐름을 담당합니다.
 */
async function createAndAnalyzeArticle(article) {
    // URL 기준으로 이미 저장된 기사인지 확인합니다.
    const existingArticle = await articleRepository.findIdByUrl(article.url);

    if (existingArticle) {
        return {
            duplicate: true,
            articleId: existingArticle.article_id
        };
    }

    // 기사를 먼저 저장하여 이후 분석/클러스터링에서 사용할 articleId를 확보합니다.
    const articleId = await articleRepository.insertArticle(article);

    // 현재 AI 분석에는 제목과 본문을 사용합니다.
    const analysis = await analyzeArticle({
        title: article.title,
        content: article.content
    });

    console.log("AI 분석 결과:", analysis);

    /*
     * 대상 기업과 관련 없는 기사라면
     * AI 분석 결과는 저장하되 위험도 계산과 클러스터링은 수행하지 않습니다.
     */
    if (analysis.target_related === false) {
        const analysisId =
            await analysisRepository.insertFilteredAnalysis({
                articleId,
                analysis
            });

        const spamId =
            await spamRepository.insertSpamArticle({
                articleId,
                analysisId,
                spamSource: "AI"
            });

        return {
            duplicate: false,
            filtered: true,
            articleId,
            analysisId,
            spamId,
            analysis
        };
    }

    // AI 분석 결과를 바탕으로 기사 위험도를 계산합니다.
    const riskScore = calculateRiskScore(analysis);

    /*
     * 클러스터링을 수행합니다.
     *
     * articleId를 함께 전달하여 centroid/medoid 등에서
     * 현재 처리 중인 실제 기사를 식별할 수 있게 합니다.
     *
     * articleEmbedding은 클러스터링 방식에서 생성한 경우 반환하며,
     * 사용하지 않는 방식에서는 null이어도 정상적으로 동작합니다.
     */
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

    // AI 분석 결과와 클러스터링 결과, 기사 임베딩을 DB에 저장합니다.
    const analysisId = await analysisRepository.insertFullAnalysis({
        articleId,
        clusterId,
        analysis,
        riskScore,
        clusterKey,
        articleEmbedding
    });

    // 위험도 기준을 만족하면 해당 클러스터에 대한 알림을 생성합니다.
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

/*
 * 기존 방식으로 전달된 분석 결과를 저장하고
 * 필요한 경우 기존 방식의 알림을 생성
 */
async function saveLegacyAnalysis(articleId, analysis) {
    const exists = await articleRepository.existsById(articleId);

    if (!exists) {
        return {
            articleNotFound: true
        };
    }

    const analysisId =
        await analysisRepository.insertLegacyAnalysis(
            articleId,
            analysis
        );

    const { alertCreated, alertId } =
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