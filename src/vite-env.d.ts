/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_LOGIN_EMAIL_DOMAIN?: string
  readonly VITE_PIN_PEPPER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
