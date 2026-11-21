import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadArticleExcel } from "./articleExport.js";

test("download handler produces a nonempty XLSX file and clicks the browser download link", async () => {
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clicked = 0;
  let appended = 0;
  let removed = 0;
  let generatedBlob;
  const anchor = {
    href: "",
    download: "",
    click() { clicked += 1; },
    remove() { removed += 1; }
  };

  try {
    globalThis.document = {
      body: { appendChild(element) { assert.equal(element, anchor); appended += 1; } },
      createElement(tag) { assert.equal(tag, "a"); return anchor; }
    };
    URL.createObjectURL = (blob) => {
      generatedBlob = blob;
      return "blob:article-export-test";
    };
    URL.revokeObjectURL = () => {};

    await downloadArticleExcel([{ article_id: 42, title: "테스트 기사", risk_score: 0.6 }], {
      selectedDate: "2026-11-21",
      activeTab: "media"
    });

    assert.equal(anchor.href, "blob:article-export-test");
    assert.equal(anchor.download, "기사목록_언론보도_2026-11-21.xlsx");
    assert.equal(clicked, 1);
    assert.equal(appended, 1);
    assert.equal(removed, 1);
    assert.equal(generatedBlob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.ok(generatedBlob.size > 100);
    const bytes = new Uint8Array(await generatedBlob.slice(0, 2).arrayBuffer());
    assert.deepEqual([...bytes], [0x50, 0x4b]); // ZIP / XLSX signature
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
