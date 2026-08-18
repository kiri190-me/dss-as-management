-- End-User 다중 담당자 체크포인트 (감사 승인 완료) — 하나의 End-User가
-- 여러 담당자를 가질 수 있도록 end_user_contacts(1:N)를 도입하고,
-- end_users.contact_name/contact_email을 제거한다. 이 두 컬럼은 애플리케이션
-- 코드가 쓴 적이 없었다(resolveOrCreateEndUserByName은 항상
-- {customerId, name}만 삽입) — 라이브 데이터 프리플라이트에서 dev seed
-- 스크립트가 채워둔 데모 데이터 9건만 발견됨(모두 *.example.test 이메일,
-- 동일한 시드 타임스탬프 — 실제 고객 데이터 아님). 백필 후 제거한다.
--
-- 백필 순서가 중요하다: end_user_contacts를 먼저 만들고, DROP COLUMN 전에
-- 기존 값을 옮긴다 — 0021(billing_type) 마이그레이션과 동일한
-- "구조 생성 -> 데이터 이관 -> 구컬럼 제거" 순서.
--
-- contact_name NOT NULL 안전성: end_user_contacts.contact_name은 NOT NULL이다
-- (담당자 행은 이름이 있어야만 의미가 있다). 백필 WHERE절은 요구사항대로
-- contact_name IS NOT NULL OR contact_email IS NOT NULL이지만, 라이브 데이터
-- 프리플라이트에서 이메일만 있고 이름이 없는 행은 0건임을 이미 확인했다 —
-- 만약 그런 행이 실제로 존재했다면 이 INSERT는 NOT NULL 위반으로 그 자리에서
-- 실패해야 정상이다(이름 없는 담당자 행을 조용히 만들어내지 않는다).

CREATE TABLE "end_user_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"end_user_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
ALTER TABLE "end_user_contacts" ADD CONSTRAINT "end_user_contacts_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_user_contacts" ADD CONSTRAINT "end_user_contacts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "end_user_contacts_end_user_id_idx" ON "end_user_contacts" USING btree ("end_user_id");--> statement-breakpoint
CREATE INDEX "end_user_contacts_not_deleted_idx" ON "end_user_contacts" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint

INSERT INTO "end_user_contacts" ("end_user_id", "contact_name", "contact_email")
SELECT "id", "contact_name", "contact_email"
FROM "end_users"
WHERE "contact_name" IS NOT NULL OR "contact_email" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "end_users" DROP COLUMN "contact_name";--> statement-breakpoint
ALTER TABLE "end_users" DROP COLUMN "contact_email";
