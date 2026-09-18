const db = require("../db");

/*
 * AI 분석 결과와 클러스터링 결과를 article_analysis에 저장합니다.
 * 클러스터링 과정에서 기사 임베딩을 생성한 경우 함께 저장합니다.
 */
async function insertFullAnalysis({
    articleId,
    clusterId,
    analysis,
    riskScore,
    clusterKey,
    articleEmbedding
}) {
    const [result] = await db.query(
        `
        INSERT INTO article_analysis (
            article_id,
            cluster_id,
            summary,
            sentiment_label,
            sentiment_score,
            target_name,
            issue_type,
            event_name,
            event_date,
            event_location,
            event_entities,
            event_keywords,
            article_embedding,
            target_related,
            target_mention_type,
            negative_impact_type,
            issue_severity,
            public_sensitivity,
            target_responsibility,
            spread_potential,
            risk_factor_reason,
            risk_score,
            cluster_key,
            analysis_status,
            analyzed_at
        )
        VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, NOW()
        )
        `,
        [
            articleId,
            clusterId,
            analysis.summary,
            analysis.sentiment_label,
            analysis.sentiment_score,
            analysis.target_name,
            analysis.issue_type,
            analysis.event_name,
            analysis.event_date,
            analysis.event_location,
            JSON.stringify(analysis.event_entities || []),
            JSON.stringify(analysis.event_keywords || []),

            // BGE-M3 임베딩 배열은 JSON 문자열로 저장합니다.
            articleEmbedding
                ? JSON.stringify(articleEmbedding)
                : null,

            analysis.target_related,
            analysis.target_mention_type,
            analysis.negative_impact_type,
            analysis.issue_severity,
            analysis.public_sensitivity,
            analysis.target_responsibility,
            analysis.spread_potential,
            analysis.risk_factor_reason,
            riskScore,
            clusterKey,
            "completed"
        ]
    );

    return result.insertId;
}

/*
 * 기존 API에서 전달된 간단한 분석 결과를 저장
 * 기존 기능 호환을 위해 별도로 유지
 */
async function insertLegacyAnalysis(articleId, analysis) {
    const [result] = await db.query(
        `
        INSERT INTO article_analysis (
            article_id,
            summary,
            sentiment_label,
            sentiment_score,
            risk_score,
            analysis_status,
            analyzed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
            articleId,
            analysis.summary,
            analysis.sentiment_label,
            analysis.sentiment_score,
            analysis.risk_score,
            analysis.analysis_status || "completed"
        ]
    );

    return result.insertId;
}

module.exports = {
    insertFullAnalysis,
    insertLegacyAnalysis
};