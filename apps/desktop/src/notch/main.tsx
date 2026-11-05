import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Notch } from "./Notch";
import "../styles.css";
import "./notch.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Notch />
  </StrictMode>,
);
