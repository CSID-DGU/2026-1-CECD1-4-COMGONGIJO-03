import { useEffect, useMemo, useRef, useState } from "react";
import DashboardPage from "./pages/DashboardPage";
import RiskyArticlesPage from "./pages/RiskyArticlesPage";
import AlertsPage from "./pages/AlertsPage";
import { getAlerts } from "./services/articles";

const navItems = [
  { id: "dashboard", label: "기사 목록" },
  { id: "risky", label: "위험 기사" },
  { id: "alerts", label: "알림" }
];

const ALERT_CHECK_INTERVAL_MS = 5000;
const PAGE_REFRESH_INTERVAL_MS = 30000;

function formatToastTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isUserTyping() {
  const activeElement = document.activeElement;

  if (!activeElement) return false;

  const tagName = activeElement.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    activeElement.isContentEditable
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [toastAlerts, setToastAlerts] = useState([]);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);

  const knownAlertIdsRef = useRef(new Set());
  const initializedRef = useRef(false);

  const pageTitle = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label || "기사 목록",
    [activePage]
  );

  const removeToast = (toastId) => {
    setToastAlerts((prevToasts) =>
      prevToasts.filter((toast) => toast.toastId !== toastId)
    );
  };

  useEffect(() => {
    let isMounted = true;

    const checkNewAlerts = async () => {
      try {
        const response = await getAlerts();
        const alerts = response.data.alerts || [];

        if (!isMounted) return;

        const currentIds = new Set(
          alerts
            .map((alert) => alert.alert_id)
            .filter((alertId) => alertId !== undefined && alertId !== null)
        );

        if (!initializedRef.current) {
          knownAlertIdsRef.current = currentIds;
          initializedRef.current = true;
          return;
        }

        const newAlerts = alerts.filter(
          (alert) =>
            alert.alert_id !== undefined &&
            alert.alert_id !== null &&
            !knownAlertIdsRef.current.has(alert.alert_id)
        );

        if (newAlerts.length > 0) {
          setToastAlerts((prevToasts) => [
            ...newAlerts.map((alert) => ({
              ...alert,
              toastId: `${alert.alert_id}-${Date.now()}`
            })),
            ...prevToasts
          ]);

          newAlerts.forEach((alert) => {
            knownAlertIdsRef.current.add(alert.alert_id);
          });
        }

        knownAlertIdsRef.current = new Set([
          ...knownAlertIdsRef.current,
          ...currentIds
        ]);
      } catch (error) {
        console.error("알림 확인 실패:", error);
      }
    };

    checkNewAlerts();

    const intervalId = window.setInterval(
      checkNewAlerts,
      ALERT_CHECK_INTERVAL_MS
    );

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (isUserTyping()) return;

      setPageRefreshKey((prevKey) => prevKey + 1);
    }, PAGE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (toastAlerts.length === 0) return undefined;

    const timeoutIds = toastAlerts.map((toast) =>
      window.setTimeout(() => {
        removeToast(toast.toastId);
      }, 7000)
    );

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [toastAlerts]);

  return (
    <div className="appShell">
      <header className="appHeader">
        <div>
          <span className="eyebrow">backend API 연결</span>
          <h1>{pageTitle}</h1>
        </div>
        <nav className="topNav" aria-label="주요 화면">
          {navItems.map((item) => (
            <button
              className={activePage === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {activePage === "dashboard" && (
          <DashboardPage key={`dashboard-${pageRefreshKey}`} />
        )}
        {activePage === "risky" && (
          <RiskyArticlesPage key={`risky-${pageRefreshKey}`} />
        )}
        {activePage === "alerts" && (
          <AlertsPage key={`alerts-${pageRefreshKey}`} />
        )}
      </main>

      <div className="toastContainer" aria-live="polite" aria-label="새 알림">
        {toastAlerts.map((alert) => (
          <section className="toastAlert" key={alert.toastId}>
            <div className="toastAlertHeader">
              <span className="eyebrow">새 위험 알림</span>
              <button
                className="toastCloseButton"
                type="button"
                aria-label="알림 닫기"
                onClick={() => removeToast(alert.toastId)}
              >
                ×
              </button>
            </div>

            <h3>{alert.alert_topic || alert.title || "알림 제목 없음"}</h3>
            <p>{alert.alert_message || "위험 기사 알림이 생성되었습니다."}</p>

            <dl className="toastAlertMeta">
              <div>
                <dt>risk_score</dt>
                <dd>{Number(alert.risk_score || 0).toFixed(2)}</dd>
              </div>
              <div>
                <dt>created</dt>
                <dd>{formatToastTime(alert.created_at)}</dd>
              </div>
            </dl>

            {alert.url && (
              <a href={alert.url} target="_blank" rel="noreferrer">
                원문 열기
              </a>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}