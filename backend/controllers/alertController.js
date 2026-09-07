const alertRepository = require("../repositories/alertRepository");

async function getAlerts(req, res) {
    try {
        const alerts = await alertRepository.findAll();
        return res.json({
            success: true,
            count: alerts.length,
            alerts
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: "알림 조회 실패"
        });
    }
}

module.exports = {
    getAlerts
};
