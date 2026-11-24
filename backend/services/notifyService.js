// 위험 기사 모바일 알림 (ntfy)
//
// ntfy 는 "토픽(채널 이름)"으로 메시지를 보내면, 휴대폰 ntfy 앱에서 같은 토픽을
// 구독한 사람에게 푸시 알림이 가는 무료 서비스입니다. (https://ntfy.sh)
//
// 환경변수 (backend/.env)
//   NTFY_TOPIC      필수. 알림 채널 이름 (남이 추측하기 어렵게. 예: comgongijo-risk-8f3k2)
//   NTFY_SERVER     선택. 기본 https://ntfy.sh
//   NTFY_TOKEN      선택. 접근 제한 토픽을 쓸 때의 액세스 토큰
//   DASHBOARD_URL   선택. 알림을 눌렀을 때 열 대시보드 주소 (휴대폰에서 열 수 있는 https 주소일 때만 사용)

const db = require("../db");

const NTFY_SERVER = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const NTFY_TOKEN = process.env.NTFY_TOKEN || "";
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "").replace(/\/$/, "");

function isEnabled() {
    return Boolean(NTFY_TOPIC);
}

// localhost 주소는 휴대폰에서 열 수 없으므로 링크로 쓰지 않음
function isPublicUrl(url) {
    return /^https?:\/\//.test(url || "") && !/localhost|127\.0\.0\.1/.test(url);
}

function riskLevel(score) {
    if (score >= 0.85) return { label: "심각", emoji: "🔴", priority: 5 };
    if (score >= 0.7) return { label: "위험", emoji: "🟠", priority: 4 };
    return { label: "주의", emoji: "🟡", priority: 3 };
}

/**
 * @param {object} alert { article_id, alert_topic, alert_message, risk_score, title, source, url }
 */
function buildMessage(alert) {
    const level = riskLevel(Number(alert.risk_score) || 0);
    const newCluster = alert.notification_type === "new_cluster";
    const dashboardLink = DASHBOARD_URL ? `${DASHBOARD_URL}/?page=alerts&article=${alert.article_id}` : "";
    const lines = [
        `${alert.source ? `[${alert.source}] ` : ""}${alert.title || ""}`.trim(),
        alert.alert_message || "",
        `위험도 ${(Number(alert.risk_score) || 0).toFixed(2)}`,
    ].filter(Boolean);

    const actions = [];
    if (isPublicUrl(alert.url)) actions.push({ action: "view", label: "원문 기사", url: alert.url });

    return {
        topic: NTFY_TOPIC,
        title: newCluster
            ? `🆕 [신규 클러스터] ${alert.alert_topic || "새 사건 감지"}`
            : `${level.emoji} [${level.label}] ${alert.alert_topic || "위험 기사 감지"}`,
        message: lines.join("\n").slice(0, 1000),
        priority: newCluster ? 3 : level.priority,
        tags: ["rotating_light"],
        ...(isPublicUrl(dashboardLink) ? { click: dashboardLink } : {}),
        ...(actions.length ? { actions } : {}),
    };
}

async function sendNtfy(payload) {
    // 한글 제목이 깨지지 않도록 헤더 방식이 아닌 JSON 방식으로 발송
    const res = await fetch(NTFY_SERVER, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(NTFY_TOKEN ? { Authorization: `Bearer ${NTFY_TOKEN}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ntfy 발송 실패 (HTTP ${res.status}) ${text.slice(0, 200)}`);
    }
    return { ok: true };
}

/**
 * 위험 알림 1건 발송 후 alerts.alert_status 를 sent / failed 로 갱신합니다.
 * alertService 에서 await 없이 호출합니다 (분석 처리가 늦어지지 않도록).
 */
async function notifyRiskAlert(alert) {
    if (!isEnabled()) return { skipped: true };

    // 제목/언론사/URL 이 없으면 articles 테이블에서 채움
    if (!alert.title && alert.article_id) {
        const [rows] = await db.query(
            "SELECT title, source, url FROM articles WHERE article_id = ?",
            [alert.article_id]
        );
        if (rows[0]) alert = { ...alert, ...rows[0] };
    }

    let status = "sent";
    try {
        await sendNtfy(buildMessage(alert));
        console.log(`[NOTIFY] alert ${alert.alert_id} 발송 완료`);
    } catch (err) {
        status = "failed";
        console.error(`[NOTIFY] alert ${alert.alert_id} 발송 실패:`, err.message);
    }

    if (alert.alert_id) {
        await db.query("UPDATE alerts SET alert_status = ? WHERE alert_id = ?", [status, alert.alert_id]);
    }
    return { ok: status === "sent" };
}

/** 테스트 알림 (DB 를 사용하지 않음) */
async function sendTestNotification() {
    if (!isEnabled()) {
        throw new Error("NTFY_TOPIC 이 설정되지 않았습니다. backend/.env 에 NTFY_TOPIC=토픽이름 을 추가하고 서버를 다시 실행하세요.");
    }
    return sendNtfy(
        buildMessage({
            article_id: 0,
            alert_topic: "테스트 알림",
            alert_message: "모바일 알림이 정상적으로 수신되는지 확인합니다.",
            risk_score: 0.9,
            title: "[테스트] 지하철 2호선 운행 중단 사고",
            source: "테스트뉴스",
        })
    );
}

function getStatus() {
    return {
        enabled: isEnabled(),
        server: NTFY_SERVER,
        topic: NTFY_TOPIC || null,
        dashboardUrl: DASHBOARD_URL || null,
        dashboardLinkEnabled: isPublicUrl(DASHBOARD_URL),
    };
}

module.exports = {
    notifyRiskAlert,
    sendTestNotification,
    getStatus,
    buildMessage,
    riskLevel,
};
