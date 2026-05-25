/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_COACH_PATHWAY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
