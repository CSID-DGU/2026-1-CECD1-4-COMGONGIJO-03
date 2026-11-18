// 모바일 알림(ntfy) API
//   GET  /api/notify/status   설정 상태 (화면 표시용)
//   POST /api/notify/test     테스트 알림 발송

const express = require("express");
const notifyService = require("../services/notifyService");

const router = express.Router();

router.get("/status", (req, res) => {
    res.json({ success: true, ...notifyService.getStatus() });
});

router.post("/test", async (req, res) => {
    if (!notifyService.getStatus().testEnabled) {
        return res.status(403).json({ success: false, message: "테스트 알림이 비활성화되어 있습니다." });
    }
    try {
        await notifyService.sendTestNotification();
        res.json({ success: true, message: "테스트 알림을 보냈습니다." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
