import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    '.env 파일에 VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 넣어주세요. (.env.example 참고)',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const LOGIN_EMAIL_DOMAIN = import.meta.env.VITE_LOGIN_EMAIL_DOMAIN ?? 'guide.local'
const PIN_PEPPER = import.meta.env.VITE_PIN_PEPPER ?? ''

/** 로그인 화면에서 이름 버튼을 누르면 이 계정으로 로그인한다 */
export const emailForLoginCode = (loginCode: string) => `${loginCode}@${LOGIN_EMAIL_DOMAIN}`

/**
 * PIN 4자리를 Supabase 의 최소 비밀번호 길이에 맞춰 늘린다.
 * PIN_PEPPER 를 바꾸면 기존 PIN 이 전부 무효가 되므로 한 번 정하면 바꾸지 않는다.
 */
export const passwordForPin = (pin: string) => `${pin}${PIN_PEPPER}`
