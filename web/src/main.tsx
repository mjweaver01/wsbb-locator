import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { LandingPage } from "./pages/LandingPage";
import { CoachAccessPage } from "./pages/CoachAccessPage";
import { AdminInvitePage } from "./pages/AdminInvitePage";
import { NotFoundPage } from "./pages/NotFoundPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/coach-access" element={<CoachAccessPage />} />
        <Route path="/admin" element={<AdminInvitePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
