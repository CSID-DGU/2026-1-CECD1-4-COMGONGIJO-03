import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";

const SETUP_STEPS = [
  "휴대폰에 ntfy 앱 설치 (Play 스토어 / App Store 에서 'ntfy' 검색)",
  "앱에서 + 버튼 → 토픽 이름 입력 → Subscribe (서버 주소는 기본값 그대로)",
  "backend/.env 에 NTFY_TOPIC=토픽이름 추가 (앱에 입력한 이름과 똑같이)",
  "서버를 다시 실행 (npm run dev 를 껐다가 다시 실행)"
];

function errorMessage(err) {
  const code = err?.response?.status;
  if (code === 404) return "백엔드 서버가 예전 버전입니다. 서버를 종료하고 다시 실행하세요.";
  if (code) return err?.response?.data?.message || `서버 오류 (HTTP ${code})`;
  return "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.";
}

export default function NotifySettingsPage() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const load = async () => {
    try {
      const { data } = await apiClient.get("/notify/status");
      setStatus(data);
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sendTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data } = await apiClient.post("/notify/test");
      setResult({ ok: true, text: data.message });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    }
    setSending(false);
  };

  return (
    <div className="pageStack cwPage">
      <section className="cwPanel">
        <div className="cwPanelHead">
          <div>
            <span className="eyebrow">동작 방식</span>
            <h2>위험 기사가 휴대폰 알림이 되기까지</h2>
          </div>
        </div>
        <ol className="cwFlow">
          <li><strong>뉴스 수집</strong><span>'저장 + AI 분석' 또는 자동 수집</span></li>
          <li><strong>AI 위험도 분석</strong><span>기사별 위험도 계산</span></li>
          <li><strong>위험 알림 생성</strong><span>위험도 0.6 이상 · 같은 사건은 1번만</span></li>
          <li><strong>휴대폰 알림</strong><span>ntfy 앱으로 푸시</span></li>
        </ol>
      </section>

      {loadError && <div className="cwMessage cwMessage-error">{loadError}</div>}

      <section className="cwPanel">
        <div className="cwPanelHead">
          <div>
            <span className="eyebrow">STEP 1</span>
            <h2>ntfy 연결 상태</h2>
          </div>
          <button type="button" className="secondaryButton" onClick={load}>상태 새로고침</button>
        </div>

        <article className={`cwChannel ${status?.enabled ? "on" : ""}`}>
          <div className="cwChannelHead">
            <h3>ntfy 앱 알림</h3>
            <span className={`cwBadge ${status?.enabled ? "cwFull" : "cwOff"}`}>
              {status ? (status.enabled ? "연결됨" : "미설정") : "확인 중"}
            </span>
          </div>

          {status?.enabled ? (
            <>
              <p>
                토픽 <code className="cwCode">{status.topic}</code> 을(를) 구독한 휴대폰으로 위험 기사 알림이 발송됩니다.
              </p>
              <p className="cwNote">
                서버 {status.server} ·{" "}
                <a href={`${status.server}/${status.topic}`} target="_blank" rel="noreferrer">웹에서 받은 알림 보기 ↗</a>
              </p>
            </>
          ) : (
            <>
              <p>아직 토픽이 설정되지 않았습니다. 아래 순서대로 설정하세요.</p>
              <ol className="cwSteps">{SETUP_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            </>
          )}
        </article>

        {status?.enabled && !status.dashboardLinkEnabled && (
          <p className="cwNote">
            ℹ 알림을 눌렀을 때 대시보드가 열리게 하려면 휴대폰에서 접속 가능한 https 주소를 .env 의 DASHBOARD_URL 에 넣으세요. (없어도 알림 수신은 정상)
          </p>
        )}
      </section>

      <section className="cwPanel">
        {status?.enabled && !status.testEnabled && (
          <p className="cwNote">전용 테스트 환경에서 NTFY_TEST_ENABLED=true를 설정하면 테스트 알림을 보낼 수 있습니다.</p>
        )}
        <div className="cwPanelHead">
          <div>
            <span className="eyebrow">STEP 2</span>
            <h2>테스트 알림 보내기</h2>
          </div>
          <p className="cwHint">가짜 위험 기사 알림을 보냅니다. DB나 AI 분석 없이 바로 확인할 수 있어요.</p>
        </div>
        <div className="cwActions">
          <button type="button" className="cwStart" disabled={sending || !status?.testEnabled} onClick={sendTest}>
            {sending ? "보내는 중…" : "📨 테스트 알림 보내기"}
          </button>
          {status && !status.enabled && <span className="cwHint">STEP 1 설정 후 사용할 수 있습니다.</span>}
        </div>
        {result && (
          <div className={`cwMessage cwMessage-${result.ok ? "success" : "error"}`}>
            {result.ok ? `${result.text} 휴대폰에 🔴 [심각] 테스트 알림이 왔는지 확인하세요.` : result.text}
          </div>
        )}
      </section>
    </div>
  );
}
