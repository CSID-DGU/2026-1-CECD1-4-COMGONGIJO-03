"use strict";

// Article publication date defines the daily clustering boundary.
// mysql2 may return DATETIME as a JavaScript Date or as a DB date string.
// Invalid / missing publication timestamps fall back to actual processing time.
function formatDate(value, now = new Date()) {
    if (value instanceof Date) {
        if (Number.isFinite(value.getTime())) {
            const parts = [value.getFullYear(), value.getMonth() + 1, value.getDate()];
            return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
        }
    } else if (typeof value === "string") {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
        if (match) {
            const [year, month, day] = match.slice(1).map(Number);
            const check = new Date(Date.UTC(year, month - 1, day));
            if (check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day) {
                return match[1] + "-" + match[2] + "-" + match[3];
            }
        }
    }
    if (value !== now) return formatDate(now, now);
    throw new Error("Cannot determine cluster date");
}

function clusterTimestamp(value, now = new Date()) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?/.test(value)) {
        const day = formatDate(value, now);
        const match = value.match(/[ T](\d{2}:\d{2}:\d{2})/);
        return day + " " + (match ? match[1] : "00:00:00");
    }
    return now;
}

module.exports = { formatDate, clusterTimestamp };
