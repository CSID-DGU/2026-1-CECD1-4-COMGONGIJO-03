import EmptyState from "./EmptyState";

function formatDate(value) {
  if (!value) return "날짜 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function getDateKey(article) {
  return formatDate(article.published_at || article.collected_at || article.analyzed_at);
}

function scoreLabel(score) {
  if (score === null || score === undefined || score === "") return "-";
  const number = Number(score);
  if (Number.isNaN(number)) return score;
  return number.toFixed(2);
}

export default function ArticleList({ articles, selectedArticleId, onSelect }) {
  if (!articles.length) {
    return (
      <EmptyState
        title="조건에 맞는 기사가 없습니다."
        description="검색어 또는 필터를 조정해 보세요."
      />
    );
  }

  const grouped = articles.reduce((groups, article) => {
    const dateKey = getDateKey(article);
    groups[dateKey] = groups[dateKey] || [];
    groups[dateKey].push(article);
    return groups;
  }, {});

  return (
    <div className="articleGroups">
      {Object.entries(grouped).map(([date, items]) => (
        <section className="dateGroup" key={date}>
          <div className="dateHeader">
            <h2>{date}</h2>
            <span>{items.length}건</span>
          </div>

          <div className="articleList">
            {items.map((article) => (
              <button
                className={`articleItem ${
                  selectedArticleId === article.article_id ? "isSelected" : ""
                }`}
                key={`${article.article_id}-${article.analysis_id || "raw"}`}
                type="button"
                onClick={() => onSelect(article)}
              >
                <div className="articleMain">
                  <strong>{article.title || "제목 없음"}</strong>
                  <p>{article.summary || article.content || "본문 또는 요약이 없습니다."}</p>
                </div>
                <div className="articleMeta">
                  <span>{article.source || "출처 없음"}</span>
                  <span>{article.sentiment_label || "분석 전"}</span>
                  <span>risk_score {scoreLabel(article.risk_score)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
