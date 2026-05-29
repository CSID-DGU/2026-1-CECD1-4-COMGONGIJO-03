import EmptyState from "./EmptyState";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(value)];
  } catch {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function scoreLabel(score) {
  if (score === null || score === undefined || score === "") return "-";
  const number = Number(score);
  if (Number.isNaN(number)) return score;
  return number.toFixed(2);
}

export default function ArticleDetailPanel({ article, hasAlert }) {
  if (!article) {
    return (
      <section className="detailPanel">
        <EmptyState
          title="기사를 선택하세요."
          description="목록에서 기사를 선택하면 상세 화면으로 이동합니다."
        />
      </section>
    );
  }

  const keywords = normalizeList(article.event_keywords);
  const entities = normalizeList(article.event_entities);

  return (
    <section className="detailPanel">
      <div className="detailHeader">
        <span className="eyebrow">article_id {article.article_id}</span>
        <h2>{article.title || "제목 없음"}</h2>
      </div>

      <div className="detailSummary">
        <p>{article.summary || article.content || "본문 또는 요약이 없습니다."}</p>
      </div>

      <dl className="detailGrid">
        <div>
          <dt>URL</dt>
          <dd>
            {article.url ? (
              <a href={article.url} target="_blank" rel="noreferrer">
                {article.url}
              </a>
            ) : (
              "-"
            )}
          </dd>
        </div>
        <div>
          <dt>출처</dt>
          <dd>{article.source || "-"}</dd>
        </div>
        <div>
          <dt>작성자</dt>
          <dd>{article.author || "-"}</dd>
        </div>
        <div>
          <dt>발행일</dt>
          <dd>{formatDateTime(article.published_at)}</dd>
        </div>
        <div>
          <dt>감성 분석 결과</dt>
          <dd>{article.sentiment_label || "-"}</dd>
        </div>
        <div>
          <dt>위험도 점수</dt>
          <dd>{scoreLabel(article.risk_score)}</dd>
        </div>
        <div>
          <dt>이슈 유형</dt>
          <dd>{article.issue_type || "-"}</dd>
        </div>
        <div>
          <dt>이벤트명</dt>
          <dd>{article.event_name || "-"}</dd>
        </div>
        <div>
          <dt>이벤트 위치</dt>
          <dd>{article.event_location || "-"}</dd>
        </div>
        <div>
          <dt>알림 여부</dt>
          <dd>{hasAlert ? "알림 생성됨" : "알림 없음"}</dd>
        </div>
      </dl>

      <div className="chipsBlock">
        <h3>키워드</h3>
        <div className="chips">
          {keywords.length ? keywords.map((keyword) => <span key={keyword}>{keyword}</span>) : <span>-</span>}
        </div>
      </div>

      <div className="chipsBlock">
        <h3>관련 엔티티</h3>
        <div className="chips">
          {entities.length ? entities.map((entity) => <span key={entity}>{entity}</span>) : <span>-</span>}
        </div>
      </div>
    </section>
  );
}
