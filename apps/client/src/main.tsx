import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { applyCharacterTheme } from "./characters";
import { applyTheme, readTheme } from "./lib/theme";
import { applyA11y, readA11y } from "./lib/a11y";
import "./styles/base.css";
import "./styles/characters.css";
import "./styles/ocean.css";
import "./styles/layout.css";
import "./styles/kit.css";

applyTheme(readTheme());
applyA11y(readA11y());
applyCharacterTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
