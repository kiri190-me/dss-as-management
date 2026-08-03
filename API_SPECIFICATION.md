# API Specification

DSS A/S 관리 시스템의 초기(Initial) REST API 엔드포인트 정의 문서이다. 실제 구현 코드는 포함하지 않으며, 엔드포인트 목록과 개요 수준의 요청/응답 정의만 다룬다. 상세 스키마가 확정되지 않은 항목은 TBD로 표기한다.

- Base Path: `/api`
- 인증 방식: SECURITY_POLICY.md의 Authentication 정책을 따름(세션 또는 JWT, 방식 확정은 TBD)
- 권한 표기: 5개 역할 코드(SUPER_ADMIN, ADMIN, AS_ENGINEER, SALES, INVENTORY_MANAGER) 기준

---

## 1. Auth (인증)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| POST | /api/auth/login | 로그인(회사 이메일 계정) | 전체(비로그인) |
| POST | /api/auth/logout | 로그아웃 | 로그인 사용자 전체 |
| GET | /api/auth/session | 현재 세션/사용자 정보 조회 | 로그인 사용자 전체 |

## 2. Users (사용자/승인)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/users | 사용자 목록 조회 | SUPER_ADMIN, ADMIN |
| POST | /api/users | 사용자 가입 신청(승인 대기 상태 생성) | 전체(비로그인) |
| PATCH | /api/users/{id}/approve | 사용자 승인/반려 | SUPER_ADMIN, ADMIN |
| PATCH | /api/users/{id}/role | 사용자 역할 변경(5개 역할 중 지정) | SUPER_ADMIN |
| PATCH | /api/users/{id}/lock | 계정 잠금/해제 | SUPER_ADMIN, ADMIN |
| PATCH | /api/users/{id}/deactivate | 계정 비활성화(퇴사 처리) | SUPER_ADMIN, ADMIN |

## 3. Customers / End-Users (고객사 및 End-User 관리)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/customers | 고객사 목록 조회 | 로그인 사용자 전체 |
| POST | /api/customers | 고객사 등록 | ADMIN, SALES |
| GET | /api/customers/{id} | 고객사 상세 조회 | 로그인 사용자 전체 |
| PATCH | /api/customers/{id} | 고객사 정보 수정 | ADMIN, SALES |
| GET | /api/end-users | End-User 목록 조회 | 로그인 사용자 전체 |
| POST | /api/end-users | End-User 등록 | ADMIN, SALES |

## 4. Repair Cases (제품 접수 및 A/S 접수 — 인수번호 포함)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/repair-cases | 전체 현황 조회/검색(필터: 상태, 고객사, 기간 등) | 로그인 사용자 전체 |
| POST | /api/repair-cases | A/S 접수 생성(제품 인수 등록, 인수번호 DB 트랜잭션 자동 발급, 워크플로 최신 활성 버전 배정) | ADMIN, AS_ENGINEER, SALES |
| GET | /api/repair-cases/{id} | A/S 상세 조회 | 로그인 사용자 전체 |
| PATCH | /api/repair-cases/{id} | A/S 접수 정보 수정 (잠금 상태(`is_locked`)일 경우 서버에서 거부) | ADMIN, AS_ENGINEER |
| PATCH | /api/repair-cases/{id}/status | 상태 변경(status_change_histories 기록) | ADMIN, AS_ENGINEER |
| GET | /api/repair-cases/{id}/history-comparison | 동일 제품 과거 수리 이력 비교 조회 | 로그인 사용자 전체 |

## 5. Work Histories (작업 이력)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/repair-cases/{id}/work-histories | 작업 이력 목록 조회 | 로그인 사용자 전체 |
| POST | /api/repair-cases/{id}/work-histories | 작업 이력 등록 | AS_ENGINEER, ADMIN |

## 6. Attachments (사진 및 파일 첨부)

| Method | Path | 설명 | 권한 | 비고 |
|---|---|---|---|---|
| GET | /api/repair-cases/{id}/attachments | 첨부파일 목록 조회 | 로그인 사용자 전체 | |
| POST | /api/repair-cases/{id}/attachments | 첨부파일 업로드 (최대 300MB, 분할/재개 업로드 지원, 원본+미리보기 생성) | AS_ENGINEER, ADMIN, SALES, INVENTORY_MANAGER | 청크 업로드 세부 요청/응답 스키마 TBD |
| DELETE | /api/attachments/{id} | 첨부파일 삭제(소프트 삭제, FILE_DELETE 감사 기록) | AS_ENGINEER, ADMIN | 삭제 사유(delete_reason) 입력 필수, 스키마 TBD |

## 7. Dashboard (대시보드)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/dashboard/summary | 대시보드 요약 통계 조회 | 로그인 사용자 전체 |

## 8. Audit Logs (감사 로그)

| Method | Path | 설명 | 권한 |
|---|---|---|---|
| GET | /api/audit-logs | 감사 로그 조회(actor 포함, 15종 action_type 필터 지원) | SUPER_ADMIN, ADMIN |

---

## 9. Workflow Version Management (워크플로 버전 관리 — Placeholder, 상세 스키마 TBD)

| Method | Path | 설명 | 권한(잠정) |
|---|---|---|---|
| GET | /api/workflow-templates | 워크플로 템플릿 목록 조회 (Matcher/유상 Generator/무상 Generator) | 로그인 사용자 전체 |
| GET | /api/workflow-templates/{id}/versions | 버전 이력 조회 | 로그인 사용자 전체 |
| POST | /api/workflow-templates/{id}/versions | 신규 DRAFT 버전 생성 (현재 활성 버전 복제) | SUPER_ADMIN, ADMIN |
| POST | /api/workflow-templates/{id}/versions/{versionId}/steps | DRAFT 버전에 단계 **추가** | SUPER_ADMIN, ADMIN |
| PATCH | /api/workflow-templates/{id}/versions/{versionId}/steps/{stepId} | DRAFT 버전의 단계 **수정** | SUPER_ADMIN, ADMIN |
| PATCH | /api/workflow-templates/{id}/versions/{versionId}/steps/order | DRAFT 버전의 단계 **순서 변경** | SUPER_ADMIN, ADMIN |
| PATCH | /api/workflow-templates/{id}/versions/{versionId}/publish | 버전 **발행** (구조 불변 확정, 신규 접수 건의 기본 버전으로 전환) | SUPER_ADMIN, ADMIN |
| PATCH | /api/workflow-templates/{id}/versions/{versionId}/steps/{stepId}/activation | 단계 **활성/비활성 토글** (발행된 버전에서도 예외적으로 허용) | SUPER_ADMIN, ADMIN |
| GET | /api/repair-cases/{id}/workflow | A/S 접수 건의 배정된 버전 및 현재 단계 조회 | 로그인 사용자 전체 |
| PATCH | /api/repair-cases/{id}/workflow/current-step | 비활성화된 단계에 머문 접수 건을 대체 단계로 수동 이동(사유 필수) | ADMIN, SUPER_ADMIN |
| PATCH | /api/repair-cases/{id}/exception-status | 예외 상태 설정/해제(보류, 고객 응답 대기 등 9종) | ADMIN, AS_ENGINEER |

단계 추가·수정·순서 변경·활성 토글은 서로 다른 엔드포인트로 분리하며, 하나의 PATCH로 통합하지 않는다. 발행(PUBLISHED)된 버전의 단계 구조(존재/순서/이름)는 변경할 수 없으며, 구조 변경은 반드시 신규 버전 생성을 통해서만 이루어진다. 이력이 존재하는 버전과 단계는 물리적으로 삭제하지 않는다.

## 10. Shipment Approval Delegation Management (출하 승인 위임 관리 — Placeholder, 상세 스키마 TBD)

| Method | Path | 설명 | 권한(잠정) |
|---|---|---|---|
| GET | /api/shipment-approval-delegations | 위임 목록 조회(ACTIVE/EXPIRED/REVOKED 필터) | SUPER_ADMIN, ADMIN |
| POST | /api/shipment-approval-delegations | 위임 생성 (원 승인자/위임받은 승인자/유효 시작·종료 일시/사유). 특정 A/S 건에 종속되지 않음 | SUPER_ADMIN, ADMIN(인가된 경우만) |
| PATCH | /api/shipment-approval-delegations/{id}/revoke | 위임 취소 (status → REVOKED) | SUPER_ADMIN, ADMIN(인가된 경우만) |
| PATCH | /api/users/{id}/shipment-delegation-authorization | 특정 ADMIN에게 위임 지정 권한(`can_assign_shipment_delegation`) 부여/회수 | SUPER_ADMIN |

서버는 위임 생성 요청 시 요청자가 SUPER_ADMIN인지, 또는 `can_assign_shipment_delegation = true`로 인가된 ADMIN인지 검증하며, 인가되지 않은 ADMIN이 자기 자신을 위임 승인자로 지정하는 요청은 거부한다. 위임받을 사용자는 활성 계정이며 `can_approve_shipment = true`여야 한다.

## 11. Inspection & Shipment Approval (검수/출하 승인 — Placeholder, 상세 스키마 TBD)

| Method | Path | 설명 | 권한(잠정) |
|---|---|---|---|
| POST | /api/repair-cases/{id}/inspection-approval | 수리 검수 승인 | AS_ENGINEER(요청) / ADMIN(승인) |
| POST | /api/repair-cases/{id}/shipment-approval | 출하 승인 생성. 요청 시점에 유효한(ACTIVE, 기간 내) 위임이 있으면 `approval_type = DELEGATED`로 자동 연결(`approval_delegation_id`), 없으면 `DIRECT`. `original_approver_id`/`approved_by`를 함께 보존 | ADMIN, SALES(요청) / 대표 또는 위임 승인자(승인) |
| POST | /api/repair-cases/{id}/shipment-approval/{approvalId}/evidence | 교산 출하 승인 이메일/문서 증빙 첨부 | ADMIN, SALES |

## 12. Excel Reports (Excel 자동 작성 — Placeholder, 상세 스키마 TBD)

| Method | Path | 설명 | 권한(잠정) |
|---|---|---|---|
| POST | /api/excel-reports/kyosan-intake-list | 일본 본사 인수품 LIST Excel 자동 작성 (출력물은 일본어, 용어사전 참조) | ADMIN, INVENTORY_MANAGER |

## 13. Unlock Requests (출하 완료 후 수정 — Placeholder, 상세 스키마 TBD)

아래 4개 엔드포인트를 잠금 해제·수정 절차의 단일 정규(canonical) 구조로 사용한다.

| Method | Path | 설명 | 권한(잠정) |
|---|---|---|---|
| POST | /api/repair-cases/{id}/unlock-requests | 수정 요청 생성 | AS_ENGINEER, ADMIN, SALES, INVENTORY_MANAGER |
| PATCH | /api/repair-cases/{id}/unlock-requests/{requestId}/approve | 관리자 승인 → 임시 잠금 해제 | ADMIN, SUPER_ADMIN |
| PATCH | /api/repair-cases/{id} | 잠금 해제 상태에서 수정 (요청 바디에 `modification_reason` 필수, 서버에서 `is_locked` 상태 검증) | ADMIN, AS_ENGINEER |
| PATCH | /api/repair-cases/{id}/unlock-requests/{requestId}/review | 재검토 및 재승인 → 재잠금 | ADMIN, SUPER_ADMIN |

> 이전 설계에 존재하던 단수형 `POST /api/repair-cases/{id}/unlock-request`는 폐기(obsolete)되었다. 위 `/unlock-requests`(복수형) 4개 엔드포인트로 대체되었으며, 더 이상 사용하지 않는다.

---

요청 바디, 응답 바디, 에러 코드 등 세부 스키마는 DATABASE_DESIGN.md의 테이블 구조를 기준으로 이후 별도 문서에서 정의한다.
