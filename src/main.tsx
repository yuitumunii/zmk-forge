import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { ToastProvider } from "./misc/toast";
import "./index.css";

// NOTE: App 自身が useToast() を呼ぶため、Provider は App の外側に置く
// （App内に置くと Provider 外呼び出しで起動時クラッシュする）。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
