# Database Design

내부 DSS A/S 관리 시스템의 데이터베이스 설계 문서이다. PostgreSQL 기준으로 작성하며, 이 문서는 설계 문서로서 실제 마이그레이션 파일이나 소스 코드는 포함하지 않는다.

---

## 1. Entity List (엔티티 목록)

| 엔티티 | 설명 |
|---|---|
| User | 시스템 사용자 (5개 역할 중 하나를 가짐, 사용자별 예외 권한 플래그 보유 가능) |
| Customer | 고객사 |
| EndUser | End-User (고객사 산하 실사용자/설치처) |
| Product | 제품(장비) 마스터 |
| RepairCase | A/S 접수(제품 접수) — 인수번호 부여, 워크플로 버전/현재 단계/예외 상태/잠금 상태 보유 |
| WorkflowTemplate | 워크플로 템플릿 (Matcher / 유상 Generator / 무상 Generator) — 안정적인 워크플로 유형 식별자 |
| WorkflowVersion | 워크플로 버전 — 템플릿의 특정 시점 단계 구성 스냅샷 (발행 후 불변) |
| WorkflowStep | 워크플로 단계 — 특정 버전에 속한 순서 있는 단계 |
| ExceptionStatus | 예외 상태 마스터 (보류, 고객 응답 대기 등 9종, 관리자 설정 가능) |
| WorkHistory | 날짜별 작업 이력 |
| StatusChangeHistory | 상태/단계 변경 이력 |
| Attachment | 사진 및 파일 첨부 |
| InspectionApproval | 수리 검수 승인 |
| ShipmentApproval | 출하 승인 (직접 승인 또는 위임 승인) |
| ShipmentApprovalDelegation | 기간제 출하 승인 위임 (특정 A/S 건에 종속되지 않음) |
| QuotePo | 견적/PO |
| UnlockRequest | 출하 완료 후 수정(잠금 해제) 요청 |
| TerminologyDictionary | 한국어/영어/일본어 기술 용어 사전 |
| AuditLog | 감사 로그 |
| ExcelImportRecord | 기존 Excel 데이터 이전 매핑 |

---

## 2. Table List (테이블 목록)

- users
- customers
- end_users
- products
- repair_cases
- workflow_templates
- workflow_versions
- workflow_steps
- exception_statuses
- work_histories
- status_change_histories
- attachments
- inspection_approvals
- shipment_approvals
- shipment_approval_delegations
- quotes_pos
- unlock_requests
- terminology_dictionary
- audit_logs
- excel_import_records

---

## 3. Relationships (관계)

- customers 1:N end_users
- customers 1:N repair_cases
- end_users 1:N repair_cases (nullable, 접수 시점에 End-User 미지정 가능)
- products 1:N repair_cases (동일 제품의 반복 입고 이력 추적)
- workflow_templates 1:N workflow_versions
- workflow_versions 1:N workflow_steps
- workflow_versions 1:N repair_cases (case가 접수 시점에 배정된 버전, `workflow_version_id`)
- workflow_steps 1:N repair_cases (case의 현재 단계, `current_step_id`)
- exception_statuses 1:N repair_cases (nullable, case의 현재 예외 상태)
- repair_cases 1:N work_histories
- repair_cases 1:N status_change_histories
- repair_cases 1:N attachments
- repair_cases 1:N inspection_approvals (검수 재요청 가능성 고려)
- repair_cases 1:N shipment_approvals
- shipment_approval_delegations 1:N shipment_approvals (위임 기간 동안 여러 A/S 건의 승인에 적용될 수 있음, `approval_delegation_id`)
- shipment_approvals 1:N attachments (교산 승인 이메일/문서 증빙)
- repair_cases 1:N quotes_pos
- repair_cases 1:N unlock_requests
- repair_cases 1:N excel_import_records (병합 이관 가능성 고려)
- users 1:N — 각 액션 테이블의 담당자/행위자 FK (work_histories.engineer_id, inspection_approvals.approver_id, shipment_approvals.approved_by, audit_logs.actor_user_id 등)
- audit_logs는 모든 테이블을 대상(target_entity + target_record_id)으로 참조하는 polymorphic 관계 (DB 레벨 FK 없음, 애플리케이션 레벨로 무결성 관리)

---

## 4. Primary Keys

- 모든 테이블의 내부 PK는 **UUID**를 사용하는 것을 권장 전략으로 한다.
  - 예: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `repair_cases` 테이블은 내부 PK(`id`, UUID)와 별개로, 비즈니스 식별자인 `intake_number`(인수번호, 예: D260801)를 **별도의 UNIQUE 컬럼**으로 가진다.

### 내부 ID와 비즈니스 식별자를 분리하는 이유

- **안정성**: 인수번호는 채번 규칙 변경이나 오기입 정정 가능성이 있으나, 내부 PK(UUID)는 모든 FK 관계의 기준이므로 변경되어서는 안 된다.
- **보안/추측 방지**: 순번 기반 정수 PK는 전체 접수 건수·순서가 URL/API로 노출될 위험이 있다. UUID는 추측이 불가능하다.
- **데이터 이전 시 충돌 방지**: 기존 Excel 약 600건 이관 시 여러 소스가 병합될 수 있는데, UUID는 충돌 없이 생성 가능하다.
- **역할 분리**: 인수번호는 고객사·일본 본사와의 커뮤니케이션에 쓰이는 사람이 읽는 식별자이고, UUID는 시스템 내부 참조 전용이다.

예:
```
id: UUID              (예: 3f2a1c4e-6b7d-4a2e-9c1a-0f1e2d3c4b5a)
intake_number: D260801  (UNIQUE, NOT NULL, 비즈니스 키)
```

---

## 5. Foreign Keys

- `repair_cases.customer_id` → `customers.id`
- `repair_cases.end_user_id` → `end_users.id` (nullable)
- `repair_cases.product_id` → `products.id`
- `repair_cases.workflow_version_id` → `workflow_versions.id`
- `repair_cases.current_step_id` → `workflow_steps.id`
- `repair_cases.exception_status_id` → `exception_statuses.id` (nullable)
- `repair_cases.deleted_by` → `users.id` (nullable)
- `end_users.customer_id` → `customers.id`
- `workflow_versions.workflow_template_id` → `workflow_templates.id`
- `workflow_versions.created_by` → `users.id`
- `workflow_steps.workflow_version_id` → `workflow_versions.id`
- `work_histories.repair_case_id` → `repair_cases.id`
- `work_histories.engineer_id` → `users.id`
- `status_change_histories.repair_case_id` → `repair_cases.id`
- `status_change_histories.changed_by` → `users.id`
- `status_change_histories.from_step_id` / `to_step_id` → `workflow_steps.id` (nullable, 단계 전이 기록 시)
- `attachments.repair_case_id` → `repair_cases.id` (nullable)
- `attachments.work_history_id` → `work_histories.id` (nullable)
- `attachments.shipment_approval_id` → `shipment_approvals.id` (nullable, 교산 승인 증빙)
- `attachments.uploaded_by` → `users.id`
- `inspection_approvals.repair_case_id` → `repair_cases.id`
- `inspection_approvals.approver_id` → `users.id`
- `shipment_approvals.repair_case_id` → `repair_cases.id`
- `shipment_approvals.approval_delegation_id` → `shipment_approval_delegations.id` (nullable)
- `shipment_approvals.original_approver_id` → `users.id`
- `shipment_approvals.approved_by` → `users.id`
- `shipment_approval_delegations.original_approver_id` → `users.id`
- `shipment_approval_delegations.delegation_assigner_id` → `users.id`
- `shipment_approval_delegations.delegated_approver_id` → `users.id`
- `quotes_pos.repair_case_id` → `repair_cases.id`
- `unlock_requests.repair_case_id` → `repair_cases.id`
- `unlock_requests.requested_by` → `users.id`
- `unlock_requests.approved_by` → `users.id` (nullable)
- `unlock_requests.reviewed_by` → `users.id` (nullable)
- `excel_import_records.repair_case_id` → `repair_cases.id` (nullable, 매칭 전 NULL 가능)
- `audit_logs.actor_user_id` → `users.id` (target_entity/target_record_id는 polymorphic이므로 DB FK 미적용)

FK는 기본적으로 `ON DELETE RESTRICT`로 하고, Soft Delete 정책과 결합해 실제 DELETE는 발생하지 않는 것을 원칙으로 한다.

---

## 6. Naming Convention (네이밍 규칙)

- 테이블명: 복수형 snake_case (예: `repair_cases`)
- 컬럼명: 단수형 snake_case (예: `intake_number`, `created_at`)
- FK 컬럼: `<참조 테이블 단수형>_id` (예: `customer_id`)
- 시각 컬럼: `created_at`, `updated_at`
- 소프트 삭제 컬럼(4종 고정): `is_deleted`, `deleted_at`, `deleted_by`, `delete_reason`
- 불리언 컬럼: `is_` 접두사 (예: `is_pilot_batch`, `is_locked`, `is_current`, `is_active`)
- 상태/유형 컬럼: `status` 또는 `_type`, 값은 대문자 스네이크 케이스 문자열
  - `workflow_versions.status`: `DRAFT` / `PUBLISHED` / `ARCHIVED`
  - `shipment_approval_delegations.status`: `ACTIVE` / `EXPIRED` / `REVOKED`
  - `shipment_approvals.approval_type`: `DIRECT` / `DELEGATED`
- 사용자 역할 값 (고정 5종, 대문자 코드):
  - `SUPER_ADMIN` (최고관리자)
  - `ADMIN` (관리자)
  - `AS_ENGINEER` (A/S 엔지니어)
  - `SALES` (영업 담당자)
  - `INVENTORY_MANAGER` (재고 담당자)

---

## 7. Index Strategy (인덱스 전략)

- `repair_cases.intake_number` — UNIQUE INDEX
- `repair_cases.status` — INDEX (전체 현황 필터링)
- `repair_cases.customer_id`, `.end_user_id`, `.product_id` — INDEX
- `repair_cases.workflow_version_id`, `.current_step_id`, `.exception_status_id` — INDEX
- `repair_cases.created_at` — INDEX (기간별 조회, 대시보드 집계)
- `work_histories.repair_case_id` + `work_date` — 복합 INDEX (날짜별 작업 이력 조회)
- `status_change_histories.repair_case_id` + `changed_at` — 복합 INDEX
- `workflow_versions.workflow_template_id` + `version_number` — UNIQUE 복합 INDEX
- `workflow_versions.workflow_template_id` — Partial INDEX (`WHERE status = 'PUBLISHED' AND is_current = true`, 템플릿당 활성 버전 단일성 보장)
- `workflow_steps.workflow_version_id` + `step_order` — 복합 INDEX
- `shipment_approval_delegations.status`, `.effective_start_at`, `.effective_end_at` — 복합 INDEX (특정 시점의 활성 위임 조회)
- `shipment_approvals.approval_delegation_id` — INDEX
- `unlock_requests.repair_case_id`, `.status` — INDEX
- `terminology_dictionary.korean_term` — UNIQUE INDEX
- `audit_logs.target_entity` + `target_record_id` — 복합 INDEX
- `audit_logs.actor_user_id` — INDEX
- `audit_logs.action_timestamp` — INDEX
- `users.email` — UNIQUE INDEX
- 모든 소프트 삭제 대상 테이블의 `is_deleted` — Partial INDEX (`WHERE is_deleted = false`)

---

## 8. Soft Delete Policy

- 모든 업무 테이블(감사 로그 제외)은 실제 DELETE 대신 아래 4개 컬럼을 사용한다.
  - `is_deleted BOOLEAN NOT NULL DEFAULT false`
  - `deleted_at TIMESTAMPTZ NULL`
  - `deleted_by UUID NULL` (→ `users.id`)
  - `delete_reason TEXT NULL`
- 기본 조회는 `WHERE is_deleted = false` 조건을 강제한다.
- UI에는 삭제된 레코드를 "삭제됨"으로 표시할 수 있으나, 이는 워크플로 단계나 예외 상태(`exception_statuses`)와는 별개의 체계이다. `repair_cases.exception_status_id`에 "삭제"에 해당하는 값을 두지 않는다.
- `workflow_versions`와 `workflow_steps`는 예외적으로 소프트 삭제 컬럼을 사용하지 않는다. 대신 `workflow_versions.status`(DRAFT/PUBLISHED/ARCHIVED)와 `workflow_steps.is_active`만으로 상태를 관리하며, 이력이 참조하는 버전·단계는 물리 삭제·소프트 삭제 모두 금지한다.
- CLAUDE.md의 "기존 데이터 삭제 또는 초기화 명령을 실행하지 않는다" 규칙과 직접 연결된다.
- 물리적 삭제(hard delete)는 원칙적으로 금지하며, 예외 상황의 승인 절차는 TBD.

---

## 9. Audit Log Policy

`audit_logs` 테이블은 append-only(수정/삭제 불가)로 운영하며 최소 아래 필드를 포함한다.

| 필드 | 설명 |
|---|---|
| id | UUID, PK |
| actor_user_id | 행위자(사용자) — 화면에는 숨길 수 있으나 반드시 저장 |
| action_timestamp | 행위 발생 시각 |
| target_entity | 대상 엔티티(테이블)명 |
| target_record_id | 대상 레코드 ID (UUID) |
| action_type | 행위 유형 (아래 15종 고정값) |
| previous_value | 변경 전 값 (JSON, nullable) |
| new_value | 변경 후 값 (JSON, nullable) |
| session_id | 세션 식별자 (nullable) |
| source_ip | 요청 출발지 IP (nullable) |

### action_type 고정값 (15종)

1. LOGIN
2. CREATE
3. UPDATE
4. SOFT_DELETE
5. RESTORE
6. STATUS_CHANGE
7. FILE_UPLOAD
8. FILE_DOWNLOAD
9. FILE_DELETE
10. EXCEL_IMPORT
11. EXCEL_EXPORT
12. APPROVE
13. APPROVAL_CANCEL
14. ACCOUNT_LOCK
15. ACCOUNT_DEACTIVATE

- `actor_user_id`는 일반 업무 화면(UI)에서는 노출하지 않을 수 있으나, DB에는 예외 없이 저장한다.
- 감사 로그 조회 화면은 SUPER_ADMIN/ADMIN만 접근 가능하다.
- 사용자별 예외 권한 플래그(`can_assign_shipment_delegation` 등)의 변경은 action_type = UPDATE, target_entity = users로 기록한다(17번 항목 참조).

### 보관 및 삭제 정책 (권장 정책)

- 감사 로그는 일반 사용자와 관리자 모두에게 append-only이다(수정/삭제 UI를 제공하지 않는다).
- 보관 기간은 3년으로 한다.
- 보관 기간 경과 후에는 자동 삭제(retention-based deletion)가 발생할 수 있다.
- 예외적인 조기 삭제가 필요한 경우, 문서화된 보안 절차를 거쳐야 하며 별도의 불변 보안 이벤트 레코드를 남긴다.
- 일반 화면(UI)을 통한 개별 감사 로그 레코드의 임의 수동 삭제는 허용하지 않는다.

---

## 10. Attachment Strategy

- `attachments`는 파일 메타데이터와 저장 경로만 관리하고, 실제 바이너리는 외부 스토리지(NAS, SECURITY_POLICY.md 12번 항목 참조)에 저장한다.
- 필드(개요): `id`, `repair_case_id`(nullable), `work_history_id`(nullable), `shipment_approval_id`(nullable, 교산 승인 증빙용), `uploaded_by`, `file_name`, `original_file_path`, `preview_file_path`(압축 미리보기), `mime_type`, `file_size`, `malware_scan_status`, `uploaded_at`, `is_deleted`, `deleted_at`, `deleted_by`, `delete_reason`.
- 개별 파일 최대 크기는 300MB이며, 대용량 파일은 분할 업로드(Chunked Upload) 및 재개 가능한 업로드(Resumable Upload)를 지원한다. 업로드 완료(청크 병합) 후에만 `attachments` 레코드가 확정 저장된다(청크 관리 세부 구현 TBD).
- 원본 이미지는 원본 그대로 보관하고, 별도의 압축 미리보기 이미지를 함께 생성·보관한다.
- 파일 삭제 이력은 `attachments`의 소프트 삭제 컬럼과 `audit_logs`(action_type = FILE_DELETE)에 이중으로 기록한다.
- 파일은 반영구 보관을 원칙으로 한다.
- 업로더 계정이 비활성화되거나 퇴사 처리되어도 해당 계정이 업로드한 파일은 계속 열람·사용 가능하다(파일 접근성과 업로더 계정 상태는 분리).
- 파일 접근은 반드시 애플리케이션을 통해서만 이루어지며, 일반적으로 접근 가능한 NAS 공유 폴더 형태로 노출하지 않는다.
- 지원 파일 유형: JPG, PNG, PDF, XLS, XLSX, DOC, DOCX, ZIP, CSV, TXT, 오실로스코프 데이터 파일, 장비 로그 파일, 펌웨어, 회로도
- `malware_scan_status`는 SECURITY_POLICY.md의 악성코드 검사 정책과 연동되며, 스캔 완료 전에는 다운로드를 제한한다.

---

## 11. Product History Strategy (제품/수리 이력 전략)

- `work_histories`는 `repair_case_id` 기준으로 append-only 누적 기록한다 (날짜별 작업 이력).
- `status_change_histories`는 상태 전이 시점마다 `from_status`, `to_status`, `changed_by`, `changed_at`을 기록한다.
- "과거 수리 이력 비교" 기능은 동일 `product_id`(또는 제품 시리얼 번호)를 기준으로 여러 `repair_cases` 레코드를 조회해 시계열로 비교하는 방식으로 구현한다.
- 이력 비교의 단위는 개별 `repair_case`가 아니라 `product` 기준의 접수 이력 묶음이다.

---

## 12. Excel Import & Export Strategy

### Import (기존 데이터 이전)

- `excel_import_records` 테이블에 레거시 Excel 파일 단위로 이관 정보를 기록한다.
- 필드(개요): `id`, `repair_case_id`(nullable, 매칭 전 NULL 가능), `original_file_name`, `original_file_path`(읽기 전용 원본 보관 경로), `extracted_data`(정형 추출 데이터, JSON), `unextractable_text`(추출 불가 원문 보존), `is_pilot_batch`(대표 20~30건 시험 이전 여부), `imported_by`, `imported_at`.
- 원본 파일은 절대 수정하지 않고 읽기 전용으로 별도 아카이브 경로에 보관한다.
- 1단계로 `is_pilot_batch = true`인 대표 20~30건을 먼저 이관/검증하고, 검증 완료 후 나머지 전체를 이관한다.
- 정형 데이터는 `repair_cases` 등 정규 테이블에 매핑 저장하고, 구조적으로 추출이 어려운 내용은 `unextractable_text`와 원본 파일 참조로만 보존한다.
- Import 행위는 `audit_logs`에 action_type = EXCEL_IMPORT로 기록한다.

### Export (일본 본사 제출용)

- 일본 본사 인수품 LIST Excel 출력물은 일본어로 작성한다.
- 표준화된 기술 일본어 용어는 `terminology_dictionary`를 참조하여 일관되게 사용한다.
- Excel 생성/발송 행위는 `audit_logs`에 action_type = EXCEL_EXPORT로 기록한다.

---

## 13. Workflow Version & Exception Status Strategy

### 워크플로 버전 모델

- `workflow_templates`는 워크플로 유형(코드: MATCHER/PAID_GENERATOR/WARRANTY_GENERATOR, 이름)의 안정적인 식별자만 가진다.
- `workflow_versions`는 템플릿의 특정 시점 단계 구성 스냅샷이다. 필드(개요): `id`, `workflow_template_id`, `version_number`, `status`(DRAFT/PUBLISHED/ARCHIVED), `is_current`(템플릿당 하나만 true — 신규 접수 건에 사용되는 버전), `published_at`, `created_by`, `created_at`.
- `workflow_steps`는 특정 `workflow_version_id`에 속한다. 필드(개요): `id`, `workflow_version_id`, `step_order`, `name`, `is_active`, `created_at`, `updated_at`.
- `repair_cases.workflow_version_id`는 접수 시점에 그 템플릿의 `is_current = true`인 버전으로 고정되며, 이후 새 버전이 발행되어도 자동으로 변경되지 않는다.

### 불변성과 예외

- 버전이 `PUBLISHED` 상태가 되면 해당 버전에 속한 단계의 **존재 여부·순서·이름**은 변경할 수 없다(구조 불변). 단계를 추가·순서 변경·이름 변경하려면 새로운 `workflow_versions` 레코드를 생성(복제 후 수정)하고 발행해야 한다.
- 예외적으로, 단계의 `is_active`(활성/비활성) 플래그는 이미 발행된 버전에서도 전환할 수 있다. 이는 구조 변경이 아니라 "신규 전이 허용 여부"만 제어하는 런타임 상태이기 때문이다.
- 비활성화된 단계는 신규 전이(다른 단계에서 그 단계로 진입) 대상이 될 수 없다.
- 이미 비활성화된 단계에 위치한 접수 건은 인가된 사용자(ADMIN 이상)가 대체 단계로 이동시키기 전까지 그대로 유지될 수 있다.
- 대체 단계로 이동 시 사유가 필수이며, `status_change_histories`(이전 단계, 새 단계, 처리자, 처리 시각, 사유)와 `audit_logs`(action_type = STATUS_CHANGE)에 함께 기록한다.
- 이력이 존재하는 워크플로 버전과 단계는 물리적으로 삭제하지 않는다(8번 Soft Delete Policy 참조).

### 예외 상태

- `exception_statuses`: 보류/고객 응답 대기/교산 응답 대기/부품 대기/수리 불가/수리 실패/고객 수리 취소/무상 반송/폐기 9종을 기본값으로 하며, 관리자가 추가/비활성화할 수 있다. "삭제"는 포함하지 않는다.
- `repair_cases.exception_status_id`는 워크플로 단계 진행과 독립적으로 부여되는 nullable 필드이다 (예: 특정 단계에 머무른 채로 "부품 대기" 예외 상태를 동시에 가질 수 있음).

---

## 14. Shipment Approval Delegation Strategy

- 위임은 특정 A/S 건에 종속되지 않는 **기간 기반 권한**이다. `shipment_approval_delegations` 필드(개요): `id`, `original_approver_id`, `delegation_assigner_id`, `delegated_approver_id`, `effective_start_at`, `effective_end_at`, `delegation_reason`, `status`(ACTIVE/EXPIRED/REVOKED). `repair_case_id`는 갖지 않는다.
- 위임 지정 권한: SUPER_ADMIN은 기본적으로 위임을 지정할 수 있다. ADMIN은 `users.can_assign_shipment_delegation = true`로 명시적으로 인가된 경우에만 지정할 수 있으며, 인가되지 않은 ADMIN은 자기 자신을 포함해 누구도 위임 승인자로 지정할 수 없다.
- 위임받을 사용자는 활성 계정(`is_deleted = false`, 비활성화되지 않음)이면서 `users.can_approve_shipment = true`(출하 승인 자격)여야 한다.
- `effective_end_at`이 지나면 위임은 자동으로 `EXPIRED` 상태가 된다(자동 만료 처리 방식은 스케줄 작업 또는 조회 시점 계산 등 TBD).
- `shipment_approvals` 필드(개요): `id`, `repair_case_id`, `approval_delegation_id`(nullable), `original_approver_id`, `approved_by`, `approval_type`(DIRECT/DELEGATED), `approved_at`.
- 승인 생성 시점에 유효한(`status = ACTIVE`이고 현재 시각이 유효 기간 내인) 위임이 있으면 `approval_type = DELEGATED`로 설정하고 해당 위임의 `id`를 `approval_delegation_id`에 연결하여, 어떤 위임이 해당 승인의 근거였는지 항상 식별 가능하도록 한다.
- 원 승인자(`original_approver_id`)와 실제 승인 처리자(`approved_by`)는 위임 여부와 무관하게 항상 함께 보존한다.
- 교산 출하 승인은 `attachments.shipment_approval_id`를 통해 이메일 또는 문서 형태의 증빙을 첨부할 수 있다.
- 승인/승인취소 행위는 `audit_logs`에 action_type = APPROVE / APPROVAL_CANCEL로 기록한다.

---

## 15. Unlock / Post-Shipment Modification Strategy

- `unlock_requests` 필드(개요): `id`, `repair_case_id`, `requested_by`, `request_reason`, `requested_at`, `status`(PENDING/APPROVED/REJECTED), `approved_by`, `approved_at`, `modification_reason`(수정 시 필수), `reviewed_by`, `reviewed_at`, `locked_again_at`.
- `repair_cases.is_locked`는 출하 완료 시 `true`로 설정되며, 승인된 `unlock_requests` 기간 동안만 `false`로 전환된다.
- 일반 사용자는 `is_locked = true`인 레코드를 직접 수정할 수 없다(애플리케이션 레벨 강제).
- 전체 흐름: 수정 요청 → 관리자 승인(임시 잠금 해제) → 사유 필수 입력 수정 → 재검토 및 재승인 → 재잠금.

---

## 16. Terminology Dictionary Strategy

- `terminology_dictionary` 필드(개요): `id`, `korean_term`, `english_term`, `japanese_term`, `category`, `is_active`, `created_at`, `updated_at`.
- 일본 본사 제출용 Excel(EXCEL_EXPORT) 생성 시 표준 용어를 이 테이블에서 조회하여 사용한다.
- 관리자가 용어를 추가/수정할 수 있다.

---

## 17. Permission Model Principles

- SUPER_ADMIN의 접근 권한도 하드코딩된 예외로 처리하지 않고, 인가 정책(권한 평가 로직)을 통해 판별한다.
- `users.can_assign_shipment_delegation`, `users.can_approve_shipment`와 같은 사용자별 예외 권한의 부여·회수는 `audit_logs`에 action_type = UPDATE(target_entity = users)로 기록한다.
- 역할 기반 권한(SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES/INVENTORY_MANAGER 5종 고정)과 사용자별 예외 권한(개별 사용자에게만 추가로 부여되는 권한)을 명확히 구분한다.
- 1차 배포에서는 사용자 테이블의 권한 플래그 방식을 사용하되, 향후 아래와 같은 일반화된 권한 모델로 확장 가능하도록 설계한다(1차 배포에는 미포함, 설계상 확장 여지만 확보).
  - `permissions`: 개별 권한 정의
  - `role_permissions`: 역할별 기본 권한 매핑
  - `user_permissions`: 사용자별 예외 권한(추가/회수) 매핑
