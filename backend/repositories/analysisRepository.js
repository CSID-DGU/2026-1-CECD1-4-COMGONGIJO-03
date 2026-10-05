const db = require("../db");

/*
 * 정상 기사의 AI 분석 결과와 클러스터링 결과를 저장합니다.
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
 * 스팸으로 판정된 기사의 AI 분석 결과를 저장합니다.
 *
 * 위험도 계산과 클러스터링은 수행하지 않았으므로
 * cluster_id, risk_score, cluster_key, article_embedding은
 * 저장하지 않고 NULL 상태로 유지합니다.
 *
 * 이후 사용자가 스팸이 아니라고 복구할 경우
 * 저장된 AI 분석 결과를 이용하여 위험도 계산부터
 * 다시 진행할 수 있도록 분석 데이터 자체는 보존합니다.
 */
async function insertFilteredAnalysis({
    articleId,
    analysis
}) {
    const [result] = await db.query(
        `
        INSERT INTO article_analysis (
            article_id,
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

            analysis_status,
            analyzed_at
        )
        VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            'filtered',
            NOW()
        )
        `,
        [
            articleId,
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
            analysis.risk_factor_reason
        ]
    );

    return result.insertId;
}

/*
 * 기존 API에서 전달된 간단한 분석 결과를 저장합니다.
 * 기존 기능 호환을 위해 별도로 유지합니다.
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
    insertFilteredAnalysis,
    insertLegacyAnalysis
};