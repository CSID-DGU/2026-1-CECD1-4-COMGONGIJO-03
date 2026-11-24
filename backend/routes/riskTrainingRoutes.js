const express = require("express");
const training = require("../services/riskWeightTrainingService");

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        res.json(await training.getStatus());
    } catch (error) {
        console.error("Risk weight status:", error.message);
        res.status(500).json({ message: "위험도 학습 상태를 불러오지 못했습니다." });
    }
});

router.post("/", async (req, res) => {
    if (process.env.DB_NAME === "news_test_db") {
        return res.status(409).json({ message: "평가 DB는 기존 지표 보정 모델을 사용합니다." });
    }
    try {
        const report = await training.train();
        if (!report) return res.status(409).json({ message: "이미 가중치 학습이 진행 중입니다." });
        return res.json(report);
    } catch (error) {
        console.error("Risk weight training:", error.message);
        return res.status(500).json({ message: "학습을 완료하지 못했습니다. 학습 상태를 새로고침하세요." });
    }
});

module.exports = router;
