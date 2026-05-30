import { useMemo, useState } from "react";
import DashboardPage from "./pages/DashboardPage";
import RiskyArticlesPage from "./pages/RiskyArticlesPage";
import AlertsPage from "./pages/AlertsPage";

const navItems = [
  { id: "dashboard", label: "기사 목록" },
  { id: "risky", label: "위험 기사" },
  { id: "alerts", label: "알림" }
];

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");

  const pageTitle = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label || "기사 목록",
    [activePage]
  );

  return (
    <div className="appShell">
      <header className="appHeader">
        <div>
          <span className="eyebrow">backend API 연결</span>
          <h1>{pageTitle}</h1>
        </div>
        <nav className="topNav" aria-label="주요 화면">
          {navItems.map((item) => (
            <button
              className={activePage === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {activePage === "dashboard" && <DashboardPage />}
        {activePage === "risky" && <RiskyArticlesPage />}
        {activePage === "alerts" && <AlertsPage />}
      </main>
    </div>
  );
}
