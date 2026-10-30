// Entry point: loads the styles and mounts the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/theme.css";
import "./styles/receipt-check.css";
import "./styles/pages.css";
import "./styles/camera.css";
import "./styles/knowledge-base.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
