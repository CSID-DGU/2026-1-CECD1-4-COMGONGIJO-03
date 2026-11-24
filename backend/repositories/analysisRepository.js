const db = require("../db");

async function insertFullAnalysis({
    articleId,
    clusterId,
    analysis,
    riskScore,
    clusterKey,
    calibratedFactors,
    riskModelVersion,
    impact,
    articleEmbedding,
    eventNameEmbedding
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
            event_name_embedding,
            target_related,
            target_mention_type,
            negative_impact_type,
            media_influence,
            public_relevance,
            title_sensationalism,
            initial_spread_score,
            initial_impact_score,
            media_influence_origin,
            impact_model_version,
            issue_severity,
            target_responsibility,
            norm_violation,
            similar_crisis_history,
            risk_factor_reason,
            risk_score,
            risk_calibrated_factors,
            risk_model_version,
            cluster_key,
            analysis_status,
            analyzed_at
        )
        VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
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

            JSON.stringify(
                analysis.event_entities || []
            ),

            JSON.stringify(
                analysis.event_keywords || []
            ),

            articleEmbedding
                ? JSON.stringify(
                    articleEmbedding
                )
                : null,
                
            eventNameEmbedding
                ? JSON.stringify(eventNameEmbedding)
                : null,

            analysis.target_related,
            analysis.target_mention_type,
            analysis.negative_impact_type,

            impact.media_influence,
            impact.public_relevance,
            impact.title_sensationalism,
            impact.initial_spread_score,
            impact.initial_impact_score,
            impact.media_influence_origin,
            impact.impact_model_version,
            analysis.issue_severity,
            analysis.target_responsibility,
            analysis.norm_violation,
            analysis.similar_crisis_history,

            analysis.risk_factor_reason,
            riskScore,
            JSON.stringify(calibratedFactors),
            riskModelVersion,
            clusterKey,
            "completed"
        ]
    );

    return result.insertId;
}

async function insertLegacyAnalysis(
    articleId,
    analysis
) {
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
            analysis.analysis_status ||
                "completed"
        ]
    );

    return result.insertId;
}

module.exports = {
    insertFullAnalysis,
    insertLegacyAnalysis
};