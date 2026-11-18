import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "../services/apiClient";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const PERIODS = [
  { value: "1h", label: "최근 1시간" },
  { value: "1d", label: "최근 1일" },
  { value: "7d", label: "최근 7일" },
  { value: "", label: "기간 제한 없음" }
];

const INTERVALS = [
  { value: 300, label: "5분마다" },
  { value: 600, label: "10분마다" },
  { value: 1800, label: "30분마다" },
  { value: 3600, label: "1시간마다" }
];

const STATUS = {
  full: { label: "본문 수집", className: "cwFull" },
  partial: { label: "본문 일부", className: "cwPartial" },
  rss_only: { label: "제목·요약만", className: "cwRssOnly" }
};

const SAVE = {
  saved: "저장됨 · AI 분석 대기",
  duplicate: "이미 저장된 기사",
  failed: "저장 실패"
};

const EMPTY_STATS = { total: 0, full: 0, partial: 0, rss_only: 0, saved: 0, duplicate: 0, failed: 0 };

function formatTime(value) {
  if (!value) return "-";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function KeywordInput({ keywords, setKeywords, disabled }) {
  const [text, setText] = useState("");

  const add = () => {
    const parts = text.split(",").map((k) => k.trim()).filter(Boolean);
    if (!parts.length) return;
    setKeywords((prev) => [...new Set([...prev, ...parts])].slice(0, 10));
    setText("");
  };

  return (
    <div className="cwKeywordBox">
      <div className="cwChips">
        {keywords.map((k) => (
          <span className="cwChip" key={k}>
            {k}
            {!disabled && (
              <button type="button" aria-label={`${k} 삭제`} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        value={text}
        disabled={disabled}
        placeholder={keywords.length ? "키워드 추가 (Enter)" : "예: 서울교통공사 (Enter로 추가)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && keywords.length) {
            setKeywords(keywords.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function ArticleDetail({ article }) {
  if (!article) {
    return (
      <div className="cwDetail cwDetailEmpty">
        <p>왼쪽 목록에서 기사를 선택하면 수집된 내용이 여기에 표시됩니다.</p>
      </div>
    );
  }

  const status = STATUS[article.crawl_status];

  return (
    <article className="cwDetail">
      <div className="cwDetailTop">
        <span className={`cwBadge ${status.className}`}>{status.label}</span>
        {article.save_result && <span className={`cwBadge cwSave-${article.save_result}`}>{SAVE[article.save_result]}</span>}
      </div>

      <h2>{article.title}</h2>

      <dl className="cwMeta">
        <div><dt>언론사</dt><dd>{article.source || "-"}</dd></div>
        <div><dt>기자</dt><dd>{article.author || "-"}{article.reporter_email ? ` (${article.reporter_email})` : ""}</dd></div>
        <div><dt>발행</dt><dd>{formatTime(article.published_at)}</dd></div>
        <div><dt>분류</dt><dd>{article.category || "-"}</dd></div>
        <div><dt>검색 키워드</dt><dd>{article.search_keyword}</dd></div>
        <div><dt>본문 추출 방식</dt><dd>{article.extract_method} · {article.content_length.toLocaleString()}자</dd></div>
      </dl>

      {article.image_url && <img
          className="cwImage"
          src={article.image_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />}

      <section className="cwBlock">
        <h3>
          요약문 <small>{article.summary_source === "publisher" ? "언론사 제공" : article.summary_source === "lead" ? "본문 앞부분" : "RSS"}</small>
        </h3>
        <p className="cwSummary">{article.summary || "요약 없음"}</p>
      </section>

      {article.news_keywords?.length > 0 && (
        <section className="cwBlock">
          <h3>기사 키워드</h3>
          <div className="chips">{article.news_keywords.map((k) => <span key={k}>{k}</span>)}</div>
        </section>
      )}

      <section className="cwBlock">
        <h3>기사 전문</h3>
        <div className="cwContent">{article.content || "본문을 가져오지 못했습니다."}</div>
      </section>

      {article.related_articles?.length > 0 && (
        <section className="cwBlock">
          <h3>같은 사건을 다룬 다른 기사 {article.related_articles.length}건</h3>
          <ul className="cwRelated">
            {article.related_articles.map((r) => (
              <li key={r.google_url}>
                <a href={r.google_url} target="_blank" rel="noreferrer">{r.title}</a> <small>{r.source}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {article.crawl_error && <p className="errorText">⚠ {article.crawl_error}</p>}

      <div className="cwLinks">
        <a href={article.url} target="_blank" rel="noreferrer">원문 기사 열기 ↗</a>
        <a href={article.google_news_url} target="_blank" rel="noreferrer">구글 뉴스에서 보기 ↗</a>
      </div>
    </article>
  );
}

export default function CrawlerPage() {
  const [keywords, setKeywords] = useState(["서울교통공사"]);
  const [period, setPeriod] = useState("1d");
  const [limit, setLimit] = useState(10);
  const [mode, setMode] = useState("preview");

  const [running, setRunning] = useState(false);
  const [articles, setArticles] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [rssInfo, setRssInfo] = useState([]);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("all");

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const [intervalSec, setIntervalSec] = useState(600);

  const esRef = useRef(null);

  const loadStatus = async () => {
    try {
      const { data } = await apiClient.get("/crawler/status");
      setScheduleEnabled(data.scheduleEnabled);
      setSchedule(data.schedule);
      return data;
    } catch (err) {
      return err?.response?.status === 404 ? { outdated: true } : null;
    }
  };

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 15000);
    return () => {
      clearInterval(id);
      esRef.current?.close();
    };
  }, []);

  const finish = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setProgress(null);
  };

  const start = async () => {
    if (!keywords.length) {
      setMessage({ type: "error", text: "키워드를 하나 이상 입력하세요." });
      return;
    }

    const status = await loadStatus();
    if (!status) {
      setMessage({ type: "error", text: "백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요. (backend 폴더에서 npm run dev)" });
      return;
    }
    if (status.outdated) {
      setMessage({ type: "error", text: "백엔드 서버가 예전 버전입니다. 실행 중인 서버를 모두 종료하고 다시 실행하세요." });
      return;
    }
    if (status.running) {
      setMessage({ type: "error", text: "이미 수집이 진행 중입니다. (자동 수집이 실행 중일 수 있어요) 잠시 후 다시 시도하세요." });
      return;
    }

    setArticles([]);
    setStats(EMPTY_STATS);
    setRssInfo([]);
    setSelected(0);
    setFilter("all");
    setMessage(null);
    setRunning(true);
    setProgress({ text: "구글 뉴스에서 기사 목록을 가져오는 중…", index: 0, total: 0 });

    const params = new URLSearchParams({
      keywords: keywords.join(","),
      when: period,
      limit: String(limit),
      dryRun: mode === "preview" ? "1" : "0"
    });
    const es = new EventSource(`${API_BASE}/crawler/stream?${params}`);
    esRef.current = es;

    es.addEventListener("rss", (e) => {
      const d = JSON.parse(e.data);
      setRssInfo((prev) => [...prev, d]);
    });
    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      setProgress({ ...d, text: `[${d.keyword}] ${d.source} · ${d.title}` });
    });
    es.addEventListener("article", (e) => {
      const a = JSON.parse(e.data);
      setArticles((prev) => [...prev, a]);
      setStats((s) => ({
        ...s,
        total: s.total + 1,
        [a.crawl_status]: s[a.crawl_status] + 1,
        ...(a.save_result ? { [a.save_result]: s[a.save_result] + 1 } : {})
      }));
    });
    es.addEventListener("done", (e) => {
      const d = JSON.parse(e.data);
      setStats(d.stats);
      setMessage({
        type: "success",
        text: d.stopped
          ? `수집을 중지했습니다. (${d.stats.total}건 처리)`
          : d.stats.total
            ? `수집 완료: ${d.stats.total}건 처리했습니다.${mode === "save" ? " 저장된 기사는 AI 분석 후 '기사 목록'·'위험 기사'에 나타납니다." : ""}`
            : "새로 수집할 기사가 없습니다. (저장 모드에서는 이미 처리한 기사를 건너뜁니다)"
      });
      finish();
    });
    es.addEventListener("fail", (e) => {
      setMessage({ type: "error", text: JSON.parse(e.data).message });
      finish();
    });
    // EventSource 는 끊기면 자동 재연결을 시도하므로, 수집이 두 번 실행되지 않게 바로 닫는다
    es.onerror = () => {
      if (esRef.current) {
        setMessage({ type: "error", text: "서버와의 연결이 끊어졌습니다. 백엔드 서버 창에 오류가 있는지 확인하세요." });
        finish();
      }
    };
  };

  const stop = async () => {
    await apiClient.post("/crawler/stop").catch(() => {});
    setProgress((p) => (p ? { ...p, text: "중지하는 중… (현재 기사까지 처리 후 멈춥니다)" } : p));
  };

  const toggleSchedule = async () => {
    try {
      if (schedule) {
        await apiClient.delete("/crawler/schedule");
        setSchedule(null);
      } else {
        const { data } = await apiClient.post("/crawler/schedule", {
          keywords,
          when: period || "1d",
          limit,
          intervalSec
        });
        setSchedule(data.schedule);
      }
    } catch (err) {
      setMessage({ type: "error", text: err?.response?.data?.message || "자동 수집 설정 실패 (서버 연결 확인)" });
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(articles, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `news_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const visible = useMemo(
    () => articles.map((a, i) => ({ a, i })).filter(({ a }) => filter === "all" || a.crawl_status === filter),
    [articles, filter]
  );

  const percent = progress?.total ? Math.round((progress.index / progress.total) * 100) : running ? 5 : 0;

  return (
    <div className="pageStack cwPage">
      {/* 1. 수집 설정 */}
      <section className="cwPanel">
        <div className="cwPanelHead">
          <div>
            <span className="eyebrow">STEP 1</span>
            <h2>수집 설정</h2>
          </div>
          <p className="cwHint">구글 뉴스에서 키워드로 기사를 찾고, 각 언론사 원문에서 전문·기자·요약을 가져옵니다.</p>
        </div>

        <div className="cwForm">
          <label className="cwField cwFieldWide">
            <span>검색 키워드 (최대 10개)</span>
            <KeywordInput keywords={keywords} setKeywords={setKeywords} disabled={running} />
          </label>

          <label className="cwField">
            <span>기간</span>
            <select value={period} disabled={running} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>

          <label className="cwField">
            <span>키워드당 기사 수</span>
            <select value={limit} disabled={running} onChange={(e) => setLimit(Number(e.target.value))}>
              {[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>{n}개</option>)}
            </select>
          </label>

          <div className="cwField cwFieldWide">
            <span>실행 방식</span>
            <div className="cwSegment">
              <button type="button" disabled={running} className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
                미리보기
                <small>DB에 저장하지 않고 결과만 확인</small>
              </button>
              <button type="button" disabled={running} className={mode === "save" ? "active" : ""} onClick={() => setMode("save")}>
                저장 + AI 분석
                <small>DB 저장 → 위험도 분석 → 위험하면 모바일 알림</small>
              </button>
            </div>
          </div>
        </div>

        <div className="cwActions">
          {running ? (
            <button type="button" className="cwStop" onClick={stop}>■ 수집 중지</button>
          ) : (
            <button type="button" className="cwStart" onClick={start}>▶ 수집 시작</button>
          )}
          <button type="button" className="secondaryButton" disabled={!articles.length || running} onClick={downloadJson}>
            결과 JSON 다운로드
          </button>
        </div>

        {message && <div className={`cwMessage cwMessage-${message.type}`}>{message.text}</div>}
      </section>

      {/* 2. 진행 상황 */}
      {(running || articles.length > 0) && (
        <section className="cwPanel">
          <div className="cwPanelHead">
            <div>
              <span className="eyebrow">STEP 2</span>
              <h2>{running ? "수집 중…" : "수집 결과"}</h2>
            </div>
            <div className="cwRssInfo">
              {rssInfo.map((r) => (
                <span key={r.keyword} className={r.error ? "cwRssError" : ""}>
                  {r.keyword} · {r.error ? "검색 실패" : `${r.count}건${r.fresh !== r.count ? ` (이미 처리·중복 ${r.count - r.fresh}건 제외)` : ""}`}
                </span>
              ))}
            </div>
          </div>

          {running && (
            <div className="cwProgress">
              <div className="cwBar"><div style={{ width: `${percent}%` }} /></div>
              <p>
                {progress?.total ? <strong>{progress.index}/{progress.total} </strong> : null}
                {progress?.text}
              </p>
            </div>
          )}

          <div className="cwStats">
            <div><strong>{stats.total}</strong><span>처리한 기사</span></div>
            <div className="cwFull"><strong>{stats.full}</strong><span>본문 수집 성공</span></div>
            <div className="cwPartial"><strong>{stats.partial}</strong><span>본문 일부</span></div>
            <div className="cwRssOnly"><strong>{stats.rss_only}</strong><span>제목·요약만</span></div>
            {mode === "save" && (
              <>
                <div><strong>{stats.saved}</strong><span>DB 저장</span></div>
                <div><strong>{stats.duplicate}</strong><span>중복</span></div>
                <div className={stats.failed ? "cwRssOnly" : ""}><strong>{stats.failed}</strong><span>저장 실패</span></div>
              </>
            )}
          </div>
        </section>
      )}

      {/* 3. 기사 목록 + 상세 */}
      {articles.length > 0 && (
        <section className="cwResults">
          <div className="cwList">
            <div className="cwFilter">
              {[
                ["all", `전체 ${articles.length}`],
                ["full", `본문 ${stats.full}`],
                ["partial", `일부 ${stats.partial}`],
                ["rss_only", `제목만 ${stats.rss_only}`]
              ].map(([key, label]) => (
                <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            <ul>
              {visible.map(({ a, i }) => (
                <li key={`${a.url}-${i}`}>
                  <button type="button" className={selected === i ? "selected" : ""} onClick={() => setSelected(i)}>
                    <span className={`cwDot ${STATUS[a.crawl_status].className}`} title={STATUS[a.crawl_status].label} />
                    <span className="cwItemBody">
                      <strong>{a.title}</strong>
                      <small>
                        {a.source} · {formatTime(a.published_at)} · {a.content_length.toLocaleString()}자
                        {a.save_result === "duplicate" && " · 중복"}
                        {a.save_result === "failed" && " · 저장실패"}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <ArticleDetail article={articles[selected]} />
        </section>
      )}

      {/* 4. 자동 수집 */}
      <section className="cwPanel">
        <div className="cwPanelHead">
          <div>
            <span className="eyebrow">자동 수집</span>
            <h2>정해진 간격마다 수집 → 저장 → AI 분석</h2>
          </div>
          <p className="cwHint">서버가 켜져 있는 동안 위 키워드로 반복 수집합니다. (.env 의 CRAWL_KEYWORDS 로 서버 시작 시 자동으로 켤 수도 있음) 위험 기사가 나오면 모바일 알림이 갑니다.</p>
        </div>

        <div className="cwSchedule">
          <select value={intervalSec} disabled={!!schedule} onChange={(e) => setIntervalSec(Number(e.target.value))}>
            {INTERVALS.map((it) => <option key={it.value} value={it.value}>{it.label}</option>)}
          </select>
          <button type="button" className={schedule ? "cwStop" : "cwStart"} disabled={!scheduleEnabled} onClick={toggleSchedule}>
            {schedule ? "■ 자동 수집 끄기" : "▶ 자동 수집 켜기"}
          </button>

          {!scheduleEnabled && <p className="cwNote">자동 수집을 사용하려면 CRAWLER_PROVIDER=google을 설정하세요.</p>}
          {schedule ? (
            <dl className="cwMeta cwScheduleInfo">
              <div><dt>상태</dt><dd><span className="cwLive" /> 실행 중 ({schedule.intervalSec / 60}분 간격)</dd></div>
              <div><dt>키워드</dt><dd>{schedule.keywords.join(", ")}</dd></div>
              <div><dt>마지막 실행</dt><dd>{formatTime(schedule.lastRunAt)}</dd></div>
              <div><dt>다음 실행</dt><dd>{formatTime(schedule.nextRunAt)}</dd></div>
              <div>
                <dt>마지막 결과</dt>
                <dd>
                  {schedule.lastError
                    ? `오류: ${schedule.lastError}`
                    : schedule.lastStats
                      ? `${schedule.lastStats.total}건 처리 · 저장 ${schedule.lastStats.saved} · 중복 ${schedule.lastStats.duplicate}`
                      : "첫 수집 진행 중…"}
                </dd>
              </div>
            </dl>
          ) : (
            <span className="cwHint">꺼져 있음</span>
          )}
        </div>
      </section>
    </div>
  );
}
