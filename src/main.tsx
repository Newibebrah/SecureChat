import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Force these modules into the entry chunk so the zustand stores
// are created synchronously before Layout (lazy chunk) renders.
import "./stores/contactStore";
import "./stores/messageStore";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
