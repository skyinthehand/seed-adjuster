import { HashRouter, Routes, Route, Link } from "react-router-dom";
import { SettingsPage } from "./pages/SettingsPage";
import { RunPage } from "./pages/RunPage";
import { RunStatusPage } from "./pages/RunStatusPage";
import { ResultsPage } from "./pages/ResultsPage";
import { WritebackConfirmPage } from "./pages/WritebackConfirmPage";

export function App() {
  return (
    <HashRouter>
      <nav>
        <Link to="/">実行</Link> | <Link to="/settings">設定</Link>
      </nav>
      <Routes>
        <Route path="/" element={<RunPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/runs/:runId" element={<RunStatusPage />} />
        <Route path="/results/:runId" element={<ResultsPage />} />
        <Route path="/writeback/:runId" element={<WritebackConfirmPage />} />
      </Routes>
    </HashRouter>
  );
}
