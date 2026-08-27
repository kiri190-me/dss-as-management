import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { productModels } from "./product-models";
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * ============================================================================
 * 첨부 파일 — 이 표가 무엇이고, 무엇이 아닌가
 * ============================================================================
 * **이 표에 파일 내용은 들어오지 않는다.** 바이너리는 디스크에 있고
 * (저장 루트: C:\DSS-AS-DATA\uploads), 이 표는 그 파일이 무엇인지 · 어디 있는지 ·
 * 누가 언제 올렸는지만 적는다. bytea/large object 컬럼은 일부러 두지 않았다 —
 * 회로도·펌웨어·오실로스코프 덤프처럼 큰 파일이 들어올 자리라 DB에 넣으면
 * 백업과 복제가 감당하지 못한다.
 *
 * 지금까지 첨부는 "데모"였다. 화면과 분류는 있었지만 파일 내용을 읽는 코드가
 * 저장소에 한 줄도 없었고, 메타데이터는 브라우저 localStorage에만 있었다
 * (src/lib/domain/local/attachments/attachment-types.ts). 이 표가 그 데모를
 * 실제 저장으로 바꾸는 첫 단계이며, **이번 단계는 표와 권한 자리를 만드는
 * 데까지다** — 업로드·다운로드·저장소 어댑터는 다음 단계다.
 *
 * ── 첨부 대상은 접수 건과 제품 모델 둘이다 ───────────────────────────────
 * 처음에는 A/S 접수 건 하나뿐이었다. 여기에 **제품 모델**(product_models)이
 * 더해졌다 — 모델의 외형 사진과 회로도를 붙이기 위해서다. 대상이 둘이 된
 * 지금도 다형 참조(owner_type + owner_id)를 쓰지 않는다: 그 구조는 외래키를
 * 포기해야 하고, 그러면 지금 ON DELETE SET NULL 이 공짜로 해 주는 일을
 * 애플리케이션 코드가 손으로 해야 한다. 대신 **주인 후보마다 NULL 허용 FK
 * 컬럼을 하나씩 두고, 둘이 동시에 차는 것만 CHECK 로 막는다**(아래
 * attachments_owner_not_both 참조).
 *
 * 같은 표를 쓰는 것도 의도된 선택이다. 백업 스크립트(scripts/backup-attachments.ts)가
 * 이 표를 조건절 없이 통째로 읽고 저장 루트 전체를 훑기 때문에, 같은 표에
 * 얹으면 백업·SHA-256 대조·휴지통·중복 판단·감사 기록이 손대지 않은 채
 * 그대로 따라온다. 표를 따로 만들면 그 다섯을 전부 두 벌 만들어야 한다.
 *
 * 작업기록(repair_case_work_records)이나 결재(repair_case_approvals)에 붙는
 * 첨부는 여전히 만들지 않는다. 교산 승인 증빙 첨부도 폐기된 설계라
 * shipment_approval_id 컬럼이 없다.
 *
 * ── stored_path 에는 절대경로를 넣지 않는다 ──────────────────────────────
 * 저장 루트 기준 **상대 경로**만 넣는다(예: "2026/08/<uuid>.jpg").
 * "C:\DSS-AS-DATA\uploads\2026\08\..." 처럼 루트를 통째로 적으면, 저장소를
 * NAS나 다른 드라이브로 옮기는 순간 이 표의 **모든 행을 UPDATE 해야 한다.**
 * 루트는 설정값 하나로 남기고 행에는 루트 아래의 자리만 적어 두면, 이전은
 * 파일을 복사하고 설정 한 줄을 바꾸는 일이 된다.
 *
 * original_file_name 도 디스크 경로에는 쓰지 않는다. 사용자가 올린 이름에는
 * 경로 구분자나 "..", 윈도우 예약어가 섞일 수 있어 그대로 파일명으로 쓰면
 * 저장 루트 밖으로 나가는 경로가 만들어진다. 표시와 다운로드 시 파일명으로만
 * 쓰고, 디스크의 이름은 stored_path 가 따로 정한다.
 *
 * ── 접수 건이 영구 삭제돼도 파일 기록은 남는다 ───────────────────────────
 * repair_case_id 는 NULL 을 허용하고 ON DELETE SET NULL 이다. 접수 건을
 * 영구 삭제하면 **연결만 끊기고** 이 행도 디스크의 실물도 그대로 남는다.
 * repair_case_approvals 가 같은 이유로 같은 방식을 쓴다(그 파일의 주석 참조) —
 * 그쪽은 "승인 결정은 역사적 사실"이라서였고, 여기서는 지운 뒤에야 필요해지는
 * 증빙(고객 분쟁, 반입 상태 사진)이 접수 건과 함께 사라지면 안 되기 때문이다.
 * NOT NULL + RESTRICT 로 두면 접수 건 영구 삭제 자체가 DB 레벨에서 막힌다.
 *
 * ── PII ──────────────────────────────────────────────────────────────────
 * 이 표의 컬럼에는 고객 연락처가 없다. 다만 original_file_name 과 description
 * 은 사람이 자유롭게 적는 값이라 고객사명·담당자명이 섞일 수 있다 — 로그나
 * 오류 보고로 그대로 내보내지 않는다.
 * ============================================================================
 */

/**
 * 값·순서 모두 src/lib/domain/attachment-category.ts 의
 * ATTACHMENT_CATEGORY_CODES 와 정확히 같아야 한다. 스키마 레이어는 도메인
 * 레이어를 import 하지 않는 규칙이라(repair-cases.ts 의 billingTypeEnum 주석)
 * 값을 복제해 두고, 어긋남은 attachment-category.test.ts 가 잡는다.
 * 둘 중 하나를 바꾸면 반드시 같이 바꿀 것.
 */
export const attachmentCategoryEnum = pgEnum("attachment_category", [
  "INTAKE_PHOTO",
  "EXTERNAL_CONDITION",
  "IN_REPAIR",
  "AFTER_REPAIR",
  "SHIPMENT_PHOTO",
  "INSPECTION_REPORT",
  "REPAIR_REPORT",
  "KYOSAN_DOCUMENT",
  "CUSTOMER_DOCUMENT",
  "OSCILLOSCOPE_DATA",
  "LOG_FILE",
  "FIRMWARE",
  "CIRCUIT_DIAGRAM",
  "OTHER",
]);

/**
 * 검사 엔진은 아직 없다 — 상태를 적을 자리만 먼저 만든다. 지금 들어오는 모든
 * 행은 NOT_SCANNED 이고, 그것이 "검사하지 않았다"는 사실의 기록이다.
 *
 * 데모 파일의 LocalMalwareScanStatus(NOT_SCANNED/PENDING/CLEAN/BLOCKED/ERROR)와
 * 뒤 두 값이 다르다. 승인된 설계가 INFECTED/FAILED 이고, 두 목록을 섞어 쓰지
 * 않는다. 마찬가지로 domain/types.ts 의 AttachmentMetadata.malwareScanStatus
 * (PENDING/CLEAN/INFECTED 세 값)와도 다른 타입이다.
 */
export const malwareScanStatusEnum = pgEnum("attachment_malware_scan_status", [
  "NOT_SCANNED",
  "PENDING",
  "CLEAN",
  "INFECTED",
  "FAILED",
]);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL 허용 + ON DELETE SET NULL — 파일 정본이 접수 건보다 오래 산다.
    // 파일 헤더의 '접수 건이 영구 삭제돼도' 항목 참조.
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    // 제품 모델(장비 종류)에 붙는 파일 — 모델의 외형 사진과 회로도가 여기
    // 걸린다. 접수 건과 달리 **모델 첨부는 건마다가 아니라 모델마다 한 벌**이라,
    // 같은 회로도를 접수 건 수만큼 다시 올리지 않아도 된다.
    //
    // repairCaseId 와 같은 이유로 NULL 허용 + ON DELETE SET NULL 이다 — 파일
    // 정본이 모델보다 오래 산다. restrict 로 두면 모델 마스터 행을 영영 지울 수
    // 없고, cascade 로 두면 모델 하나를 지우는 실수가 그 모델의 회로도 전부를
    // 함께 지운다. 연결만 끊고 파일 기록과 디스크 실물은 남긴다.
    productModelId: uuid("product_model_id").references(() => productModels.id, {
      onDelete: "set null",
    }),
    category: attachmentCategoryEnum("category").notNull(),
    // 사용자가 올린 그대로의 이름. 표시와 다운로드 파일명으로만 쓰고, 디스크
    // 경로를 만드는 데는 절대 쓰지 않는다(파일 헤더 참조).
    originalFileName: text("original_file_name").notNull(),
    // **저장 루트 기준 상대 경로.** 절대경로 금지 — 루트를 행마다 적으면
    // 저장소를 옮길 때 모든 행을 UPDATE 해야 한다(파일 헤더 참조).
    storedPath: text("stored_path").notNull(),
    // 섬네일/미리보기 파일의 상대 경로. 생성기가 아직 없어 이번 단계에서는
    // 항상 NULL 이다 — 나중에 컬럼을 새로 만들지 않으려고 자리만 둔다.
    previewPath: text("preview_path"),
    mimeType: text("mime_type").notNull(),
    // 상한은 앱에서 20MB 로 강제한다. 그런데도 integer 가 아니라 bigint 인
    // 이유는, 상한을 올리는 날 컬럼 타입을 바꾸지 않기 위해서다 — integer 로
    // 두면 2GB 에서 막히고, 그때의 ALTER 는 큰 표에서 잠금을 오래 잡는다.
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    // 업로드된 바이트의 SHA-256(소문자 hex). 같은 파일이 두 번 올라왔는지,
    // 디스크의 실물이 그대로인지 판단하는 유일한 근거다.
    checksumSha256: text("checksum_sha256").notNull(),
    malwareScanStatus: malwareScanStatusEnum("malware_scan_status")
      .notNull()
      .default("NOT_SCANNED"),
    description: text("description"),
    // 업로더가 비활성화되거나 퇴사해도 파일은 계속 열람된다(보안 정책).
    // 그래서 RESTRICT — users 행을 실제로 지우는 일 자체를 막는다. 이
    // 저장소의 다른 표들이 users 를 가리키는 방식과 같다.
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8). 휴지통에 있는 동안 디스크의
    // 실물은 건드리지 않는다 — 복원이 파일을 되찾는 일이 아니라 플래그를
    // 되돌리는 일이어야 하기 때문이다.
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    // 접수 건 상세의 파일 탭이 매번 쏘는 질의다 — "이 건의 안 지워진 첨부".
    // 부분 인덱스인 것은 이 저장소의 휴지통 패턴이고
    // (repair_case_flowcharts_repair_case_id_not_deleted_idx 와 같은 모양),
    // 지워진 행이 인덱스에 남지 않아 목록 질의가 그만큼 가벼워진다.
    index("attachments_repair_case_id_not_deleted_idx")
      .on(table.repairCaseId)
      .where(sql`is_deleted = false`),
    // 모델 상세의 사진·회로도 목록이 쏘는 질의 — "이 모델의 안 지워진 첨부".
    // 위 접수 건 인덱스와 똑같은 모양의 부분 인덱스다.
    index("attachments_product_model_id_not_deleted_idx")
      .on(table.productModelId)
      .where(sql`is_deleted = false`),
    // ── 주인은 둘일 수 없다 (하지만 없을 수는 있다) ─────────────────────
    // 파일 하나가 접수 건과 모델 양쪽에 동시에 걸리면 그 파일이 어느 폴더에
    // 사는지(stored_path 의 첫 마디가 repair-cases 인지 product-models 인지)가
    // 정해지지 않는다. 그 모순만 DB 가 직접 막는다.
    //
    // ⚠️ **XOR("정확히 하나")로 걸면 안 된다.** 위 두 컬럼이 모두
    // ON DELETE SET NULL 이라, 접수 건을 영구 삭제하면 repair_case_id 가 NULL 이
    // 되면서 **주인이 아무도 없는 행이 정상적으로 생긴다.** 그것은 이 표가
    // 일부러 허용하는 상태다(파일 헤더의 '접수 건이 영구 삭제돼도' 항목) —
    // XOR 로 걸면 그 삭제 자체가 DB 단에서 막혀 버린다. 지금 실측으로 그런 행은
    // 0건이지만 앞으로 생길 수 있는 정상 상태이므로, 막는 것은 "둘 다 찬 경우"
    // 하나뿐이다.
    check(
      "attachments_owner_not_both",
      sql`NOT (${table.repairCaseId} IS NOT NULL AND ${table.productModelId} IS NOT NULL)`
    ),
    // 중복 업로드 판단과 디스크 실물 대조용. 부분 인덱스가 아닌 것은 일부러다 —
    // 휴지통에 있는 파일까지 찾아야 "이미 올린 파일인데 지워져 있다"를 말할 수
    // 있고, 실물 대조는 삭제 여부와 무관하게 전 행을 훑는다.
    index("attachments_checksum_sha256_idx").on(table.checksumSha256),
  ]
);
