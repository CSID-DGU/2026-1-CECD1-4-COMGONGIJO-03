import { useEffect, useState } from "react";
import {
  getImpactFeedback, putImpactFeedback, getClusterImpact,
  saveClusterImpactSnapshot, confirmClusterImpactSnapshot
} from "../services/articles";

const FIELDS = {
  public_relevance: "대중 관련성",
  title_sensationalism: "제목 자극성",
  media_influence: "언론사 영향력"
};
const format = (value) => value == null ? "미평가" : Number(value).toFixed(2);
const step = (value) => Math.max(0, Math.min(1, Math.round(Number(value) * 10) / 10));

export default function ImpactPanel({ article, disabled = false }) {
  const [feedback, setFeedback] = useState(null);
  const [labels, setLabels] = useState({});
  const [observed, setObserved] = useState(null);
  const [includeLinked, setIncludeLinked] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setFeedback(null); setLabels({}); setObserved(null); setMessage("");
    if (disabled || !article?.analysis_id) return undefined;
    getImpactFeedback(article.article_id)
      .then(({ data }) => { if (active) { setFeedback(data); setLabels(data.factor_labels || {}); } })
      .catch(() => { if (active) setMessage("초기 파급력 피드백을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [article?.article_id, article?.analysis_id, disabled]);

  useEffect(() => {
    let active = true;
    setObserved(null);
    if (disabled || !article?.cluster_id) return undefined;
    getClusterImpact(article.cluster_id, includeLinked)
      .then(({ data }) => { if (active) setObserved(data); })
      .catch(() => { if (active) setMessage("사후 파급력 조회에 실패했습니다."); });
    return () => { active = false; };
  }, [article?.cluster_id, includeLinked, disabled]);

  if (!article?.analysis_id || disabled) return null;

  function adjust(key, amount) {
    setLabels(current => ({
      ...current,
      [key]: step((current[key] ?? (Number.isFinite(Number(article[key])) && article[key] != null ? Number(article[key]) : 0)) + amount)
    }));
  }
  async function saveFeedback() {
    setBusy(true); setMessage("");
    try {
      if (!Object.keys(labels).length) { setMessage("수정한 지표가 없습니다."); return; }
      const { data } = await putImpactFeedback(article.article_id, { factor_labels: labels });
      setFeedback(data);
      setMessage("라벨을 저장했습니다. 대중 관련성과 제목 자극성은 별도 학습 시 반영되며, 언론사 점수는 다음 기사부터 재사용됩니다.");
    } catch (error) { setMessage(error.response?.data?.message || "피드백 저장 실패"); }
    finally { setBusy(false); }
  }
  async function snapshot(confirm = false) {
    if (!article.cluster_id) return;
    setBusy(true); setMessage("");
    try {
      if (confirm) {
        const acceptEstimated = observed?.metrics?.status === "estimated_review";
        if (acceptEstimated && !window.confirm(
          `발행일자를 추정한 기사가 ${observed.metrics.estimated_dates}건 있습니다. ` +
          "발행일자 및 동일 사건 클러스터 범위를 직접 검토했으며, 추정으로 인한 학습 오차를 감수하고 확정하시겠습니까?"
        )) return;
        await confirmClusterImpactSnapshot(article.cluster_id, includeLinked, acceptEstimated);
        setMessage("직접 검토한 관측값을 학습용으로 확정했습니다.");
      } else {
        await saveClusterImpactSnapshot(article.cluster_id, includeLinked);
        setMessage("관측값 스냅샷을 저장했습니다. 자동 학습에는 사용되지 않습니다.");
      }
      const { data } = await getClusterImpact(article.cluster_id, includeLinked);
      setObserved(data);
    } catch (error) { setMessage(error.response?.data?.message || "사후 관측값 처리 실패"); }
    finally { setBusy(false); }
  }

  const metrics = observed?.metrics;
  return (
    <div className="chipsBlock">
      <h3>파급력 평가</h3>
      <dl className="detailGrid">
        <div><dt>초기 확산규모</dt><dd>{format(article.initial_spread_score)}</dd></div>
        <div><dt>초기 예상 파급력</dt><dd>{format(article.initial_impact_score)}</dd></div>
        <div><dt>대중 관련성</dt><dd>{format(article.public_relevance)}</dd></div>
        <div><dt>제목 자극성</dt><dd>{format(article.title_sensationalism)}</dd></div>
        <div><dt>언론사 영향력</dt><dd>{format(article.media_influence)} ({article.media_influence_origin || "미확인"})</dd></div>
      </dl>
      <h3>초기 지표 라벨링</h3>
      <p>0.1 단위로 수정하며, 수정값은 원본 AI 평가와 별도로 저장됩니다.</p>
      {Object.entries(FIELDS).map(([key, title]) => (
        <div className="detailTopControls" key={key}>
          <span>{title}: {format(labels[key] ?? article[key])}</span>
          <button type="button" className="secondaryButton" disabled={busy}
            onClick={() => adjust(key, -0.1)}>−0.1</button>
          <button type="button" className="secondaryButton" disabled={busy}
            onClick={() => adjust(key, 0.1)}>+0.1</button>
        </div>
      ))}
      <div className="detailTopControls">
        <button className="secondaryButton" type="button" disabled={busy}
          onClick={saveFeedback}>지표 피드백 저장</button>
        {feedback?.preview && (
          <span>라벨 적용 시 초기 파급력: {format(feedback.preview.initial_impact_score)}</span>
        )}
      </div>
      {article.cluster_id && (
        <>
          <h3>사후 파급력 (관측)</h3>
          <label>
            <input type="checkbox" checked={includeLinked}
              onChange={(event) => setIncludeLinked(event.target.checked)}/>
            연결된 동일 사건 후보도 포함 (수동 검토 필요)
          </label>
          {metrics ? (
            <>
              <dl className="detailGrid">
                <div><dt>보도규모</dt><dd>{metrics.counts?.news_count ?? "-"}건</dd></div>
                <div><dt>확산범위</dt><dd>{metrics.counts?.source_count ?? "-"}개 언론사</dd></div>
                <div><dt>지속성</dt><dd>{metrics.counts?.duration_hours == null ? "-" : `${metrics.counts.duration_hours.toFixed(1)}시간`}</dd></div>
                <div><dt>최초 24시간</dt><dd>{metrics.counts?.first_24h_count ?? "-"}건</dd></div>
                <div><dt>사후 확산규모</dt><dd>{format(metrics.observed_spread_score)}</dd></div>
                <div><dt>사후 추정 파급력</dt><dd>{format(metrics.observed_impact_score)}</dd></div>
                <div><dt>관측 상태</dt><dd>{metrics.status}</dd></div>
                <div><dt>발행일자 추정</dt><dd>{metrics.estimated_dates ?? 0}건</dd></div>
                <div><dt>발행일자 미해결</dt><dd>{metrics.unresolved_dates ?? 0}건</dd></div>
                <div><dt>학습 데이터 확인</dt><dd>{observed.confirmed ? "수동 확정" : "미확정"}</dd></div>
              </dl>
              {(metrics.estimated_dates > 0 || metrics.unresolved_dates > 0) && (
                <p>발행일자 누락 {metrics.missing_dates}건 중 {metrics.estimated_dates}건은 같은·연결된 클러스터 또는 탐지 시각으로 임시 계산했습니다. 추정값은 정확한 발행시각이 아니므로 별도 수동 검토가 필요합니다.</p>
              )}
              <p>발행시각·언론사 누락 여부와 실제 보도 수집 범위를 확인한 뒤에만 확정해 주십시오.</p>
              <div className="detailTopControls">
                <button className="secondaryButton" type="button" disabled={busy}
                  onClick={() => snapshot(false)}>사후 값 저장·갱신</button>
                <button className="secondaryButton" type="button"
                  disabled={busy || !["ready_for_review", "estimated_review"].includes(metrics.status)}
                  onClick={() => snapshot(true)}>테스트용 학습 정답 확정</button>
              </div>
            </>
          ) : <p>사후 평가를 조회하는 중입니다.</p>}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
