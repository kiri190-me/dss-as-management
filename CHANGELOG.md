# Changelog

이 문서는 [Keep a Changelog](https://keepachangelog.com/) 형식을 따른다.

## [0.3.0] - 2026-08-03

### Added

- 출하 승인 위임을 특정 A/S 건에 종속되지 않는 기간제(time-bound) 권한으로 재설계: `shipment_approval_delegations`(원 승인자/위임 지정자/위임받은 승인자/유효 시작·종료 일시/사유/상태)와 `shipment_approvals`(approval_delegation_id/original_approver_id/approved_by/approval_type)로 분리
- 위임 지정 권한 규칙 확정: SUPER_ADMIN 기본 지정권, ADMIN은 명시적 인가 시에만 지정 가능, 인가되지 않은 ADMIN의 자기 지정 금지, 위임받을 사용자는 활성 계정+출하 승인 자격 필수, 종료 일시 경과 시 자동 만료
- 워크플로를 템플릿→버전→단계의 불변 버전 모델로 확정: `workflow_templates`/`workflow_versions`/`workflow_steps`, 발행된 버전의 단계 구조는 불변, 구조 변경 시 신규 버전 생성, 신규 접수 건은 최신 활성 버전 사용, 기존 접수 건은 배정된 버전 유지(`repair_cases.workflow_version_id`)
- 워크플로 단계의 활성/비활성(`is_active`) 토글은 발행된 버전에서도 예외적으로 허용하되 구조(존재/순서/이름) 자체는 변경하지 않음을 명시. 비활성화된 단계는 신규 전이 대상에서 제외되며, 이미 그 단계에 있는 접수 건은 인가된 사용자가 사유와 함께 수동 이동하기 전까지 유지
- 권한 모델 원칙 문서화(DATABASE_DESIGN.md 17번, SECURITY_POLICY.md 2번): SUPER_ADMIN 접근도 인가 정책을 통해 평가, 사용자별 권한 부여/회수의 감사 로그 기록, 역할 기반 권한과 사용자별 예외 권한의 구분, 향후 `permissions`/`role_permissions`/`user_permissions` 구조로의 확장 가능성
- API 명세에 워크플로 버전 관리(버전 생성/발행/단계 추가·수정·순서변경·활성토글) 및 출하 승인 위임 관리(생성/조회/취소/지정권한 부여) placeholder 엔드포인트 추가

### Changed

- `shipment_approval_delegations`에서 `shipment_approval_id`(건별 1:1 종속) 제거 — 위임은 이제 기간 기반으로 여러 승인 건에 적용 가능
- `workflow_steps`의 상위 참조를 `workflow_template_id`에서 `workflow_version_id`로 변경
- `repair_cases`의 워크플로 참조를 `workflow_template_id`에서 `workflow_version_id`로 변경

### Notes

- 이번 버전에도 애플리케이션 소스 코드, 설정 파일, DB 마이그레이션, 패키지는 포함되지 않는다.

## [0.2.0] - 2026-08-03

### Added

- 5개 사용자 역할(SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES/INVENTORY_MANAGER)을 요구사항/로드맵/설계 문서 전반에 일관 반영
- 언어 정책(웹 UI 한국어, 코드/DB/API 영어, 교산 Excel 일본어, 내부 용어사전) 명문화
- 표준 용어 정의(A/S 접수·제품 접수 / 제품 인수 / 인수점검) 확정
- Matcher, 유상 Generator, 무상(보증) Generator 3개 워크플로 상세 정의 및 예외 상태 9종 확정 (TBD 해소)
- 워크플로 단계의 관리자 추가/비활성화/순서 변경 규칙 및 이력 보존 원칙 정의
- 출하 승인 위임 정책(대표/대행자 구분, 위임 기간·사유·처리시각 기록, 증빙 첨부) 정의 및 DATABASE_DESIGN.md에 `shipment_approval_delegations` 엔티티 추가
- 출하 완료 후 수정(잠금 해제) 정책 6단계 흐름 정의 및 `unlock_requests` 엔티티/API 확정
- 인증·파일·백업·감사 영역의 기결정 요구사항 반영(TBD 제거): 회사 이메일 인증, 7회 실패 계정 잠금, 관리자 설정 자동 로그아웃, 2FA 확장 가능 구조, 내부망/VPN 전용 접속, 파일 300MB 제한과 분할 업로드, 원본+미리보기 보관, 반영구 보관, 지원 파일 유형 목록, RTO 1시간/RPO 24시간 미만(권장 1시간), 감사 로그 3년 보관 및 15종 행위 유형
- 감사 로그 보관·삭제 정책(권장 정책)을 append-only + 3년 보관 + 만료 후 자동 삭제 + 예외적 조기 삭제 시 별도 보안 이벤트 기록으로 확정
- "삭제"를 워크플로 예외 상태 목록에서 제외하고, `is_deleted`/`deleted_at`/`deleted_by`/`delete_reason` 소프트 삭제 필드 체계로 전환
- 스토리지 아키텍처 기준선(온프레미스 서버/서버급 PC + NAS, 테스트/운영 환경 분리, 비공개 NAS 접근) 문서화
- API 명세에 워크플로 관리(단계 추가/수정·비활성화/순서 변경 개별 엔드포인트), 검수·출하 승인(위임·증빙 포함), Excel 리포트, 잠금 해제(unlock-requests 4단계 정규 구조) placeholder 엔드포인트 추가

### Changed

- 감사 로그 action_type을 15종 고정값으로 확정(기존 예시 나열 방식에서 변경)
- API_SPECIFICATION.md의 단수형 `unlock-request` 엔드포인트를 폐기하고 `unlock-requests`(복수형) 4개 엔드포인트로 대체

### Notes

- 이번 버전에는 애플리케이션 소스 코드, Next.js 파일, 설정 파일, DB 마이그레이션이 포함되지 않는다. 설계 문서 단계이다.

## [0.1.0] - 2026-08-03

### Added

- PROJECT_REQUIREMENTS.md, CLAUDE.md, DEVELOPMENT_ROADMAP.md 3대 문서 간 용어/범위 정합성 정리
- 1차 운영 배포 범위(18개 기능) 및 인수번호 규칙(D+연도2자리+월2자리+순번2자리) 확정
- 기존 Excel 약 600건 데이터 이전 조건 정의
- DATABASE_DESIGN.md 작성 (엔티티/테이블/관계/PK·FK/네이밍/인덱스/Soft Delete/감사 로그/첨부파일/이력/Excel 이전 전략)
- UI_GUIDELINE.md 작성 (레이아웃/내비게이션/테이블·폼·다이얼로그 스타일/버튼·컬러 규칙/타이포그래피/다크모드/모바일/한국어 용어 정책)
- SECURITY_POLICY.md 작성 (인증/인가/비밀번호/HTTPS/VPN/파일·DB 암호화/백업/감사 로그/업로드/악성코드 검사 정책)
- API_SPECIFICATION.md 작성 (초기 REST API 엔드포인트 및 1차 배포 후행 기능 Placeholder 엔드포인트)
- 5개 사용자 역할(Super Administrator, Administrator, A/S Engineer, Sales, Inventory Manager) 체계 확정

### Notes

- 이번 버전에는 애플리케이션 소스 코드, Next.js 파일, 설정 파일, DB 마이그레이션이 포함되지 않는다. 설계 문서 단계이다.
