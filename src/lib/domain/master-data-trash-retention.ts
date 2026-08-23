/**
 * 마스터 데이터 휴지통의 15일 보존 계산 — 고객사 관리와 제품 모델 관리가
 * 함께 쓴다.
 *
 * ── 왜 접수 건 것을 그대로 쓰지 않는가 ──────────────────────────────────
 * repair-case-trash-retention.ts는 "휴지통마다 보존 기간은 따로 승인된
 * 정책이라 같이 움직인다고 보장할 수 없다"는 이유로 자기 모듈을 갖고 있다.
 * 그 판단은 지금도 유효하다 — 접수 건의 15일이 바뀌어도 마스터 데이터의
 * 15일이 따라 바뀌어야 할 이유는 없다.
 *
 * ── 그런데 왜 고객사와 제품 모델은 한 모듈인가 ──────────────────────────
 * 이 둘은 같은 자리에서 같은 결정으로 함께 도입됐다(고객사·제품 모델 삭제
 * 체크포인트). 같은 결정에서 나온 하나의 정책을 파일 두 개로 베껴 두면,
 * 한쪽만 고쳐지는 날 두 화면이 서로 다른 날짜를 보여 주면서도 어느 쪽이
 * 맞는지 알 수 없게 된다. 나중에 둘이 갈라져야 할 이유가 실제로 생기면
 * 그때 쪼갠다 — 지금 미리 쪼개 두는 것은 있지도 않은 차이를 코드에
 * 새겨 두는 일이다.
 *
 * `deleted_at`은 진짜 timestamptz 순간이므로 15일은 그 순간부터의 실제
 * 경과 시간이다. KST 달력 날짜 차이가 아니다.
 *
 * ── 여기가 표시용이 아니라 실제 판정이다 ────────────────────────────────
 * 접수 건 쪽 모듈에는 "표시 전용, purge가 읽지 않는다"고 적혀 있었지만
 * 지금은 그 말이 더는 맞지 않는다(repair-cases-purge.ts가 그 함수를 부른다).
 * 이 모듈은 처음부터 양쪽이 함께 쓴다 — 휴지통 배지가 "만료됨"이라고 말하는
 * 순간이 곧 자동 완전삭제가 대상으로 삼는 순간이고, 그 둘이 어긋날 수 없게
 * 하는 것이 이 함수 하나를 공유하는 이유다.
 */

export const MASTER_DATA_TRASH_RETENTION_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MasterDataTrashRetentionStatus = {
  /** deletedAt로부터 15일 뒤의 ISO 순간. */
  expiresAt: string;
  /** 만료까지 남은 일수. 올림이라 "오늘 안에 만료"도 0이 아니라 1로 읽힌다. 만료 후에는 음수. */
  daysRemaining: number;
  isExpired: boolean;
};

export function getMasterDataTrashRetentionStatus(
  deletedAt: string,
  now: Date = new Date()
): MasterDataTrashRetentionStatus {
  const expiresAtMs = new Date(deletedAt).getTime() + MASTER_DATA_TRASH_RETENTION_DAYS * MS_PER_DAY;
  const msRemaining = expiresAtMs - now.getTime();
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining: Math.ceil(msRemaining / MS_PER_DAY),
    isExpired: msRemaining <= 0,
  };
}
