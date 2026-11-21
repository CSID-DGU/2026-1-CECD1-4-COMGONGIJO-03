const express = require("express");
const articleController = require("../controllers/articleController");
const riskFeedbackController =
    require("../controllers/riskFeedbackController");

const impactController = require("../controllers/impactController");

const router = express.Router();

router.post("/", articleController.createArticle);
router.post("/:article_id/analysis", articleController.saveAnalysis);

router.get("/by-url/search", articleController.getArticleByUrl);
router.get("/analyzed/list", articleController.getAnalyzedArticles);
router.get("/risky/list", articleController.getRiskyArticles);
router.get("/spam", articleController.getSpamArticles);
router.get("/", articleController.getArticles);
router.get(
    "/:article_id/risk-feedback",
    riskFeedbackController.get
);
router.put(
    "/:article_id/risk-feedback",
    riskFeedbackController.put
);
router.get("/:article_id/impact-feedback", impactController.getFeedback);
router.put("/:article_id/impact-feedback", impactController.putFeedback);
router.get("/:article_id", articleController.getArticleById);

// 스팸기사 전환 및 복구
router.patch("/:articleId/spam", articleController.moveArticleToSpam);
router.patch("/:articleId/restore", articleController.restoreArticleFromSpam);

module.exports = router;
