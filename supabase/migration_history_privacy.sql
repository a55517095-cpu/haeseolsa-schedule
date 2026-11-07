-- ============================================================================
--  마이그레이션: 변경 이력 · 메모를 근무자끼리 보지 않게
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--  migration_change_memo.sql, migration_memo_visibility.sql 을 먼저 실행해야 합니다.
--
--  무엇이 달라지나
--   1. 변경 이력: 해설사는 자기가 바꿨거나 자기 근무가 바뀐 이력만 읽을 수 있습니다.
--      (지금까지는 화면에서만 숨겼고, 데이터베이스는 모두에게 열려 있었습니다)
--      관리자는 전부 봅니다.
--   2. 메모 공개 범위를 두 가지로 줄입니다. 관리자는 언제나 봅니다.
--        private  : 나만 (+ 관리자)
--        involved : 교대 상대도 (+ 관리자)
--      "모두" 로 저장된 메모는 "교대 상대도" 로 바뀝니다.
-- ============================================================================

-- --- 1. 변경 이력 읽기 제한 -------------------------------------------------

drop policy if exists change_logs_read on public.change_logs;
create policy change_logs_read on public.change_logs
  for select to authenticated
  using (
    public.is_admin()
    or public.current_member_id() in (actor_id, before_member_id, after_member_id)
  );

-- --- 2. 메모 공개 범위 두 가지 ----------------------------------------------

update public.change_memos set visibility = 'involved' where visibility = 'all';

alter table public.change_memos drop constraint if exists change_memos_visibility_check;
alter table public.change_memos
  add constraint change_memos_visibility_check
  check (visibility in ('private', 'involved'));

drop policy if exists change_memos_read on public.change_memos;
create policy change_memos_read on public.change_memos
  for select to authenticated
  using (
    member_id = public.current_member_id()
    or public.is_admin()
    or (visibility = 'involved' and public.involved_in_change(log_key))
  );

create or replace function public.set_change_memo(
  p_log_key uuid, p_body text, p_visibility text default 'private'
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  me_id uuid := public.current_member_id();
  v_body text := left(btrim(coalesce(p_body, '')), 100);
  v_vis text := coalesce(p_visibility, 'private');
begin
  if me_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if v_vis not in ('private', 'involved') then
    raise exception '공개 범위가 올바르지 않습니다.';
  end if;

  if v_body = '' then
    delete from public.change_memos where member_id = me_id and log_key = p_log_key;
    return;
  end if;

  insert into public.change_memos (member_id, log_key, body, visibility)
  values (me_id, p_log_key, v_body, v_vis)
  on conflict (member_id, log_key)
    do update set body = excluded.body, visibility = excluded.visibility, updated_at = now();
end $fn$;
