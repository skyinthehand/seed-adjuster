import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { SettingsPage } from "./pages/SettingsPage";
import { RunPage } from "./pages/RunPage";
import { ResultsPage } from "./pages/ResultsPage";

export function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/">実行</Link> | <Link to="/settings">設定</Link>
      </nav>
      <Routes>
        <Route path="/" element={<RunPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/results/:runId" element={<ResultsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
