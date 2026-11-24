import { useEffect, useState } from "react";
import { formatRiskValue, riskFactorLabels } from "../config/riskFactors";
import { getRiskFeedback, putRiskFeedback } from "../services/articles";

export default function RiskFeedbackPanel({ article, disabled = false }) {
  const [feedback, setFeedback] = useState(null);
  const [overall, setOverall] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const { article_id: articleId, analysis_id: analysisId } = article;

  useEffect(() => {
    if (!analysisId || disabled) return;
    let active = true;
    getRiskFeedback(articleId).then(({ data }) => {
      if (active) {
        setFeedback(data);
        setOverall(data.overall_label ?? "");
      }
    }).catch(() => {
      if (active) setMessage("피드백 정보를 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [articleId, analysisId, disabled]);

  if (!analysisId) return null;
  const raw = feedback?.raw_factors || article;

  async function save(event) {
    event.preventDefault();
    if (overall === "" || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const { data } = await putRiskFeedback(articleId, {
        overall_label: Number(overall), analysis_id: analysisId
      });
      setFeedback(data);
      setOverall(data.overall_label);
      setMessage("전체 위험도 평가를 저장했습니다.");
    } catch (error) {
      setMessage(error.response?.data?.message || "위험도 평가 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="riskFeedbackPanel">
      <h3>위험도 평가</h3>
      <p>AI 위험도 <strong>{formatRiskValue(article.risk_score)}</strong>
        {article.risk_model_version && <> · 모델 {article.risk_model_version}</>}
      </p>
      <dl className="detailGrid">
        {Object.entries(riskFactorLabels).map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd>{formatRiskValue(raw[key])}</dd></div>
        ))}
      </dl>
      {article.risk_factor_reason && <p>{article.risk_factor_reason}</p>}
      {!disabled && feedback?.eligible && (
        <form className="riskOverallForm" onSubmit={save}>
          <label>
            담당자가 평가한 전체 위험도
            <input type="number" min="0" max="1" step="0.1" required value={overall}
              onChange={event => setOverall(event.target.value)} disabled={saving} />
          </label>
          <button className="primaryButton" type="submit" disabled={saving || overall === ""}>
            {saving ? "저장 중…" : "전체 위험도 저장"}
          </button>
        </form>
      )}
      {!disabled && feedback && !feedback.eligible && (
        <p>사건에 속한 분석 완료 기사에서 전체 위험도를 평가할 수 있습니다.</p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
