import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: "localhost",
    watch: {
      // The backend writes to backend/logs/reason_runs.jsonl on every
      // Generate Response. Without this, Vite's file watcher picks up the
      // append and triggers a full page reload mid-animation, wiping the
      // canvas. Ignoring the whole backend tree also avoids reloads from
      // Python edits, __pycache__, .venv, etc.
      ignored: ["**/backend/**", "**/cashg-official-main/**"],
    },
  },
});

