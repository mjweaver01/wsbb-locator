import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { LandingPage } from "./pages/LandingPage";
import { CoachAccessPage } from "./pages/CoachAccessPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const routeTable: Record<string, () => JSX.Element> = {
  "/": LandingPage,
  "/coach-access": CoachAccessPage,
};
const CurrentPage = routeTable[pathname] ?? NotFoundPage;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CurrentPage />
  </StrictMode>,
);
