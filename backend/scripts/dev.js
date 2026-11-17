// 개발용 한 번에 실행: 백엔드 서버 + 프론트 화면을 한 창에서 같이 켭니다.
//
//   cd backend
//   npm run dev
//
// - 처음 실행이면 backend / frontend 의 npm install 을 자동으로 합니다.
// - 화면이 준비되면 브라우저(http://localhost:5173)를 자동으로 엽니다. (--no-open 으로 끄기)
// - Ctrl + C 를 누르면 둘 다 종료됩니다.
// ※ MySQL, Ollama 는 따로 켜져 있어야 '저장 + AI 분석'이 동작합니다.
//   (뉴스 수집 미리보기와 테스트 알림은 없어도 동작)

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..");
const FRONTEND_DIR = path.join(BACKEND_DIR, "frontend");
const isWindows = process.platform === "win32";
const openBrowser = !process.argv.includes("--no-open");

const COLORS = { server: "\x1b[36m", web: "\x1b[35m", dev: "\x1b[33m" };
const RESET = "\x1b[0m";

function log(name, text) {
    const prefix = `${COLORS[name]}[${name.padEnd(6)}]${RESET} `;
    for (const line of String(text).split(/\r?\n/)) {
        if (line.trim()) process.stdout.write(prefix + line + "\n");
    }
}

function ensureInstalled(dir, name) {
    if (fs.existsSync(path.join(dir, "node_modules"))) return;
    log("dev", `${name} 패키지가 없어서 설치합니다 (npm install, 1~2분)...`);
    const r = spawnSync("npm", ["install"], { cwd: dir, stdio: "inherit", shell: true });
    if (r.status !== 0) {
        log("dev", `${name} npm install 실패. 위 오류를 확인하세요.`);
        process.exit(1);
    }
}

function open(url) {
    const cmd = isWindows ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    spawn(cmd, { shell: true, stdio: "ignore", detached: true }).unref();
}

const children = [];
let shuttingDown = false;

function run(name, command, args, cwd, onLine) {
    const child = spawn(command, args, {
        cwd,
        shell: true,
        // 맥/리눅스: 별도 프로세스 그룹으로 실행해서 종료 시 하위 프로세스까지 한 번에 끔
        detached: !isWindows,
        env: { ...process.env, FORCE_COLOR: "1" },
    });
    children.push(child);

    const handle = (data) => {
        log(name, data);
        if (onLine) onLine(String(data));
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);

    child.on("exit", (code) => {
        if (shuttingDown) return;
        log("dev", `${name} 이(가) 종료되었습니다 (code ${code}). 나머지도 종료합니다.`);
        shutdown(code || 0);
    });
    return child;
}

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
        if (child.exitCode !== null) continue;
        if (isWindows) {
            // Windows 에서는 하위 프로세스(vite 등)까지 같이 종료
            spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            try {
                process.kill(-child.pid, "SIGTERM");
            } catch {
                child.kill("SIGTERM");
            }
        }
    }
    setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(FRONTEND_DIR, "package.json"))) {
    log("dev", "backend/frontend/package.json 이 없습니다. 레포 파일이 모두 있는지 확인하세요.");
    process.exit(1);
}

ensureInstalled(BACKEND_DIR, "backend");
ensureInstalled(FRONTEND_DIR, "frontend");

log("dev", "백엔드 서버와 화면을 시작합니다. 종료하려면 Ctrl + C");

run("server", "node", ["server.js"], BACKEND_DIR);

let opened = false;
run("web", "npm", ["run", "dev"], FRONTEND_DIR, (text) => {
    // vite 출력 예: "  ➜  Local:   http://localhost:5173/"
    const m = text.replace(/\x1b\[[0-9;]*m/g, "").match(/^\s*(?:➜\s*)?Local:\s+(https?:\/\/[^\s'"]+)\s*$/m);
    if (m && !opened) {
        opened = true;
        log("dev", `✅ 준비 완료 → ${m[1]}`);
        if (openBrowser) open(m[1]);
    }
});
