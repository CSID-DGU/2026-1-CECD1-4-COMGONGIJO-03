const sentimentOptions = [
  { value: "all", label: "전체" },
  { value: "positive", label: "긍정" },
  { value: "negative", label: "부정" },
  { value: "empathy", label: "공감" }
];

export default function Toolbar({
  query,
  setQuery,
  sortOrder,
  setSortOrder,
  sentimentFilter,
  setSentimentFilter,
  onSearch,
  onReset
}) {
  return (
    <form className="sketchToolbar" onSubmit={onSearch}>
      <label className="titleSearch">
        <span>검색</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="제목"
        />
      </label>

      <label className="sortSelect">
        <span>정렬</span>
        <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
          <option value="latest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="riskDesc">위험도 높은순</option>
          <option value="riskAsc">위험도 낮은순</option>
        </select>
      </label>

      <div className="sentimentButtons" aria-label="반응 필터">
        {sentimentOptions.map((option) => (
          <button
            className={sentimentFilter === option.value ? "active" : ""}
            key={option.value}
            type="button"
            onClick={() => setSentimentFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="toolbarActions">
        <button type="submit">검색</button>
        <button className="secondaryButton" type="button" onClick={onReset}>
          초기화
        </button>
      </div>
    </form>
  );
}
