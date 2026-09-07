const alertRepository = require("../repositories/alertRepository");

const RISK_THRESHOLD = 0.6;

async function createClusterAlertIfNeeded({ articleId, clusterId, analysis, riskScore }) {
    if (riskScore < RISK_THRESHOLD || !analysis.alert_topic) {
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
