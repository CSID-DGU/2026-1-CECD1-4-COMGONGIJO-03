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

    const message = analysis.alert_message || analysis.summary || "위험 기사 감지";
    const result = await alertRepository.createClusterAlertOnce({
        articleId,
        clusterId,
        topic: analysis.alert_topic,
        message,
        riskScore
    });

    if (result.alertCreated) {
        notifyRiskAlert({
            alert_id: result.alertId,
            article_id: articleId,
            alert_topic: analysis.alert_topic,
            alert_message: message,
            risk_score: riskScore
        }).catch((error) => console.error("[NOTIFY]", error.message));
    }

    return result;
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
