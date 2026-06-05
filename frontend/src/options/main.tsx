import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Options from "./Options";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Options root container was not found");
}

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>
);
