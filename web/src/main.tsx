import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import "./index.css";
import { LandingPage } from "./pages/LandingPage";
import { CoachAccessPage } from "./pages/CoachAccessPage";
import { AdminInvitePage } from "./pages/AdminInvitePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { initEmbedAutoResize, notifyEmbedNavigated } from "./lib/embed";

// Report our content height to a host page (e.g. Shopify) when this SPA is
// embedded in an iframe, so the host can size the frame with no inner scrollbar.
initEmbedAutoResize();

function ScrollToTop() {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip the initial mount: scrolling the host on first load would yank the
    // page down to the iframe. Only react to real in-app navigations.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    notifyEmbedNavigated();
  }, [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/coach-access" element={<CoachAccessPage />} />
        <Route path="/admin" element={<AdminInvitePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
