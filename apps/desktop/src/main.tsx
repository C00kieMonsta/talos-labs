import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/guided.css";
import "./styles/ai-guided.css";
import "./styles/ai-expert.css";
import "./styles/fishy.css";
import "./styles/accept.css";
import "./styles/chat.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
