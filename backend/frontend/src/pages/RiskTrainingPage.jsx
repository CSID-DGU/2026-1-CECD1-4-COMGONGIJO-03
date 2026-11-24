import { useEffect, useState } from "react";
import { formatRiskValue, riskFactorLabels } from "../config/riskFactors";
import { getRiskTraining, runRiskTraining } from "../services/articles";

export default function RiskTrainingPage() {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const { data } = await getRiskTraining();
      setStatus(data);
      setResult(data.lastRun);
    } finally {
      setLoading(false);
    }
  }

  function load() {
    setError("");
    refresh().catch(() => setError("학습 상태를 불러오지 못했습니다."));
  }

  useEffect(load, []);

  async function train() {
    if (training || !status?.ready || status.running) return;
    setTraining(true);
    setError("");
    try {
      const { data } = await runRiskTraining();
      setResult(data);
      await refresh();
    } catch (error) {
      setError(error.response?.data?.message || "학습 결과를 확인하지 못했습니다. 상태를 새로고침하세요.");
    } finally {
      setTraining(false);
    }
  }

  const resultMessage = result?.applied ? "후보 가중치 적용 완료"
    : result?.reason === "insufficient_data" ? "학습 보류 · 피드백 또는 독립 사건 부족"
      : "기존 가중치 유지 · 검증 오차 개선 기준 미달";

  return (
    <div className="pageStack">
      <section className="riskFeedbackPanel">
        <h2>위험도 가중치 학습</h2>
        <p>담당자가 입력한 전체 위험도로 가중치를 조정합니다. 승인된 모델은 새 분석부터 적용됩니다.</p>
        <div className="detailTopControls">
          <button type="button" className="secondaryButton" onClick={load} disabled={loading || training}>새로고침</button>
          <button type="button" className="primaryButton" onClick={train}
            disabled={loading || training || !status?.ready || status.running}>
            {training || status?.running ? "학습 중…" : "가중치 학습 실행"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {status && (
          <>
            <dl className="detailGrid">
              <div><dt>유효 피드백</dt><dd>{status.feedbackCount}건 / 최소 {status.settings.minFeedback}건</dd></div>
              <div><dt>독립 사건</dt><dd>{status.eventCount}개 / 최소 {status.settings.minEvents}개</dd></div>
              <div><dt>학습 사건</dt><dd>{status.trainingEventCount}개 / 최소 5개</dd></div>
              <div><dt>검증 사건</dt><dd>{status.validationEventCount}개 / 최소 {status.settings.minValidationEvents}개</dd></div>
              <div><dt>적용에 필요한 MAE 개선</dt><dd>{formatRiskValue(status.settings.minimumImprovement, 3)}</dd></div>
              <div><dt>현재 모델</dt><dd>{status.activeVersion}</dd></div>
            </dl>
            {!status.ready && <p role="status">학습을 시작하려면 피드백과 독립 사건을 더 확보해야 합니다.</p>}
          </>
        )}
      </section>
      {result && (
        <section className="riskFeedbackPanel" aria-live="polite">
          <h2>최근 학습 결과</h2>
          <p><strong>{resultMessage}</strong></p>
          <dl className="detailGrid">
            <div><dt>피드백 / 독립 사건</dt><dd>{result.feedbackCount}건 / {result.eventCount}개</dd></div>
            <div><dt>학습 / 검증 사건</dt><dd>{result.trainingEventCount}개 / {result.validationEventCount}개</dd></div>
            <div><dt>검증 피드백</dt><dd>{result.validationFeedbackCount}건</dd></div>
            <div><dt>기존 모델 MAE</dt><dd>{formatRiskValue(result.previousMae, 4)}</dd></div>
            <div><dt>후보 모델 MAE</dt><dd>{formatRiskValue(result.candidateMae, 4)}</dd></div>
            <div><dt>MAE 감소</dt><dd>{formatRiskValue(result.improvement, 4)}</dd></div>
            <div><dt>기존 모델</dt><dd>{result.previousVersion}</dd></div>
            <div><dt>후보 모델</dt><dd>{result.candidateVersion || "—"}</dd></div>
          </dl>
          {result.candidateWeights && (
            <dl className="detailGrid" aria-label="가중치 변경">
              {Object.entries(riskFactorLabels).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{formatRiskValue(result.previousWeights[key], 4)} → {formatRiskValue(result.candidateWeights[key], 4)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
    </div>
  );
}
