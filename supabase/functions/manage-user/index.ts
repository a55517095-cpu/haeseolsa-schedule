// ============================================================================
//  manage-user - 해설사 계정 만들기 / PIN 재설정 / 사용중지
//
//  브라우저에서는 절대 다룰 수 없는 서비스 키가 필요한 작업만 모아둔 함수입니다.
//  배포:  supabase functions deploy manage-user
//  필요한 설정(Secrets):  LOGIN_EMAIL_DOMAIN, PIN_PEPPER
//    supabase secrets set LOGIN_EMAIL_DOMAIN=guide.local PIN_PEPPER=jeju-guide-2026
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const EMAIL_DOMAIN = Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'guide.local'
const PIN_PEPPER = Deno.env.get('PIN_PEPPER') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const passwordFor = (pin: string) => `${pin}${PIN_PEPPER}`
const emailFor = (loginCode: string) => `${loginCode}@${EMAIL_DOMAIN}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: '로그인이 필요합니다.' }, 401)

    // 호출자 확인 — 요청자의 토큰으로 만든 클라이언트라 RLS가 그대로 적용된다
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData } = await caller.auth.getUser()
    if (!userData?.user) return json({ error: '로그인이 필요합니다.' }, 401)

    const { data: me } = await caller
      .from('members')
      .select('id, role, login_code')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle()

    const isAdmin = me?.role === 'admin'
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json()
    const action = String(body.action ?? '')

    // ── 본인 PIN 변경 (누구나 가능) ──────────────────────────────────────
    if (action === 'change_my_pin') {
      const pin = String(body.pin ?? '')
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN은 숫자 4자리여야 합니다.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(userData.user.id, {
        password: passwordFor(pin),
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (!isAdmin) return json({ error: '관리자만 할 수 있는 작업입니다.' }, 403)

    // ── 해설사 추가 ─────────────────────────────────────────────────────
    if (action === 'create_member') {
      const name = String(body.name ?? '').trim()
      const loginCode = String(body.login_code ?? '').trim().toLowerCase()
      const pin = String(body.pin ?? '0000')
      if (!name) return json({ error: '이름을 입력하세요.' }, 400)
      if (!/^[a-z0-9_-]{2,20}$/.test(loginCode))
        return json({ error: '계정 식별자는 영문 소문자와 숫자 2~20자여야 합니다.' }, 400)
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN은 숫자 4자리여야 합니다.' }, 400)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailFor(loginCode),
        password: passwordFor(pin),
        email_confirm: true,
      })
      if (createErr) return json({ error: `계정 생성 실패: ${createErr.message}` }, 400)

      const { error: memberErr } = await admin.from('members').insert({
        login_code: loginCode,
        name,
        role: body.role === 'admin' ? 'admin' : 'member',
        phone: body.phone ?? null,
        group_label: body.group_label ?? null,
        weekend_only: !!body.weekend_only,
        auth_user_id: created.user.id,
      })
      if (memberErr) {
        // 명단 등록에 실패하면 방금 만든 계정도 지워서 찌꺼기를 남기지 않는다
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: `명단 등록 실패: ${memberErr.message}` }, 400)
      }
      return json({ ok: true })
    }

    // ── 기존 명단에 로그인 계정 연결 (seed.sql 로 넣은 사람들) ──────────
    if (action === 'link_member') {
      const memberId = String(body.member_id ?? '')
      const pin = String(body.pin ?? '0000')
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN은 숫자 4자리여야 합니다.' }, 400)

      const { data: member, error: findErr } = await admin
        .from('members')
        .select('id, login_code, auth_user_id')
        .eq('id', memberId)
        .maybeSingle()
      if (findErr || !member) return json({ error: '명단에서 찾을 수 없습니다.' }, 404)
      if (member.auth_user_id) return json({ error: '이미 로그인 계정이 있습니다.' }, 400)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailFor(member.login_code),
        password: passwordFor(pin),
        email_confirm: true,
      })
      if (createErr) return json({ error: `계정 생성 실패: ${createErr.message}` }, 400)

      const { error: updErr } = await admin
        .from('members')
        .update({ auth_user_id: created.user.id })
        .eq('id', memberId)
      if (updErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: updErr.message }, 400)
      }
      return json({ ok: true })
    }

    // ── PIN 초기화 ──────────────────────────────────────────────────────
    if (action === 'reset_pin') {
      const memberId = String(body.member_id ?? '')
      const pin = String(body.pin ?? '0000')
      if (!/^\d{4}$/.test(pin)) return json({ error: 'PIN은 숫자 4자리여야 합니다.' }, 400)

      const { data: member } = await admin
        .from('members')
        .select('auth_user_id')
        .eq('id', memberId)
        .maybeSingle()
      if (!member?.auth_user_id) return json({ error: '로그인 계정이 없는 사람입니다.' }, 400)

      const { error } = await admin.auth.admin.updateUserById(member.auth_user_id, {
        password: passwordFor(pin),
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ── 사용 중지 / 재사용 ───────────────────────────────────────────────
    if (action === 'set_active') {
      const memberId = String(body.member_id ?? '')
      const active = !!body.active
      const { error } = await admin.from('members').update({ active }).eq('id', memberId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: `알 수 없는 요청입니다: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
