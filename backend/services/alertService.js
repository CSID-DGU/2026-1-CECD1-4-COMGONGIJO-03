
const alertRepository = require("../repositories/alertRepository");
const { notifyRiskAlert } = require("./notifyService");

const RISK_THRESHOLD = 0.6;

async function createClusterAlertIfNeeded({ articleId, clusterId, createdNewCluster, analysis, riskScore, title, forceNewNotification = false }) {
    // Only a newly INSERTed cluster qualifies. A matching/reused cluster is silent.
    if (analysis.target_related !== true || clusterId == null || createdNewCluster !== true) {
        return { alertCreated: false, alertId: null };
    }

    // Idempotency for retries after a successful DB write.
    // A split may move an old alert to the new cluster. A separate new-cluster
    // event is still needed, so the split path explicitly bypasses this check.
    if (!forceNewNotification) {
        const existingAlert = await alertRepository.findByClusterId(clusterId);
        if (existingAlert) {
            return { alertCreated: false, alertId: existingAlert.alert_id };
        }
    }

    const topic = analysis.alert_topic || analysis.event_name || title || "신규 클러스터";
    const message = analysis.alert_message || analysis.summary || "신규 클러스터가 생성되었습니다.";
    const alertId = await alertRepository.createClusterAlert({
        articleId, clusterId, topic, message, riskScore
    });

    // In test DB never send external mobile pushes. DB alerts can still be inspected.
    if (process.env.DB_NAME !== 'news_test_db') {
        notifyRiskAlert({
            alert_id: alertId,
            article_id: articleId,
            cluster_id: clusterId,
            notification_type: 'new_cluster',
            alert_topic: topic,
            alert_message: message,
            risk_score: riskScore
        }).catch(error => console.error('[NOTIFY]', error.message));
    }

    return { alertCreated: true, alertId };
}

async function createLegacyAlertIfNeeded({ articleId, analysis }) {
    if (analysis.risk_score < RISK_THRESHOLD || !analysis.alert_topic) {
        return {
            alertCreated: false,
            alertId: null
        };
    }

    const duplicateAlert = await alertRepository.findRecentByTopic(analysis.alert_topic);
    if (duplicateAlert) {
        return {
            alertCreated: false,
            alertId: null
        };
    }

    const alertId = await alertRepository.createLegacyAlert({
        articleId,
        topic: analysis.alert_topic,
        message: analysis.alert_message || analysis.summary || "위험 기사 감지",
        riskScore: analysis.risk_score
    });

    return {
        alertCreated: true,
        alertId
    };
}

module.exports = {
    createClusterAlertIfNeeded,
    createLegacyAlertIfNeeded
};
