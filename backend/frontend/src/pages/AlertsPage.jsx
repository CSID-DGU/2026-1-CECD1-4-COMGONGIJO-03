import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import LoadingState from "../components/LoadingState";
import SampleModeBanner from "../components/SampleModeBanner";
import { getAlerts } from "../services/articles";
import { sampleAlerts } from "../services/sampleData";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
}

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || "알 수 없는 오류가 발생했습니다.";
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sampleMode, setSampleMode] = useState(false);
  const [sampleReason, setSampleReason] = useState("");

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const response = await getAlerts();
      setAlerts(response.data.alerts || []);
      setSampleMode(false);
      setSampleReason("");
    } catch (requestError) {
      setAlerts(sampleAlerts);
      setSampleMode(true);
      setSampleReason(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  if (loading) return <LoadingState label="알림 목록을 불러오는 중입니다." />;

  return (
    <div className="pageStack">
      {sampleMode && <SampleModeBanner message={sampleReason} />}

      <section className="alertHeader">
        <div>
          <span className="eyebrow">GET /api/alerts</span>
          <h2>알림 목록</h2>
        </div>
        <button type="button" onClick={loadAlerts}>
          새로고침
        </button>
      </section>

      {!alerts.length ? (
        <EmptyState title="생성된 알림이 없습니다." />
      ) : (
        <div className="alertList">
          {alerts.map((alert) => (
            <article className="alertItem" key={alert.alert_id}>
              <div>
                <span className="eyebrow">alert_id {alert.alert_id}</span>
                <h3>{alert.alert_topic || alert.title || "알림 제목 없음"}</h3>
                <p>{alert.alert_message || "알림 메시지가 없습니다."}</p>
              </div>
              <dl>
                <div>
                  <dt>article_id</dt>
                  <dd>{alert.article_id}</dd>
                </div>
                <div>
                  <dt>risk_score</dt>
                  <dd>{Number(alert.risk_score || 0).toFixed(2)}</dd>
                </div>
                <div>
                  <dt>alert_status</dt>
                  <dd>{alert.alert_status || "-"}</dd>
                </div>
                <div>
                  <dt>created_at</dt>
                  <dd>{formatDateTime(alert.created_at)}</dd>
                </div>
                <div>
                  <dt>source</dt>
                  <dd>{alert.source || "-"}</dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd>
                    {alert.url ? (
                      <a href={alert.url} target="_blank" rel="noreferrer">
                        원문 열기
                      </a>
                    ) : (
                      "-"
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
