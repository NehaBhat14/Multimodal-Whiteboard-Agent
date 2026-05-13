import "tldraw/tldraw.css";
import "./index.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { WhiteboardLayout } from "./whiteboard/WhiteboardLayout";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <React.StrictMode>
    <WhiteboardLayout />
  </React.StrictMode>,
);

