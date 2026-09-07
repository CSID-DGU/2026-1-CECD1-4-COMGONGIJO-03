const articleRepository = require("../repositories/articleRepository");
const {
    createAndAnalyzeArticle,
    saveLegacyAnalysis
} = require("../services/articleService");

async function createArticle(req, res) {
    try {
        const { title, content, url, source, author, published_at } = req.body;

        if (!title || !url) {
            return res.status(400).json({
                success: false,
                message: "title과 url은 필수값입니다."
            });
        }

        const result = await createAndAnalyzeArticle({
            title,
            content,
            url,
            source,
            author,
            published_at
        });

        if (result.duplicate) {
            return res.status(409).json({
                success: false,
                message: "이미 저장된 기사입니다.",
                article_id: result.articleId
            });
        }

        return res.json({
            success: true,
            message: "기사 저장 + AI 분석 + 분석 결과 저장 + 클러스터링 완료",
            article_id: result.articleId,
            analysis_id: result.analysisId,
            cluster_id: result.clusterId,
            cluster_key: result.clusterKey,
            risk_score: result.riskScore,
            alert_created: result.alertCreated,
            alert_id: result.alertId,
            analysis: result.analysis
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "기사 저장 또는 분석 처리 실패"
        });
    }
}

async function saveAnalysis(req, res) {
    try {
        const { article_id } = req.params;
        const {
            summary,
            sentiment_label,
            sentiment_score,
            risk_score,
            analysis_status,
            alert_topic,
            alert_message
        } = req.body;

        const result = await saveLegacyAnalysis(article_id, {
            summary,
            sentiment_label,
            sentiment_score,
            risk_score,
            analysis_status,
            alert_topic,
            alert_message
        });

        if (result.articleNotFound) {
            return res.status(404).json({
                success: false,
                message: "해당 기사가 존재하지 않습니다."
            });
        }

        return res.json({
            success: true,
            message: "분석 결과 저장 성공",
            analysis_id: result.analysisId,
            alert_created: result.alertCreated,
            alert_id: result.alertId
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "분석 결과 저장 실패"
        });
    }
}

async function getArticleByUrl(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "url이 필요합니다."
            });
        }

        const article = await articleRepository.findByUrlWithAnalysis(url);
        if (!article) {
            return res.status(404).json({
                success: false,
                message: "기사를 찾을 수 없습니다."
            });
        }

        return res.json({
            success: true,
            article
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "URL 기사 조회 실패"
        });
    }
}

async function getAnalyzedArticles(req, res) {
    try {
        const articles = await articleRepository.findAnalyzedArticles();
        return res.json({
            success: true,
            count: articles.length,
            articles
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "분석 완료 기사 조회 실패"
        });
    }
}

async function getRiskyArticles(req, res) {
    try {
        const minRisk = req.query.minRisk || 0.7;
        const articles = await articleRepository.findRiskyArticles(minRisk);

        return res.json({
            success: true,
            count: articles.length,
            articles
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "위험 기사 조회 실패"
        });
    }
}

async function getArticles(req, res) {
    try {
        const { keyword } = req.query;
        const articles = await articleRepository.findAll(keyword);

        return res.json({
            success: true,
            count: articles.length,
            articles
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "기사 조회 실패"
        });
    }
}

async function getArticleById(req, res) {
    try {
        const { article_id } = req.params;
        const article = await articleRepository.findByIdWithAnalysis(article_id);

        if (!article) {
            return res.status(404).json({
                success: false,
                message: "기사를 찾을 수 없습니다."
            });
        }

        return res.json({
            success: true,
            article
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "기사 조회 실패"
        });
    }
}

module.exports = {
    createArticle,
    saveAnalysis,
    getArticleByUrl,
    getAnalyzedArticles,
    getRiskyArticles,
    getArticles,
    getArticleById
};
