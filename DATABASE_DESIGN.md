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
| RepairCase | A/S 접수(제품 접수) — 인수번호 부여, 워크플로 버전/현재 단계/예외 상태/출하 완료 표시(`is_locked`, 데이터 수정을 제한하지 않음) 보유 |
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
| UnlockRequest | (정책 변경으로 폐기됨 — 출하 완료 후에도 잠금 해제 절차 없이 통상 권한으로 수정 가능. 15번 참고) |
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

## 15. Post-Shipment Modification Strategy (정책 변경 — `unlock_requests` 폐기)

- 출하 완료는 A/S 접수 건 데이터를 자동으로 읽기 전용으로 만들지 않는다. 출하 완료된 건도 통상의 역할별/필드별 권한 규칙(SECURITY_POLICY.md §2)에 따라 동일하게 수정 가능하며, 별도의 잠금 해제 요청/승인 절차나 `unlock_requests` 테이블은 존재하지 않는다.
- `repair_cases.is_locked`는 출하 완료(`shipment_completed`) 시 여전히 `true`로 설정되지만, 데이터 수정 가능 여부를 더 이상 좌우하지 않는다 — 워크플로가 종료 단계에 도달했음을 나타내는 표시로만 사용된다.
- 워크플로 단계 전이만 종료 상태로 보호된다: `shipment_completed`는 워크플로의 종료 단계이며 그 이후로 이동 가능한 다음 단계는 정의되어 있지 않다.

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

---

## 18. 옛 재고 기능 걷어내기 — 코드는 사라지고 표는 남는다 (조각 13, 2026-10, **끝났다**)

재고 관리는 2026-10 에 **별도 시스템**(dss-inventory)으로 떨어져 나갔다. A/S 는 이제 그쪽
API 를 부르는 **새 통로**(`server/actions/inventory-stock-requests` ·
`server/inventory-gateway` · `domain/inventory-gateway`)만 쓴다.

A/S 안의 옛 재고 코드는 조각 13 에서 단계를 나눠 걷어냈고 **2026-10-28 에 끝났다** —
화면·경로(13-A) → 옛 서버 액션(13-B) → 남의 시험이 그것을 밑자락으로 쓰던 자리 다섯
(13-C1~C3) → 알림 종류 셋(13-C4) → mutation·조회·도메인·검증(13-C5) → **권한 키 여섯과
인가 함수 스물(13-D).** 단계별 과정 기록은 조각이 끝나면서 함께 지웠다.
**아래 여섯만 지금도 사실이고, 그래서 남긴다.**

### 18-1. 🔴 재고 표를 지우지 않는 진짜 까닭

2026-10-16 사용자 결정으로 재고 표(`parts` · `part_stock_balances` ·
`stock_transactions` · `inventory_part_requests` · `inventory_part_request_items` ·
`inventory_part_issue_requests`)는 **그대로 둔다.**

🔴 **그때 적어 두었던 까닭 — 「운영의 과거 출고 기록이 거기에만 있다」 — 은 사실이
아니었다.** 2026-10-27 운영 실측에서 **재고 표 여섯이 전부 0행**이었다(개발 PC 에 있는
행은 전부 데모 자료다. 2026-09-04 결정 D 로 NAS 에 안 따라갔고 그 뒤 운영에서 한 번도
안 쓰였다).

🔴 **남기는 진짜 까닭은 따로다**: 스키마가 공용 서브모듈 `vendor/dss-core` 이고
**dss-po 가 같은 표 정의를 함께 쓴다**(E-2 절, `PO_DOMESTIC_SPLIT_DESIGN.md`). 표를
지우려면 그쪽과 한 몸으로 다뤄야 한다.

그래서 **표를 건드리는 살아 있는 코드가 지금도 둘 있다.** 수리 건 영구삭제·소각이
`stock_transactions` 와 `inventory_part_issue_requests` 의 `destination_note` 를
**개인정보 없이** 되메워 CHECK 제약을 지킨다 — `mutations/repair-cases-purge.ts` 와
`mutations/repair-cases.ts`. 재는 자리는 각각의 integration 시험이고, 밑자락은
2026-10-27(13-C3)에 raw insert 로 갈아 끼웠다(옛 경로가 사라지기 때문이다).

### 18-2. 🔴 `shipment_approval_route_scope` 의 `'PART_ISSUE'` 는 **영구 유지**

enum 값도, `domain/shipment-approval-route.ts` 의 `SHIPMENT_APPROVAL_ROUTE_SCOPES` 목록도
그대로 둔다. 까닭이 재고 코드가 아니기 때문이다 — **저장된 판과 과거 결재 기록이 그 값을
쓴다.** 목록에서 빼면 타입이 좁아져 그 판을 읽지도 이어 쓰지도 못하고, **계정 삭제**가
거기서 조용히 깨진다(`mutations/user-deletion.ts` → `saveShipmentApprovalRouteInTx` →
`validateShipmentApprovalRouteInput`. 입력이 `unknown` 이라 타입 검사로는 안 드러난다).

🔵 2026-10-18 부터 이 용도는 **[사용자 관리] → [승인 절차] 탭에서 고를 수 없다**
(`EDITABLE_SHIPMENT_APPROVAL_ROUTE_SCOPES`). 「고를 수 없다」와 「값이 없다」는 다르다.

🔵 13-C4 에서 계정 삭제의 `OPEN_APPROVAL_KINDS` 에서는 `PART_ISSUE` 를 **뺐다**(열린 불출
결재가 있어도 이어받을 사람을 요구하지 않는다). 🔴 **결재선 판(routeSlots)의 `PART_ISSUE`
는 그대로다** — 지울 사람이 현재 불출 판에 올라 있으면 지금도 이어받을 사람이 필요하다.
빠진 것은 「열린 결재 **행**」 한 가지뿐이다. 근거 셋의 전문은
`domain/user-deletion-rules.ts` 의 `OPEN_APPROVAL_KINDS` 주석에 있다.

### 18-3. 🔵 아직 재고 **표**를 직접 읽는 코드 하나

`queries/user-deletion-impact.ts` 가 `inventory_part_requests` ·
`inventory_part_issue_requests` 를 읽어 「본인이 올린 열린 요청 N건」을 **참고로** 센다
(영향 목록 12·13번). 🔴 **표를 직접 읽는 것이라 조각 13 의 코드 삭제로 깨지지 않는다.**
치우려면 화면 문구(`components/users/user-deletion-dialog-text.ts` 의 「(참고) 직접 올린
열린 부품 요청 …」)까지 한 몸으로 다뤄야 해서, 따로 정할 일로 남겨 두었다.

### 18-4. 🔴 권한 키는 `inventory.requests` **하나만** 남았다 (13-D, 2026-10-28)

권한 트리(`auth/permission-features.ts`)와 상한 계산(`auth/permission-baseline.ts`)에서
잎 여섯 — `inventory.view` · `inventory.parts` · `inventory.stock` · `inventory.history` ·
`inventory.requestProcessing` · `inventory.lifecycle` — 을 뺐다. 가리킬 조작이 하나도 없어서
다(화면은 13-A 에, mutation 은 13-C5 에 사라졌다).

기본값을 내던 `auth/inventory-authorization.ts` 의 `can*()` 열여섯 중 **열셋을 지우고 셋만
남겼다**(`canCreatePartRequest` · `canProcessPartRequests` · `canViewPartRequests`). 그것들만
쓰던 맥락 헬퍼 일곱(`isRequestCancellable` 류 · `statusAfterHoldRelease`)과
`domain/inventory-types.ts` 도 통째로 지웠다 — 지운 `export` 가 모두 스물하나다.

🔵 **`inventory.requests` 는 남는다 — 지금도 운영 중인 관문이다.** 수리 건 상세의
[부품 반출 신청] 칸이 `hasPermission(… "inventory.requests", "WRITE")` 를 페이지 가드 한
곳과 서버 액션 세 곳에서 본다. 🔴 **그 키 글자를 바꾸거나 다른 메뉴로 옮기지 마라** —
운영에 저장된 `role_permissions` 행이 갈 곳을 잃고 **오류 없이 조용히** 기본값으로
되돌아간다.

🔴 **메뉴 수준 기본값도 그 잎 하나를 따라가게 맞췄다.** 그러면서 **SALES 의 재고 메뉴
기본값이 READ 에서 NONE 으로 떨어졌다** — 이 조각에서 기본 정책이 실제로 달라지는 칸은
이것 하나뿐이다. 막은 것이 아니라 볼 것이 없어진 것이다: 영업은 2026-08 부터 부품 요청에
접근하지 않았고(확인된 결정), 옛 재고 조회 화면은 `/inventory` 와 함께 404 가 됐다.

🔵 **마이그레이션은 만들지 않았다.** 아래 18-6 의 까닭으로 필요가 없다.

### 18-5. 🔵 이름이 닮아 섞이기 쉬운 것

- `queries/oh-part-templates`(옛 관리 화면, 13-B·13-C5 에서 지웠다)와
  `fetchInventoryOhTemplate`(새, 재고 관리 API)은 **완전히 다른 통로**다.
- `components/repair-cases/detail/PartRequestSection.tsx` 는 이름이 재고처럼 생겼지만
  **지금 운영 중인 새 코드**다(수리 건 상세가 쓴다).
- `components/inventory/part-picker.test.tsx` 는 폴더 이름만 `inventory` 다 — 재는 대상은
  서브모듈의 고르개(`@dss/core/ui/inventory/part-picker`)이고 **지금 돌고 있는 코드**다.

### 18-6. 🔴 운영 DB 에 고아 행이 남는다 — 그래도 안전한 까닭

조각 13 은 **운영 데이터를 한 줄도 지우지 않았다.** 그래서 코드에서 사라진 이름을 가리키는
행이 운영 DB 에 그대로 남아 있다. 둘 다 **치워도 되지만 치우지 않아도 된다.**

**① 알림 종류 셋**(13-C4). 치우는 SQL 은 **적어만 두었고 실행하지 않았다** —
`NOTIFICATION_AND_IDENTITY_DESIGN.md` 의 K 절. 표 셋이고 하나는 포털 DB 다.

**② 권한 키 여섯**(13-D). `role_permissions` 에 `inventory.view` 같은 행이 저장돼 있을 수
있다(개발 DB 에는 `inventory.stock` = AS_ENGINEER/WRITE 가 실제로 있다). 🔴 **그 행들은
읽기·화면·판정·쓰기 네 구간에서 모두 무시된다** — 「혹시 어딘가에서 통할까」를 한 자리씩
확인한 결과다:

| 구간 | 거르는 자리 | 어떻게 |
|---|---|---|
| 읽기 | `db/queries/role-permissions.ts` | `isPermissionLeafKey` 가 아닌 행을 버린다 |
| 판정 | `auth/permission-resolver.ts` | `PERMISSION_LEAF_KEYS` 만 돌며 실효 수준을 만든다 |
| 화면 | `auth/role-permission-views.ts` | 같은 목록만 돌며 표를 만든다 |
| 쓰기 | `db/mutations/role-permissions.ts` | 트리에 없는 키는 저장 자체를 거른다 |

그 사실을 지키는 시험이 이미 있다 — `role-permissions.integration.test.ts` 의 「트리에 없는
키는 저장되지 않는다」(`"inventory.nonexistent"` 표본)와 `permission-features.test.ts` 의
「트리에 없는 키는 열리지 않는다」. 🔴 **그러므로 고아 행이 권한을 넓히는 일은 없다.**
지우는 마이그레이션을 만들지 않은 까닭이 이것이다(운영 행을 지우는 것은 승인 사항이고,
얻는 것이 없다).

🔵 재고 **표** 쪽에는 고아 행이 없다 — 2026-10-27 운영 실측에서 여섯 표가 전부 0행이었다
(18-1).

---

## 19. 🔴 `status_change_histories` 의 append-only 에는 **도구 층 예외 둘**이 있다 (2026-10-28)

스키마가 그 표를 이렇게 못 박고 있다(`vendor/dss-core/src/schema/status-change-histories.ts`):

> *Immutable/append-only: no soft-delete columns, **no update path anywhere in the mutation layer**.*

🔵 **그 문장은 지금도 참이다** — `src/lib/db/mutations/` 어디에도 `update(statusChangeHistories)`
가 없다. 🔴 **다만 「mutation 층」이라는 한정이 중요하다.** `scripts/` 의 도구 둘은
그 표를 고친다:

| 도구 | 하는 일 |
|---|---|
| `scripts/revert-kyosan-import.ts` | 흔적 **행을 지운다**(이식을 통째로 되돌린다) |
| `scripts/backfill-kyosan-used-parts.ts` | 흔적의 **`metadata.usedPartIds`·`usedPartCount` 만 고친다** |

🔴 **왜 백필이 그 칸을 고쳐야 하나.** 그 칸의 뜻은 「**이 이식이 만든 사용 부품 줄이
무엇인가**」다. 백필이 줄을 갈아 끼우면 옛 id 는 **없는 줄을 가리키게 되고**, 되돌리기가
그 흔적을 「그 사이에 줄이 사라졌다」로 보아 **통째로 건너뛴다** — 그 순간 그 이식은
영영 못 되돌리는 것이 된다. 칸을 따라 고치는 쪽이 **사실에 맞고 되돌릴 수 있는 쪽**이다.

🔵 **「무슨 일이 있었나」를 적는 칸은 한 글자도 안 건드린다** — `action_type` · `created_at` ·
`actor_user_id` · `reason` · `importBatchId` · `workRecordIds` · `attachmentIds` ·
`photoCount` · `reportedSymptomFilled` 전부 그대로다. 그리고 **고치기 전 값을
`metadata.usedPartsBackfills` 에 이력으로 쌓는다** — 무엇이 언제 어느 회차로 바뀌었는지
그 칸만 읽으면 된다.

🔴 **새 도구가 이 표를 고치려 들면 먼저 여기를 읽어라.** 늘려도 되는 예외가 아니다 —
위 둘은 **사람이 승인해 한 번 돌리는 도구**이고, 앱이 도는 중에는 아무도 이 표를 안 고친다.
