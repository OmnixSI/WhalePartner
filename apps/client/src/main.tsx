import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { applyCharacterTheme } from "./characters";
import { applyTheme, readTheme } from "./lib/theme";
import "./styles/base.css";
import "./styles/characters.css";
import "./styles/ocean.css";
import "./styles/layout.css";

applyTheme(readTheme());
applyCharacterTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
