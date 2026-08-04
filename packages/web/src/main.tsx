import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { initUserInvalidSync } from "./user-invalid";

// document 全体の capture listener なので、React の外側で 1 回だけ張る。
initUserInvalidSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
