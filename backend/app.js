const express = require("express");
const cors = require("cors");
const articleRoutes = require("./routes/articleRoutes");
const alertRoutes = require("./routes/alertRoutes");
const clusterRoutes = require("./routes/clusterRoutes");

const app = express();

// 크롤러가 한국 시각으로 저장한 published_at을
// API 응답에서도 한국 시각으로 명시합니다.
// 다른 날짜 컬럼은 변경하지 않습니다.
function normalizePublishedAt(value) {
    if (typeof value !== "string") {
        return value;
    }

    const match = value.match(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/
    );

    if (!match) {
        return value;
    }

    return `${match[1]}T${match[2]}+09:00`;
}

app.set("json replacer", (key, value) => {
    if (key === "published_at") {
        return normalizePublishedAt(value);
    }

    return value;
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("server running");
});

app.use("/api/articles", articleRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/clusters", clusterRoutes);
app.use("/api/crawler", require("./routes/crawlerRoutes"));
app.use("/api/notify", require("./routes/notifyRoutes"));
app.use("/api/risk-training", require("./routes/riskTrainingRoutes"));

module.exports = app;