-- 「고객 안내 현황」이 쓰는 **양식**을 고객사 표의 칸으로 옮기는 첫 조각(C-1).
--
-- 그 전까지는 양식마다 코드에 박아 둔 고객사 이름 목록으로 가렸다. 이름은 쓰는
-- 분이 화면에서 언제든 바꾸는 값이라, 2026-10-17 에 고객사 세 곳의 이름이 정식
-- 상호로 바뀌자 코드가 알던 이름 중 운영에 남은 것이 0개가 되어 표 셋이 통째로
-- 화면에서 사라졌다. 오류가 아니라 「아무것도 없음」이라 원인이 보이지 않는다.
--
-- 이 마이그레이션이 하는 일은 둘이다.
--   ① customers 에 널 허용 text 칸 하나를 더한다(왜 CHECK 도 enum 도 두지
--      않는지는 vendor/dss-core/src/schema/customers.ts 의 그 칸 주석에).
--   ② **지금 아는 이름 전부**로 기존 줄을 채운다 — 아래 UPDATE 셋.
--
-- ── 왜 지금 채우는가 ──────────────────────────────────────────────────────
-- 칸만 만들고 비워 두면, 판정이 이 칸을 보기 시작하는 다음 조각(C-2)이 배포되는
-- 순간 세 회사의 표가 또 사라진다. 이 조각 자체는 동작을 하나도 바꾸지 않는다 —
-- 양식 판정은 아직 코드의 이름 목록이 한다.
--
-- ── 열한 개를 다 적는 까닭 ────────────────────────────────────────────────
-- 개발 DB 와 운영 DB 의 고객사 이름이 서로 다르다(운영은 2026-10-17 에 정식
-- 상호로 바뀌었고, 개발 DB 와 과거 데이터에는 옛 이름이 그대로 있다). 하나만
-- 적으면 한쪽에서 한 줄도 채워지지 않는다. 그래서
-- src/lib/domain/customer-portal-forms.ts 의 세 customerNames 에 든 이름
-- 열한 개를 빠짐없이 적는다 — 그 일치는 시험이 못 박는다
-- (src/lib/db/schema/customer-portal-form-id.test.ts).
--
-- ── 맞춰 보는 자가 코드와 같다 ────────────────────────────────────────────
-- 코드는 normalizeEntityName(앞뒤 공백 정리 + 연속 공백 하나로 + 소문자)으로
-- 가린다. 여기 쓰는 lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) 가 바로
-- 그 식이고, 0022 가 customers_normalized_name_unique 에 쓴 것과 글자 그대로
-- 같다. 그래서 오른쪽 목록의 이름들이 **이미 정규화된(소문자) 꼴**로 적혀 있다.
--
-- ── 이 UPDATE 가 일부러 하지 않는 것 둘 ──────────────────────────────────
--   · is_deleted 로 거르지 않는다. 지워진 고객사의 과거 접수 건도 표에 뜬다.
--   · WHERE "portal_form_id" IS NULL — 이미 값이 있는 줄은 그대로 둔다. 이
--     마이그레이션이 두 번 돌 일은 없지만, 덮어쓰는 UPDATE 는 사람이 화면에서
--     고른 값을 되돌려 놓는다(그 화면은 C-3 에서 생긴다).

ALTER TABLE "customers" ADD COLUMN "portal_form_id" text;--> statement-breakpoint

UPDATE "customers"
SET "portal_form_id" = 'ICD'
WHERE "portal_form_id" IS NULL
  AND lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) IN (
    'icd co.,ltd.',
    'icd',
    '(주)아이씨디'
  );--> statement-breakpoint

UPDATE "customers"
SET "portal_form_id" = 'INVENIA'
WHERE "portal_form_id" IS NULL
  AND lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) IN (
    'invenia',
    'invenia co.,ltd',
    'invenia co.,ltd.',
    '인베니아(주)'
  );--> statement-breakpoint

UPDATE "customers"
SET "portal_form_id" = 'JUSUNG'
WHERE "portal_form_id" IS NULL
  AND lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) IN (
    'jusung',
    '주성 엔지니어링',
    '주성엔지니어링',
    '주성엔지니어링(주)'
  );
