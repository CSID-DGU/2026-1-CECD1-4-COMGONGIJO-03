const spamRepository = require("../repositories/spamRepository");

/*
 * 스팸기사함 목록 조회
 */
async function getSpamArticles(req, res) {
    try {
        const articles = await spamRepository.findSpamArticles();

        return res.json({
            success: true,
            count: articles.length,
            articles
        });
    } catch (error) {
        console.error("스팸기사함 조회 오류:", error);

        return res.status(500).json({
            success: false,
            message: "스팸기사함 조회에 실패했습니다."
        });
    }
}

module.exports = {
    getSpamArticles
};