// 휴대폰 알림 테스트 (서버, DB, Ollama 없이 실행 가능)
//   cd backend
//   npm run notify:test

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { sendTestNotification, getStatus } = require("../services/notifyService");

(async () => {
    const status = getStatus();
    console.log(`ntfy 서버: ${status.server}`);
    console.log(`토픽: ${status.topic || "(설정 안 됨)"}`);

    try {
        await sendTestNotification();
        console.log("✅ 테스트 알림을 보냈습니다. 휴대폰 ntfy 앱을 확인하세요.");
        process.exit(0);
    } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
})();
