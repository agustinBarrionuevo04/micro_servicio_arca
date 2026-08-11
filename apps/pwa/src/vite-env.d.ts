/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the real API (e.g. http://localhost:3000/v1). Used only when VITE_API_MOCK !== 'true'. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * When 'true' (the default while backend branches are still in flight), src/api/client.ts
   * returns realistic fake data instead of making network requests. See src/api/client.ts
   * header comment.
   */
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
