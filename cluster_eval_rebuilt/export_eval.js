
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { saveHtmlReport } = require('./evaluation_report');

const DB = 'news_test_db';
const labelsPath = process.argv[2] || '/eval/test_cases.json';
const data = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));

const base = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: DB
};

function metrics(tp, fp, fn, tn = 0) {
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;

  return {
    tp, fp, fn, tn,
    precision: p,
    recall: r,
    f1: p + r ? 2 * p * r / (p + r) : 0,
    accuracy: tp + fp + fn + tn
      ? (tp + tn) / (tp + fp + fn + tn)
      : 0
  };
}

async function main() {
  if (process.env.DB_NAME !== DB) {
    throw Error('Refusing to run outside news_test_db');
  }

  if (
    data.length !== 100 ||
    new Set(data.map(a => a.url)).size !== 100 ||
    data.some(a => typeof a.expected_related !== 'boolean')
  ) {
    throw Error('Expected exactly 100 valid labels');
  }

  const db = await mysql.createConnection(base);

  try {
    const [[{ name }]] = await db.query(
      'SELECT DATABASE() name'
    );

    if (name !== DB) throw Error('Wrong database');

    const [rows] = await db.query(`
      SELECT
        a.article_id,
        a.url,
        a.title,
        a.content,
        a.source,
        a.author,
        a.published_at,
        aa.*
      FROM articles a
      LEFT JOIN article_analysis aa
        ON aa.article_id = a.article_id
    `);

    if (rows.length !== 100) {
      throw Error(`Expected 100 articles; found ${rows.length}`);
    }

    const byUrl = new Map(rows.map(r => [r.url, r]));

    const date = v =>
      v ? new Date(v).toISOString().slice(0, 19) : null;

    for (const a of data) {
      const r = byUrl.get(a.url);

      if (!r) throw Error('Missing article: ' + a.url);

      if (
        r.title !== a.title ||
        r.content !== a.content ||
        r.source !== a.source ||
        r.author !== a.author ||
        date(r.published_at) !== date(a.published_at)
      ) {
        throw Error('Original article differs: ' + a.url);
      }

      a.article_id = r.article_id;

      const analyzed = r.analyzed_at != null;

      a.predicted_related = !analyzed ||
        r.target_related == null
          ? null
          : !!r.target_related;

      a.predicted_cluster = analyzed
        ? r.cluster_id ?? null
        : null;

      a.elapsed_seconds = null;
      a.analysis_status = analyzed
        ? r.analysis_status ?? 'completed'
        : 'missing';

      // 원문은 기존 라벨 데이터에 포함되어 있습니다.
      // AI 분석 컬럼 전체를 별도로 저장합니다.
      a.analysis = analyzed ? r : null;
    }

    let tp = 0, fp = 0, fn = 0, tn = 0;

    for (const a of data) {
      if (a.expected_related && a.predicted_related === true) {
        tp++;
      } else if (
        !a.expected_related &&
        a.predicted_related === true
      ) {
        fp++;
      } else if (a.expected_related) {
        fn++;
      } else {
        tn++;
      }
    }

    const related = data.filter(a => a.expected_related);

    let ctp = 0, cfp = 0, cfn = 0, ctn = 0;
    const errors = [];

    for (let i = 0; i < related.length; i++) {
      for (let j = i + 1; j < related.length; j++) {
        const a = related[i];
        const b = related[j];

        const same = a.expected_event === b.expected_event;

        const joined =
          a.predicted_related === true &&
          b.predicted_related === true &&
          a.predicted_cluster != null &&
          a.predicted_cluster === b.predicted_cluster;

        if (same && joined) ctp++;
        else if (same) cfn++;
        else if (joined) cfp++;
        else ctn++;

        if (same !== joined) {
          errors.push({
            a: a.original_number,
            b: b.original_number,
            expected_same: same,
            predicted_same: joined,
            event_a: a.expected_event,
            event_b: b.expected_event,
            cluster_a: a.predicted_cluster,
            cluster_b: b.predicted_cluster
          });
        }
      }
    }

    const completed = data.filter(
      a => a.analysis !== null
    ).length;

    const output = {
      tested_at: new Date().toISOString(),
      total: data.length,
      completed,
      failed_or_missing: data.length - completed,
      total_seconds: null,
      classification: metrics(tp, fp, fn, tn),
      clustering_pairwise: metrics(ctp, cfp, cfn, ctn),
      articles: data,
      cluster_pair_errors: errors
    };

    const out = process.env.EVAL_OUTPUT ||
      '/results/evaluation_recovered_' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '.json';

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(output, null, 2),
      'utf8'
    );

    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));

    if (saved.articles.length !== 100) {
      throw Error('Saved evaluation verification failed');
    }
    
    const htmlPath = saveHtmlReport(output, out);
    console.log('HTML report saved:', htmlPath);
    console.log('Saved:', out);
    console.log(`Completed: ${completed}/100`);
    console.log('Classification:', output.classification);
    console.log('Clustering:', output.clustering_pairwise);
    console.log('Database unchanged.');

  } finally {
    await db.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
