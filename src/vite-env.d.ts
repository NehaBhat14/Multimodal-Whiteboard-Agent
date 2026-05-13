/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REASON_STREAMING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

