const db = require("../db");

async function findByClusterId(clusterId) {
    const [rows] = await db.query(
        `
        SELECT alert_id
        FROM alerts
        WHERE cluster_id = ?
        LIMIT 1
        `,
        [clusterId]
    );

    return rows[0] || null;
}

async function createClusterAlert({ articleId, clusterId, topic, message, riskScore }) {
    const [result] = await db.query(
        `
        INSERT INTO alerts
        (article_id, cluster_id, alert_topic, alert_message, risk_score, alert_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'created', NOW())
        `,
        [articleId, clusterId, topic, message, riskScore]
    );

    return result.insertId;
}

async function findRecentByTopic(topic) {
    const [rows] = await db.query(
        `
        SELECT alert_id
        FROM alerts
        WHERE alert_topic = ?
        AND created_at >= NOW() - INTERVAL 1 HOUR
        LIMIT 1
        `,
        [topic]
    );

    return rows[0] || null;
}

async function createLegacyAlert({ articleId, topic, message, riskScore }) {
    const [result] = await db.query(
        `
        INSERT INTO alerts
        (article_id, alert_topic, alert_message, risk_score, alert_status, created_at)
        VALUES (?, ?, ?, ?, 'created', NOW())
        `,
        [articleId, topic, message, riskScore]
    );

    return result.insertId;
}

async function findAll() {
    const [rows] = await db.query(
        `
        SELECT
            al.alert_id,
            al.article_id,
            al.cluster_id,
            al.alert_topic,
            al.alert_message,
            al.risk_score,
            al.alert_status,
            al.created_at,
            a.title,
            a.url,
            a.source
        FROM alerts al
        INNER JOIN articles a
            ON al.article_id = a.article_id
        ORDER BY al.created_at DESC
        `
    );

    return rows;
}

module.exports = {
    findByClusterId,
    createClusterAlert,
    findRecentByTopic,
    createLegacyAlert,
    findAll
};
