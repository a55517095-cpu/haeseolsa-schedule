-- ============================================================================
--  마이그레이션: 변경 이력 메모 공개 범위
--
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전합니다)
--  migration_change_memo.sql 을 먼저 실행해야 합니다.
--
--  무엇이 달라지나
--   메모마다 누구에게 보일지 고를 수 있습니다.
--     private  : 나만
--     involved : 그 변경에 관련된 사람 (근무를 주고받은 사람, 변경한 사람)
--     all      : 로그인한 모든 사람 (관리자 포함)
--   이미 쓴 메모는 "나만" 으로 남습니다.
-- ============================================================================

alter table public.change_memos
  add column if not exists visibility text not null default 'private';

alter table public.change_memos drop constraint if exists change_memos_visibility_check;
alter table public.change_memos
  add constraint change_memos_visibility_check
  check (visibility in ('private', 'involved', 'all'));

-- 내가 그 이력 카드(교대는 두 줄)에 관련된 사람인가
create or replace function public.involved_in_change(p_log_key uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.change_logs c
     where (c.id = p_log_key or c.swap_group_id = p_log_key)
       and public.current_member_id() in (c.actor_id, c.before_member_id, c.after_member_id)
  )
$fn$;

-- 읽기: 내 메모 + 모두 공개 + (관련된 사람 공개이고 내가 관련된 경우)
drop policy if exists change_memos_read_own on public.change_memos;
drop policy if exists change_memos_read on public.change_memos;
create policy change_memos_read on public.change_memos
  for select to authenticated
  using (
    member_id = public.current_member_id()
    or visibility = 'all'
    or (visibility = 'involved' and public.involved_in_change(log_key))
  );

-- 쓰기 함수에 공개 범위를 더한다 (예전 두 칸짜리 함수는 지운다)
drop function if exists public.set_change_memo(uuid, text);

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
  if v_vis not in ('private', 'involved', 'all') then
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
