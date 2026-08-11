/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the real API (e.g. http://localhost:3000/v1). Used only when VITE_API_MOCK === 'false'. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Any value other than the literal string 'false' (including unset) keeps src/api/client.ts
   * in mock mode, returning realistic fake data instead of making network requests — this is the
   * default while backend branches are still in flight. Set to exactly 'false' to hit
   * VITE_API_BASE_URL for real. See src/api/client.ts header comment.
   */
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
