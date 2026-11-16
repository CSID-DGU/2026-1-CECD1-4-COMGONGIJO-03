
'use strict';

const fs = require('fs');
const path = require('path');

function saveHtmlReport(output, jsonPath) {
  const htmlPath = jsonPath.replace(/\.json$/i, '') + '.html';

  // JSON을 Base64로 저장하여 기사 원문에 HTML이나
  // 스크립트 문자가 포함되어도 문서 구조가 깨지지 않도록 합니다.
  const encoded = Buffer.from(
    JSON.stringify(output),
    'utf8'
  ).toString('base64');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>기사 분석 평가 보고서</title>
<style>
  :root {
    font-family: Arial, "Malgun Gothic", sans-serif;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f3f5f8;
    color: #202938;
  }
  header {
    background: #17283f;
    color: white;
    padding: 22px 30px;
  }
  h1 { margin: 0 0 8px; font-size: 23px; }
  h2 { font-size: 19px; margin: 0 0 14px; }
  h3 { font-size: 16px; margin: 0 0 10px; }
  main {
    max-width: 1450px;
    margin: auto;
    padding: 22px;
  }
  .muted { color: #64748b; }
  header .muted { color: #cbd5e1; }
  .panel {
    background: white;
    border: 1px solid #e1e6ee;
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 18px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .stat {
    background: white;
    border: 1px solid #e1e6ee;
    border-radius: 10px;
    padding: 16px;
  }
  .stat strong {
    display: block;
    font-size: 24px;
    margin-top: 8px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  input, select {
    padding: 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: white;
    font-size: 14px;
  }
  input { min-width: 250px; flex: 1; }
  button {
    border: 1px solid #cbd5e1;
    background: white;
    border-radius: 6px;
    padding: 9px 13px;
    cursor: pointer;
  }
  button.active {
    background: #1d4ed8;
    color: white;
    border-color: #1d4ed8;
  }
  .table-wrap { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    padding: 10px;
    border-bottom: 1px solid #e5e7eb;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f8fafc;
    white-space: nowrap;
  }
  tr:hover { background: #f8fafc; }
  .title-cell { min-width: 240px; }
  .ok { color: #047857; font-weight: bold; }
  .bad { color: #b91c1c; font-weight: bold; }
  .warn { color: #a16207; font-weight: bold; }
  .pill {
    display: inline-block;
    padding: 3px 7px;
    border-radius: 5px;
    background: #e8eef7;
    font-size: 12px;
  }
  .details {
    margin-top: 18px;
    border-top: 1px solid #e5e7eb;
    padding-top: 18px;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .field {
    padding: 9px 0;
    border-bottom: 1px solid #edf0f4;
  }
  .field-label {
    color: #64748b;
    font-size: 12px;
    margin-bottom: 5px;
  }
  .content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.7;
    max-height: 500px;
    overflow-y: auto;
    background: #f8fafc;
    padding: 14px;
    border-radius: 7px;
  }
  .group {
    border: 1px solid #e1e6ee;
    border-radius: 8px;
    margin: 10px 0;
    overflow: hidden;
  }
  .group summary {
    padding: 12px;
    cursor: pointer;
    background: #f8fafc;
    font-weight: bold;
  }
  .group-body { padding: 12px; }
  .group-item {
    padding: 8px;
    border-bottom: 1px solid #edf0f4;
    font-size: 13px;
  }
  .group-item:last-child { border: 0; }
  .hidden { display: none; }
  a { color: #1d4ed8; }
</style>
</head>
<body>

<header>
  <h1>기사 분석 평가 보고서</h1>
  <div class="muted" id="testedAt"></div>
</header>

<main>
  <section class="stats" id="stats"></section>

  <section class="panel">
    <h2>기사 검색 및 필터</h2>
    <div class="controls">
      <input id="search" placeholder="기사 번호, 제목, 본문 검색">
      <select id="statusFilter">
        <option value="all">전체 기사</option>
        <option value="wrong">관련성 오분류</option>
        <option value="failed">미분석 / 실패</option>
        <option value="correct">관련성 정답</option>
      </select>
      <select id="eventFilter">
        <option value="all">전체 정답 사건</option>
      </select>
      <select id="clusterFilter">
        <option value="all">전체 예측 클러스터</option>
      </select>
    </div>
    <p class="muted" id="count"></p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>번호</th>
            <th>기사 제목</th>
            <th>정답 관련성</th>
            <th>예측 관련성</th>
            <th>정답 사건</th>
            <th>예측 클러스터</th>
            <th>최유사 후보 / 편입 판정</th>
            <th>위험도</th>
            <th>결과</th>
            <th>상세</th>
          </tr>
        </thead>
        <tbody id="articleRows"></tbody>
      </table>
    </div>
  </section>

  <section class="panel hidden" id="detailPanel">
    <h2>기사 상세 분석</h2>
    <div id="detailContent"></div>
  </section>

  <section class="panel">
    <h2>사건 및 클러스터별 기사 묶음</h2>
    <div class="controls">
      <button id="groupExpected" class="active">
        정답 사건별
      </button>
      <button id="groupPredicted">
        AI 클러스터별
      </button>
    </div>
    <div id="groups"></div>
  </section>
</main>

<script>
'use strict';

const encoded = '${encoded}';
const bytes = Uint8Array.from(
  atob(encoded),
  c => c.charCodeAt(0)
);
const report = JSON.parse(
  new TextDecoder('utf-8').decode(bytes)
);

const articles = report.articles || [];
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function display(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function percent(value) {
  return typeof value === 'number'
    ? (value * 100).toFixed(2) + '%'
    : '-';
}

function classificationStatus(article) {
  if (article.predicted_related === null ||
      article.predicted_related === undefined) {
    return 'failed';
  }

  return article.expected_related === article.predicted_related
    ? 'correct'
    : 'wrong';
}

function riskScore(article) {
  const a = article.analysis || {};
  return a.risk_score ?? null;
}

function field(label, value) {
  return '<div class="field">' +
    '<div class="field-label">' + escapeHtml(label) + '</div>' +
    '<div>' + escapeHtml(display(value)) + '</div>' +
    '</div>';
}

function renderStats() {
  const c = report.classification || {};
  const k = report.clustering_pairwise || {};

  const stats = [
    ['전체 기사', report.total],
    ['분석 완료', report.completed],
    ['미분석 / 실패', report.failed_or_missing],
    ['관련성 정확도', percent(c.accuracy)],
    ['관련성 F1', percent(c.f1)],
    ['클러스터 정밀도', percent(k.precision)],
    ['클러스터 재현율', percent(k.recall)],
    ['클러스터 F1', percent(k.f1)]
  ];

  $('stats').innerHTML = stats.map(([label, value]) =>
    '<div class="stat">' +
    escapeHtml(label) +
    '<strong>' + escapeHtml(display(value)) + '</strong>' +
    '</div>'
  ).join('');

  $('testedAt').textContent =
    '평가 시각: ' + display(report.tested_at);
}

function fillSelect(id, values) {
  const select = $(id);
  const sorted = [...new Set(values)]
    .filter(v => v !== null && v !== undefined)
    .sort((a, b) =>
      String(a).localeCompare(String(b), 'ko', { numeric: true })
    );

  for (const value of sorted) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }
}

function clusterDecisionText(article) {
  const d = article.cluster_decision;

  if (!d) {
    return article.predicted_related === true
      ? '판정 기록 없음'
      : '클러스터링 대상 아님';
  }

  if (d.decision === 'NO_CANDIDATE') {
    return '비교 가능한 후보 없음 → 신규 생성';
  }

  const score =
    typeof d.similarity_score === 'number'
      ? d.similarity_score.toFixed(2)
      : '-';

  const result =
    d.decision === 'PASS'
      ? '통과 · 편입'
      : '탈락 · 신규 생성';

  return '#' + d.candidate_cluster_id +
    ' (' + score + '/' + d.max_score +
    '점, 기준 ' + d.threshold + '점) ' +
    result;
}

function renderArticles() {
  const keyword = $('search').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const event = $('eventFilter').value;
  const cluster = $('clusterFilter').value;

  const filtered = articles.filter(a => {
    const searchText = [
      a.original_number,
      a.title,
      a.content,
      a.analysis?.summary
    ].map(display).join(' ').toLowerCase();

    if (keyword && !searchText.includes(keyword)) return false;

    const result = classificationStatus(a);

    if (status !== 'all' && result !== status) return false;

    if (event !== 'all' &&
        String(a.expected_event ?? '') !== event) {
      return false;
    }

    if (cluster !== 'all' &&
        String(a.predicted_cluster ?? '') !== cluster) {
      return false;
    }

    return true;
  });

  $('count').textContent = filtered.length + '건 표시 중';

  $('articleRows').innerHTML = filtered.map(a => {
    const status = classificationStatus(a);

    const statusLabel = status === 'correct'
      ? '정답'
      : status === 'wrong'
        ? '오분류'
        : '미분석';

    const cssClass = status === 'correct'
      ? 'ok'
      : status === 'wrong'
        ? 'bad'
        : 'warn';

    return '<tr>' +
      '<td>' + escapeHtml(display(a.original_number)) + '</td>' +
      '<td class="title-cell">' + escapeHtml(display(a.title)) + '</td>' +
      '<td>' + (a.expected_related ? '관련' : '비관련') + '</td>' +
      '<td>' +
        (a.predicted_related == null
          ? '미분석'
          : a.predicted_related ? '관련' : '비관련') +
      '</td>' +
      '<td>' + escapeHtml(display(a.expected_event)) + '</td>' +
      '<td>' + escapeHtml(display(a.predicted_cluster)) + '</td>' +
      '<td>' + escapeHtml(clusterDecisionText(a)) + '</td>' +
      '<td>' + escapeHtml(display(riskScore(a))) + '</td>' +
      '<td class="' + cssClass + '">' + statusLabel + '</td>' +
      '<td><button data-article="' +
        escapeHtml(a.article_id) +
        '">보기</button></td>' +
      '</tr>';
  }).join('');

  $('articleRows').querySelectorAll('[data-article]').forEach(
    button => {
      button.addEventListener('click', () => {
        showArticle(button.dataset.article);
      });
    }
  );
}

const riskFields = [
  ['위험도 총점', 'risk_score'],
  ['사건 심각도', 'issue_severity'],
  ['기업 귀책성', 'target_responsibility'],
  ['규범 위반성', 'norm_violation'],
  ['유사 위기 이력', 'similar_crisis_history'],
  ['언론사 영향력', 'media_influence'],
  ['위험도 판단 근거', 'risk_factor_reason']
];

function showArticle(articleId) {
  const a = articles.find(
    item => String(item.article_id) === String(articleId)
  );

  if (!a) return;

  const analysis = a.analysis || {};

  const riskHtml = riskFields.map(([label, key]) =>
    field(label, analysis[key])
  ).join('');

  const excluded = new Set([
    'article_id', 'title', 'content', 'url', 'source',
    'author', 'published_at',
    ...riskFields.map(item => item[1])
  ]);

  const otherFields = Object.entries(analysis)
    .filter(([key]) => !excluded.has(key))
    .map(([key, value]) => field(key, value))
    .join('');

  const url = /^https?:\\/\\//i.test(a.url || '')
    ? '<a href="' + escapeHtml(a.url) +
      '" target="_blank" rel="noopener noreferrer">원문 링크</a>'
    : '';

  $('detailContent').innerHTML =
    '<h3>' + escapeHtml(display(a.title)) + '</h3>' +
    '<div class="detail-grid">' +
      '<div>' +
        field('기사 번호', a.original_number) +
        field('언론사', a.source) +
        field('발행일', a.published_at) +
        field('정답 사건', a.expected_event) +
        field('예측 클러스터', a.predicted_cluster) +
        field(
            '최유사 후보 / 편입 판정',
            clusterDecisionText(a)
        ) +
        field(
            '최유사 후보 대표기사',
            a.cluster_decision?.candidate_cluster_title
        ) +
        field('분석 상태', a.analysis_status) +
        url +
      '</div>' +
      '<div>' +
        '<h3>위험도 평가</h3>' +
        riskHtml +
      '</div>' +
    '</div>' +
    '<h3>AI 요약</h3>' +
    '<div class="content">' +
      escapeHtml(display(analysis.summary)) +
    '</div>' +
    '<h3>기사 원문</h3>' +
    '<div class="content">' +
      escapeHtml(display(a.content)) +
    '</div>' +
    '<details class="group">' +
      '<summary>기타 AI 분석 필드 전체 보기</summary>' +
      '<div class="group-body detail-grid">' +
        otherFields +
      '</div>' +
    '</details>';

  $('detailPanel').classList.remove('hidden');
  $('detailPanel').scrollIntoView({ behavior: 'smooth' });
}

let groupMode = 'expected';

function renderGroups() {
  const groups = new Map();

  for (const article of articles) {
    const key = groupMode === 'expected'
      ? article.expected_event ?? '(정답 사건 없음)'
      : article.predicted_cluster ?? '(클러스터 없음)';

    const groupKey = String(key);

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(article);
  }

  const sorted = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  $('groups').innerHTML = sorted.map(([key, items]) => {
    const contents = items.map(a =>
      '<div class="group-item">' +
      '<button data-article="' +
        escapeHtml(a.article_id) +
      '">상세</button> ' +
      '#' + escapeHtml(display(a.original_number)) + ' ' +
      escapeHtml(display(a.title)) +
      ' <span class="pill">' +
      escapeHtml(
        groupMode === 'expected'
          ? display(a.predicted_cluster)
          : display(a.expected_event)
      ) +
      '</span>' +
      ' · 위험도 ' + escapeHtml(display(riskScore(a))) +
      ' · ' + escapeHtml(clusterDecisionText(a)) +
      '</div>'
    ).join('');

    return '<details class="group">' +
      '<summary>' + escapeHtml(key) +
      ' (' + items.length + '건)</summary>' +
      '<div class="group-body">' + contents + '</div>' +
      '</details>';
  }).join('');

  $('groups').querySelectorAll('[data-article]').forEach(
    button => {
      button.addEventListener('click', () => {
        showArticle(button.dataset.article);
      });
    }
  );
}

$('search').addEventListener('input', renderArticles);
$('statusFilter').addEventListener('change', renderArticles);
$('eventFilter').addEventListener('change', renderArticles);
$('clusterFilter').addEventListener('change', renderArticles);

$('groupExpected').addEventListener('click', () => {
  groupMode = 'expected';
  $('groupExpected').classList.add('active');
  $('groupPredicted').classList.remove('active');
  renderGroups();
});

$('groupPredicted').addEventListener('click', () => {
  groupMode = 'predicted';
  $('groupPredicted').classList.add('active');
  $('groupExpected').classList.remove('active');
  renderGroups();
});

renderStats();
fillSelect('eventFilter', articles.map(a => a.expected_event));
fillSelect('clusterFilter', articles.map(a => a.predicted_cluster));
renderArticles();
renderGroups();
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf8');

  return htmlPath;
}

module.exports = { saveHtmlReport };
