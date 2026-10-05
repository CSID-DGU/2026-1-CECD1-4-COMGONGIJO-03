const express = require("express");
const cors = require("cors");
const articleRoutes = require("./routes/articleRoutes");
const alertRoutes = require("./routes/alertRoutes");
const clusterRoutes = require("./routes/clusterRoutes");
const spamRoutes = require("./routes/spamRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("server running");
});

app.use("/api/articles", articleRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/clusters", clusterRoutes);
app.use("/api/spam-articles", spamRoutes);

module.exports = app;
