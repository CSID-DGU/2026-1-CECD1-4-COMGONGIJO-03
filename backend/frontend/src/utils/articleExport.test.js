import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleArticles } from "../services/sampleData.js";
import { createArticleWorkbook, uniqueArticles } from "./articleExport.js";
import {formatKoreanDate} from './articleView.js';

test("exports sample articles in input order and removes duplicate IDs/URLs", async () => {
  const articles = [
    ...sampleArticles,
    { ...sampleArticles[0], article_id: String(sampleArticles[0].article_id) },
    { ...sampleArticles[1], article_id: 99999 }
  ];
  assert.equal(uniqueArticles(articles).length, sampleArticles.length);
  const workbook = await createArticleWorkbook(articles);
  await workbook.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = workbook.getWorksheet("기사 목록");
  assert.equal(sheet.rowCount, sampleArticles.length + 1);
  assert.equal(sheet.columnCount, 8);
  sampleArticles.forEach((article, index) => {
    assert.deepEqual(sheet.getRow(index + 2).values.slice(1), [
      String(article.article_id), article.title, article.source,
      formatKoreanDate(article.published_at), article.sentiment_label, article.risk_score,
      article.summary, article.url
    ]);
  });
});

test("preserves missing fields, zero values and literal formula-like titles", async () => {
  const workbook = await createArticleWorkbook([
    { article_id: 0, title: "=1+1", risk_score: 0 }, {}, {}
  ]);
  await workbook.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = workbook.getWorksheet("기사 목록");
  assert.equal(sheet.rowCount, 4);
  assert.equal(sheet.getCell("A2").value, "0");
  assert.equal(sheet.getCell("B2").value, "=1+1");
  assert.equal(sheet.getCell("F2").value, 0);
  for (const column of ["C", "D", "E", "G", "H"]) {
    assert.ok(!sheet.getCell(`${column}2`).value);
  }
});
