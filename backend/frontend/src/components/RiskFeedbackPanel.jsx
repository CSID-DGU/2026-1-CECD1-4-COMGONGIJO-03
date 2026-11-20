import { useEffect, useState } from "react";
import {
  getRiskFeedback,
  putRiskFeedback
} from "../services/articles";

const LABELS = {
  issue_severity: "사건 심각도",
  target_responsibility: "귀책성",
  norm_violation: "규범위반성",
  similar_crisis_history: "유사위기이력"
};

const roundStep = value =>
  Math.round(
    Math.min(1, Math.max(0, value)) * 10
  ) / 10;

const fmt = value =>
  value == null ? "-" : Number(value).toFixed(2);

export default function RiskFeedbackPanel({
  article,
  disabled = false
}) {
  const [data, setData] = useState(null);
  const [labels, setLabels] = useState({});
  const [overall, setOverall] = useState(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    setData(null);
    setStatus("");

    if (
      !article?.article_id ||
      !article.analysis_id ||
      disabled
    ) {
      return;
    }

    getRiskFeedback(article.article_id)
      .then(({ data: payload }) => {
        if (!active) return;

        setData(payload);
        setLabels(payload.factor_labels || {});
        setOverall(payload.overall_label ?? null);
      })
      .catch(() => {
        if (active) {
          setStatus("피드백 정보를 불러오지 못했습니다.");
        }
      });

    return () => {
      active = false;
    };
  }, [
    article?.article_id,
    article?.analysis_id,
    disabled
  ]);

  if (!article?.analysis_id || disabled) {
    return null;
  }

  const base = data?.calibrated_factors || {};
  const weights = data?.weights || {};

  const preview = Object.keys(LABELS).reduce(
    (sum, key) =>
      sum +
      Number(weights[key] || 0) *
      Number(labels[key] ?? base[key] ?? 0),
    0
  );

  function adjust(key, delta) {
    setLabels(current => ({
      ...current,
      [key]: roundStep(
        (current[key] ?? roundStep(base[key] ?? 0)) +
        delta
      )
    }));

    setStatus("");
  }

  async function saveFeedback() {
    setSaving(true);
    setStatus("");

    try {
      const response = await putRiskFeedback(
        article.article_id,
        {
          factor_labels: labels,
          overall_label: overall
        }
      );

      setData(response.data);

      setStatus(
        "피드백을 저장했습니다. 모델 학습에는 별도로 반영됩니다."
      );
    } catch (error) {
      setStatus(
        error?.response?.data?.message ||
        "피드백 저장 실패"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="riskFeedbackPanel"
      aria-label="기사 위험도 피드백"
    >
      <h3>위험도 지표별 평가</h3>

      <p className="riskFeedbackHint">
        원본은 LLM 점수, 보정은 현재 모델 점수입니다.
        ± 버튼으로 사람의 정답을 입력할 수 있습니다.
      </p>

      {!data ? (
        <p>
          {status || "피드백 정보를 불러오는 중입니다."}
        </p>
      ) : (
        <>
          <div className="riskFeedbackRows">
            {Object.entries(LABELS).map(
              ([key, name]) => (
                <div
                  className="riskFeedbackRow"
                  key={key}
                >
                  <strong>{name}</strong>

                  <span>
                    원본 {fmt(data.raw_factors[key])}
                    {" / "}
                    보정 {fmt(base[key])}
                  </span>

                  <div className="riskFeedbackActions">
                    <button
                      type="button"
                      onClick={() => adjust(key, -0.1)}
                    >
                      −
                    </button>

                    <span>
                      {labels[key] == null
                        ? "미평가"
                        : fmt(labels[key])}
                    </span>

                    <button
                      type="button"
                      onClick={() => adjust(key, 0.1)}
                    >
                      +
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLabels(current => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        });
                      }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          <div className="riskFeedbackTotals">
            <span>
              현재 모델 위험도:
              {" "}
              <strong>
                {fmt(data.model_score)}
              </strong>
            </span>

            <span>
              지표 수정 시 예상 위험도:
              {" "}
              <strong>
                {fmt(preview)}
              </strong>
            </span>

            <p className="riskFeedbackHint">
              예상 위험도는 기존 가중치로 자동 계산한
              값이며, 가중치 학습의 정답으로
              저장하지 않습니다.
            </p>

            <div className="riskFeedbackRow">
              <strong>
                전체 위험도 정답 (독립 평가)
              </strong>

              <div className="riskFeedbackActions">
                <button
                  type="button"
                  onClick={() =>
                    setOverall(current =>
                      roundStep(
                        (current ??
                          roundStep(data.model_score)) -
                        0.1
                      )
                    )
                  }
                >
                  −
                </button>

                <span>
                  {overall == null
                    ? "미평가"
                    : fmt(overall)}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setOverall(current =>
                      roundStep(
                        (current ??
                          roundStep(data.model_score)) +
                        0.1
                      )
                    )
                  }
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={() => setOverall(null)}
                >
                  취소
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={
              saving ||
              (
                Object.keys(labels).length === 0 &&
                overall == null
              )
            }
            onClick={saveFeedback}
          >
            {saving
              ? "저장 중..."
              : "위험도 피드백 저장"}
          </button>

          {status && (
            <p role="status">{status}</p>
          )}
        </>
      )}
    </section>
  );
}