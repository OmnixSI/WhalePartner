import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CardPreviewPage } from "./CardPreviewPage";
import { applyA11y, readA11y } from "../lib/a11y";
import "../styles/base.css";
import "../styles/characters.css";
import "../styles/ocean.css";

document.documentElement.setAttribute("data-character", "deepseek");
applyA11y(readA11y());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CardPreviewPage />
  </StrictMode>,
);
