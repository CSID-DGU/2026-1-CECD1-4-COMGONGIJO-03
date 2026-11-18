
const alertRepository = require("../repositories/alertRepository");
const { notifyRiskAlert } = require("./notifyService");

const RISK_THRESHOLD = 0.6;

async function createClusterAlertIfNeeded({ articleId, clusterId, analysis, riskScore }) {
    if (
    analysis.target_related !== true ||
    clusterId == null ||
    riskScore < RISK_THRESHOLD ||
    !analysis.alert_topic
    ) {
        return {
            alertCreated: false,
            alertId: null
        };
    } 
    
    const existingAlert = await alertRepository.findByClusterId(clusterId);
    if (existingAlert) {
        return {
            alertCreated: false,
            alertId: existingAlert.alert_id
        };
    }

    const alertId = await alertRepository.createClusterAlert({
        articleId,
        clusterId,
        topic: analysis.alert_topic,
        message: analysis.alert_message || analysis.summary || "위험 기사 감지",
        riskScore
    });

    // DB 알림 생성은 유지하고 외부 푸시 전송은 비동기로 처리합니다.
    notifyRiskAlert({
        alert_id: alertId,
        article_id: articleId,
        alert_topic: analysis.alert_topic,
        alert_message: analysis.alert_message || analysis.summary,
        risk_score: riskScore
    }).catch((error) => console.error("[NOTIFY]", error.message));

    return {
        alertCreated: true,
        alertId
    };
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
