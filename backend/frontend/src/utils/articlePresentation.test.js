import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSentiment, riskEmphasisClass, sentimentInfo } from "./articlePresentation.js";

test("risk emphasis uses 0.4 warning and 0.6 high thresholds", () => {
  for (const value of [null, undefined, "", "not a number", 0, 0.39]) {
    assert.equal(riskEmphasisClass(value), "");
  }

  assert.equal(riskEmphasisClass(0.4), "riskEmphasisWarning");
  assert.equal(riskEmphasisClass(0.59), "riskEmphasisWarning");
  assert.equal(riskEmphasisClass(0.6), "riskEmphasisHigh");
  assert.equal(riskEmphasisClass(0.8), "riskEmphasisHigh");
});

test("Korean and model sentiment labels have distinct categories", () => {
  assert.deepEqual(["very_positive", "긍정", "neutral", "중립", "negative", "very_negative", "공감", null]
    .map((label) => sentimentInfo(label).category),
    ["positive", "positive", "neutral", "neutral", "negative", "negative", "empathy", "pending"]);
  assert.equal(sentimentInfo("very_negative").label, "매우 부정");
  assert.equal(sentimentInfo("very_positive").label, "매우 긍정");
});

test("neutral filter does not accidentally include legacy empathy", () => {
  assert.equal(matchesSentiment({ sentiment_label: "neutral" }, "neutral"), true);
  assert.equal(matchesSentiment({ sentiment_label: "공감" }, "neutral"), false);
  assert.equal(matchesSentiment({ sentiment_label: "공감" }, "empathy"), true);
  assert.equal(matchesSentiment({ sentiment_label: "very_negative" }, "negative"), true);
  assert.equal(matchesSentiment({}, "all"), true);
});
