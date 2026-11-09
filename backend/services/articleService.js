const analyzeArticle = require("../ai/analyzeArticle");
const articleRepository = require("../repositories/articleRepository");
const analysisRepository = require("../repositories/analysisRepository");
const { calculateRiskScore } = require("./riskService");
const { calculateSimilarCrisisHistory } = require("./riskFactorService");
const {
    createClusterAlertIfNeeded,
    createLegacyAlertIfNeeded
} = require("./alertService");
const db = require("../db");
const {
    assignCluster,
    recalculateClusterAfterSpamChange
} = require("./clusterService");


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

    // 스팸기사는 클러스터링 대상에서 제외합니다.
    let clusterId = null;
    let clusterKey = null;
    let articleEmbedding = null;

    if (analysis.target_related === true) {
        const clusterResult = await assignCluster({
            articleId,
            analysis,
            title: article.title,
            riskScore
        });

        clusterId = clusterResult.clusterId;
        clusterKey = clusterResult.clusterKey;
        articleEmbedding = clusterResult.articleEmbedding ?? null;
    }

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

async function moveArticleToSpam(articleId) { // 스팸 전환
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 현재 기사 상태 조회 및 잠금
        const article =
            await articleRepository.findSpamStateForUpdate(
                connection,
                articleId
            );

        if (!article) {
            await connection.rollback();

            return {
                success: false,
                reason: "ARTICLE_NOT_FOUND"
            };
        }

        const previousClusterId = article.cluster_id;

        // 사용자 스팸 판정 저장
        await articleRepository.updateSpamOverride(
            connection,
            articleId,
            true
        );

        // 기존 클러스터 소속 해제
        await articleRepository.updateArticleCluster(
            connection,
            articleId,
            null
        );

        // 기존 클러스터 정보 재계산
        if (previousClusterId != null) {
            await recalculateClusterAfterSpamChange(
                connection,
                previousClusterId
            );
        }

        await connection.commit();

        return {
            success: true,
            articleId,
            previousClusterId,
            isSpam: true
        };

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}

async function restoreArticleFromSpam(articleId) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const article =
            await articleRepository.findSpamStateForUpdate(
                connection,
                articleId
            );

        if (!article) {
            await connection.rollback();

            return {
                success: false,
                reason: "ARTICLE_NOT_FOUND"
            };
        }

        // 이미 정상 기사라면 변경하지 않습니다.
        if (Number(article.is_normal) === 1) {
            await connection.rollback();

            return {
                success: false,
                reason: "ALREADY_NORMAL"
            };
        }

        // 기존 분석 결과 재사용
        const analysis = {
            summary: article.summary,
            issue_type: article.issue_type,
            event_name: article.event_name,
            event_date: article.event_date,
            event_location: article.event_location,
            event_entities:
                typeof article.event_entities === "string"
                    ? JSON.parse(article.event_entities)
                    : article.event_entities,
            event_keywords:
                typeof article.event_keywords === "string"
                    ? JSON.parse(article.event_keywords)
                    : article.event_keywords
        };

        // 저장된 임베딩 재사용
        let articleEmbedding = null;

        if (article.article_embedding) {
            articleEmbedding =
                Array.isArray(article.article_embedding)
                    ? article.article_embedding
                    : JSON.parse(article.article_embedding);
        }

        // 기존 분석 결과를 이용하여 클러스터 재배정
        const clusterResult = await assignCluster({
            articleId,
            analysis,
            title: article.title,
            riskScore: Number(article.risk_score) || 0,
            connection,
            articleEmbedding: articleEmbedding ?? undefined
        });
        
        // 사용자 판정을 정상 기사로 변경
        await articleRepository.updateSpamOverride(
            connection,
            articleId,
            false
        );

        // 클러스터 소속 및 임베딩 저장
        await articleRepository.restoreArticleCluster(
            connection,
            articleId,
            clusterResult.clusterId,
            clusterResult.clusterKey,
            clusterResult.articleEmbedding
        );

        // 실제 소속 기사 기준으로 클러스터 재계산
        await recalculateClusterAfterSpamChange(
            connection,
            clusterResult.clusterId
        );

        await connection.commit();

        return {
            success: true,
            articleId,
            clusterId: clusterResult.clusterId,
            isSpam: false
        };

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}

module.exports = {
    createAndAnalyzeArticle,
    processArticleAnalysis,
    saveLegacyAnalysis,
    moveArticleToSpam,
    restoreArticleFromSpam
};