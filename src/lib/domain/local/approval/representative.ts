/**
 * 최종 출하 승인의 "대표" 사용자를 나타내는 명시적 상수다. 역할(SUPER_ADMIN)로
 * 판정하지 않고 특정 사용자 ID로만 판정한다 — 가상 사용자 목록에 SUPER_ADMIN이
 * 여러 명 추가되더라도 이 ID를 가진 사용자만 대표로 취급된다.
 *
 * 선정 기준: 가상 사용자 목록(mock-data.ts)에서 유일한 SUPER_ADMIN(최고관리자)인
 * 김도윤(u-001)을 대표로 지정한다. PROJECT_REQUIREMENTS.md의
 * "최종 출하 승인은 원칙적으로 대표(회사 대표자)가 수행한다" 규정을
 * 데모용으로 단순화해 반영한 것이며, 실제 조직의 대표이사 지정 절차가
 * 아니다.
 */
export const FINAL_SHIPMENT_REPRESENTATIVE_USER_ID = "u-001";

/**
 * 데모 초기 위임 시드에서 사용하는 대행 승인자(위임받는 사용자)다. 실제
 * 위임 지정 UI는 이 스테이지에 구현하지 않으며, 이 값은 시드 데이터 생성에만
 * 사용된다.
 */
export const SEED_DELEGATE_USER_ID = "u-002";
