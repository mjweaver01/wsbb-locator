import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { LandingPage } from "./pages/LandingPage";
import { CoachAccessPage } from "./pages/CoachAccessPage";
import { AdminInvitePage } from "./pages/AdminInvitePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { initEmbedAutoResize } from "./lib/embed";

// Report our content height to a host page (e.g. Shopify) when this SPA is
// embedded in an iframe, so the host can size the frame with no inner scrollbar.
initEmbedAutoResize();

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
