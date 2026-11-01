import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

// Dark until the saved theme loads; `useThemeSync` takes over from there.
document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

async function bootstrap() {
  if (import.meta.env.DEV) {
    const { installDevMock } = await import("./lib/dev-mock");
    installDevMock();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
