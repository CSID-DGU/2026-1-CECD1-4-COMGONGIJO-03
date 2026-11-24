'use strict';

// Manually train the risk bias model from selected, reviewed evaluation results.
// Neither evaluation runs nor this script's preview mode alter the active model.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RISK_FACTORS, assertModel } = require('../services/riskService');

const backendRoot = path.resolve(__dirname, '..');
const modelPath = path.join(backendRoot, 'config', 'riskModel.json');
const trainingDir = path.join(backendRoot, 'risk_training');
const snapshotDir = path.join(trainingDir, 'approved_reports');
const historyPath = path.join(trainingDir, 'history.json');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const clamp = x => Math.max(0, Math.min(1, x));
const valid = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = obj => JSON.stringify(obj, null, 2) + '\n';

function parseArgs(args) {
    const opts = { files: [], strength: 0.5, apply: false, list: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--apply') opts.apply = true;
        else if (arg === '--list') opts.list = true;
        else if (arg === '--strength') {
            if (++i >= args.length) throw Error('--strength 값이 필요합니다.');
            opts.strength = Number(args[i]);
        } else if (arg.startsWith('--')) throw Error(`알 수 없는 옵션입니다: ${arg}`);
        else opts.files.push(path.resolve(arg));
    }
    if (!Number.isFinite(opts.strength) || opts.strength < 0 || opts.strength > 1)
        throw Error('--strength는 0~1 사이 숫자여야 합니다.');
    return opts;
}

function getHistory() {
    if (!fs.existsSync(historyPath)) return { version: 1, reports: {} };
    const data = readJson(historyPath);
    if (data.version !== 1 || !data.reports || Array.isArray(data.reports))
        throw Error('학습 이력 파일 형식이 올바르지 않습니다.');
    return data;
}

function selectedRows(data, dataset, source) {
    const articles = Array.isArray(data) ? data : data.articles;
    if (!Array.isArray(articles)) throw Error(`${source}: 평가 보고서의 articles 배열이 필요합니다.`);
    const rows = [];
    const approved = !Array.isArray(data) && data.approved_training_snapshot === true;
    const used = new Set();
    for (const row of articles) {
        // Only human-labeled, correctly identified related articles have comparable factors.
        if (!approved && (row.expected_related !== true || row.predicted_related !== true)) continue;
        const event = row.expected_event ?? row.event_key;
        const labels = row.factor_labels;
        const raw = row.predicted_factors ?? row.raw_factors;
        if (!event || !labels || !raw) continue;
        if (!RISK_FACTORS.every(key => valid(raw[key]) && valid(labels[key]))) continue;
        const article = row.original_number ?? row.article_id ?? row.url;
        if (article == null) throw Error(`${source}: 학습 기사의 식별자가 없습니다.`);
        const identity = String(article);
        if (used.has(identity)) throw Error(`${source}: 기사 ${identity}가 중복되었습니다.`);
        used.add(identity);
        rows.push({
            article_id: identity,
            event_key: String(event),
            raw_factors: Object.fromEntries(RISK_FACTORS.map(k => [k, raw[k]])),
            factor_labels: Object.fromEntries(RISK_FACTORS.map(k => [k, labels[k]]))
        });
    }
    if (!rows.length) throw Error(`${source}: 학습 가능한 정답 관련 기사와 위험도 지표별 검수 점수가 없습니다.`);
    return { approved_training_snapshot: true, dataset, articles: rows };
}

function loadSelected(file) {
    if (!fs.existsSync(file)) throw Error(`테스트 결과 파일이 없습니다: ${file}`);
    const data = readJson(file);
    const dataset = (Array.isArray(data) ? path.basename(file) : data.dataset || path.basename(file));
    if (typeof dataset !== 'string' || !dataset.trim()) throw Error('배치 식별자가 없습니다.');
    const snapshot = selectedRows(data, dataset, file);
    return { snapshot, file, hash: sha256(fs.readFileSync(file)) };
}

function readApproved(entry) {
    const file = path.join(snapshotDir, entry.snapshot);
    if (!path.resolve(file).startsWith(path.resolve(snapshotDir) + path.sep))
        throw Error('학습 이력의 스냅샷 경로가 올바르지 않습니다.');
    if (!fs.existsSync(file)) throw Error(`확정된 학습 자료가 없습니다: ${file}`);
    const snapshot = readJson(file);
    if (sha256(json(snapshot)) !== entry.snapshot_hash)
        throw Error(`확정된 학습 자료가 변경되었습니다: ${file}`);
    return selectedRows(snapshot, snapshot.dataset, file);
}

function calculate(snapshots, strength, currentModel) {
    const events = new Map();
    let count = 0;
    for (const snapshot of snapshots) {
        for (const row of snapshot.articles) {
            const id = `${snapshot.dataset}::${row.event_key}`;
            if (!events.has(id)) events.set(id, []);
            events.get(id).push(row);
            count++;
        }
    }
    if (events.size < 2) throw Error('서로 다른 정답 사건이 최소 2개 필요합니다.');
    const biases = {};
    const metrics = {};
    for (const key of RISK_FACTORS) {
        const byEvent = [...events.values()].map(rows => rows.map(r => r.factor_labels[key] - r.raw_factors[key]));
        const b = Number((strength * mean(byEvent.map(mean))).toFixed(8));
        biases[key] = b;
        const baseLoss = [...events.values()].map(rows => mean(rows.map(r =>
            Math.abs(r.factor_labels[key] - r.raw_factors[key]))));
        const correctedLoss = [...events.values()].map(rows => mean(rows.map(r =>
            Math.abs(r.factor_labels[key] - clamp(r.raw_factors[key] + b)))));
        const { a: existingA, b: existingB, p: existingP } = currentModel.factors[key];
        const currentLoss = [...events.values()].map(rows => mean(rows.map(r =>
            Math.abs(r.factor_labels[key] - clamp(existingA * (r.raw_factors[key] ** existingP) + existingB)))));
        metrics[key] = {
            events: byEvent.length,
            raw_event_mae: Number(mean(baseLoss).toFixed(5)),
            active_event_mae: Number(mean(currentLoss).toFixed(5)),
            candidate_event_mae: Number(mean(correctedLoss).toFixed(5)),
            bias: b
        };
    }
    const model = JSON.parse(JSON.stringify(currentModel));
    model.weights = { ...(currentModel.ahp_weights || currentModel.weights) };
    model.factors = Object.fromEntries(RISK_FACTORS.map(k => [k, { a: 1, b: biases[k], p: 1 }]));
    const digest = sha256(JSON.stringify({ factors: model.factors, weights: model.weights })).slice(0, 8);
    model.version = `event-bias-${digest}`;
    assertModel(model);
    return { model, metrics, articleCount: count, eventCount: events.size };
}

function safeWrite(file, body) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    try { fs.writeFileSync(temp, body, 'utf8'); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function run(opts) {
    const history = getHistory();
    if (opts.list) {
        console.log('확정된 학습 배치:', Object.keys(history.reports).length ? Object.keys(history.reports).join(', ') : '(없음)');
        return;
    }
    const incoming = new Map();
    for (const file of opts.files) {
        const report = loadSelected(file);
        const id = report.snapshot.dataset;
        if (incoming.has(id)) throw Error(`같은 배치의 결과를 동시에 두 번 선택했습니다: ${id}`);
        incoming.set(id, report);
    }
    const snapshots = [];
    for (const [dataset, entry] of Object.entries(history.reports)) {
        if (!incoming.has(dataset)) snapshots.push(readApproved(entry));
    }
    for (const report of incoming.values()) snapshots.push(report.snapshot);
    if (!snapshots.length) throw Error('학습 대상이 없습니다. 검수된 테스트 결과 JSON 경로를 입력하세요.');
    const current = readJson(modelPath);
    assertModel(current);
    const result = calculate(snapshots, opts.strength, current);
    console.log(`대상 배치 ${snapshots.length}개 / 검수 기사 ${result.articleCount}건 / 정답 사건 ${result.eventCount}개`);
    console.log(`학습 강도 ${opts.strength} / 생성 모델 ${result.model.version}`);
    console.log('지표별 편향 및 사건 균등 MAE (원본 / 현재 모델 / 학습 후보, 학습 데이터 기준):');
    console.table(result.metrics);
    console.log('이번에 선택한 테스트 결과:', [...incoming.keys()].join(', ') || '(기존 확정 데이터만 사용)');
    if (!opts.apply) {
        console.log('미리보기만 수행했습니다. 모델과 학습 이력은 변경하지 않았습니다.');
        return result;
    }
    fs.mkdirSync(snapshotDir, { recursive: true });
    const updated = { version: 1, reports: { ...history.reports } };
    for (const [dataset, report] of incoming) {
        const snapshotName = `${sha256(dataset).slice(0, 16)}.json`;
        const content = json(report.snapshot);
        safeWrite(path.join(snapshotDir, snapshotName), content);
        updated.reports[dataset] = {
            snapshot: snapshotName,
            snapshot_hash: sha256(content),
            original_file: report.file,
            original_sha256: report.hash,
            accepted_at: new Date().toISOString(),
            articles: report.snapshot.articles.length
        };
    }
    const backupDir = path.join(trainingDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `riskModel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(modelPath, backupFile);
    safeWrite(modelPath, json(result.model));
    safeWrite(historyPath, json(updated));
    console.log(`모델 적용 완료: ${modelPath}`);
    console.log(`이전 모델 백업: ${backupFile}`);
    console.log('실행 중인 백엔드에 반영하려면 백엔드를 재시작하거나 Docker 이미지를 재빌드해야 합니다.');
    return result;
}

if (require.main === module) {
    try { run(parseArgs(process.argv.slice(2))); }
    catch (err) { console.error(`학습 실패: ${err.message}`); process.exitCode = 1; }
}
module.exports = { parseArgs, selectedRows, calculate, run };
