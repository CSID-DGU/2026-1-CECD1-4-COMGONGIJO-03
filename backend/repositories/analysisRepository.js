const db = require("../db");

async function insertFullAnalysis({ articleId, clusterId, analysis, riskScore, clusterKey }) {
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

async function insertLegacyAnalysis(articleId, analysis) {
    const [result] = await db.query(
        `
        INSERT INTO article_analysis
        (article_id, summary, sentiment_label, sentiment_score, risk_score, analysis_status, analyzed_at)
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
