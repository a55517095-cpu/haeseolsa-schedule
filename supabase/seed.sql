-- ============================================================================
--  해설사 근무편성표 - 기초 데이터 (근무지 / 해설사 명단)
--  schema.sql 을 먼저 실행한 뒤에 이 파일을 실행하세요.
--  명단은 2026년 9월 근무편성표 기준입니다. 나중에 앱의 [직원 관리]에서 고칠 수 있습니다.
-- ============================================================================

-- --- 근무지 -----------------------------------------------------------------
-- 조 구분 없이 근무지 10곳이 한 표에 들어갑니다. 순서는 종이 근무표와 같습니다.
insert into public.posts (name, sort_order) values
  ('시공원',       1),
  ('기당미술관',   2),
  ('서복전시관2',  3),
  ('탐방1',        4),
  ('탐방2',        5),
  ('소암기념관',   6),
  ('종합안내소',   7),
  ('서복전시관1',  8),
  ('거주지1',      9),
  ('거주지2',     10)
on conflict (name) do update set sort_order = excluded.sort_order, active = true;

-- --- 해설사 명단 -------------------------------------------------------------
-- login_code 는 시스템 내부용 식별자입니다. 사용자는 절대 입력하지 않고,
-- 로그인 화면에서 자기 이름 버튼을 누르기만 하면 됩니다.
-- group_label 은 그 사람이 주로 서는 자리로, 근무표 명단을 묶어 보여줄 때만 씁니다.
-- weekend_only 는 주말에만 나오는 분(종이 근무표의 파란 밑줄)입니다.
insert into public.members (login_code, name, group_label, weekend_only, role) values
  ('a01', '고혜자', '시공원',     false, 'member'),
  ('a02', '김태순', '시공원',     false, 'member'),
  ('a03', '문선미', '시공원',     false, 'member'),
  ('a04', '박향란', '시공원',     false, 'member'),
  ('a05', '김봉하', '시공원',     false, 'member'),
  ('a06', '문상금', '기당미술관', false, 'member'),
  ('a07', '문춘희', '기당미술관', false, 'member'),
  ('a08', '정영자', '기당미술관', false, 'member'),
  ('a09', '허은주', '기당미술관', false, 'member'),
  ('a10', '공윤경', '탐방',       true,  'member'),
  ('a11', '김은희', '탐방',       true,  'member'),
  ('b01', '강연희', '소암기념관', false, 'member'),
  ('b02', '고보옥', '소암기념관', false, 'member'),
  ('b03', '부의화', '소암기념관', false, 'member'),
  ('b04', '이화영', '소암기념관', false, 'member'),
  ('b05', '김명준', '소암기념관', false, 'member'),
  ('b06', '민영경', '종합안내소', false, 'member'),
  ('b07', '유점숙', '종합안내소', false, 'member'),
  ('b08', '장인옥', '종합안내소', false, 'member'),
  ('b09', '현경조', '종합안내소', false, 'member'),
  ('b10', '김숙향', '종합안내소', false, 'member'),
  ('b11', '김영선', '거주지',     true,  'member'),
  ('b12', '부경자', '거주지',     true,  'member'),
  ('b13', '오재영', '거주지',     true,  'member'),
  ('b14', '김희경', '거주지',     true,  'member'),
  -- 관리자 계정
  ('admin', '관리자', null, false, 'admin')
on conflict (login_code) do update
  set name         = excluded.name,
      group_label  = excluded.group_label,
      weekend_only = excluded.weekend_only;

-- ============================================================================
--  마지막 단계: 첫 관리자 로그인 연결
--
--  1) Supabase 대시보드 > Authentication > Users > "Add user" > "Create new user"
--     - Email    : admin@guide.local          (.env 의 VITE_LOGIN_EMAIL_DOMAIN 과 맞출 것)
--     - Password : 0000jeju-guide-2026        (PIN 4자리 + VITE_PIN_PEPPER 를 붙여쓴 값)
--     - "Auto Confirm User" 체크
--  2) 그런 다음 아래 한 줄을 실행하세요.
-- ============================================================================

update public.members
   set auth_user_id = (select id from auth.users where email = 'admin@guide.local')
 where login_code = 'admin';
