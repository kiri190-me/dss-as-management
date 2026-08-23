import { getMasterDataTrashRetentionStatus } from "@/lib/domain/master-data-trash-retention";

/**
 * "만료까지 N일" / "만료됨" — 마스터 데이터 휴지통(고객사·제품 모델)의
 * 보존 상태 배지.
 *
 * 표와 카드가 같은 컴포넌트를 쓴다 — 두 배치가 같은 행에 대해 다른 문구를
 * 보여 줄 수 없게 하는 가장 확실한 방법이다. 계산은
 * getMasterDataTrashRetentionStatus 하나뿐이고, 자동 완전삭제가 대상을
 * 고를 때도 같은 함수를 쓴다(master-data-purge.ts). 그래서 여기 "만료됨"이
 * 뜬 행은 다음 정리 회차의 대상이라는 뜻이 된다 — 화면의 말과 실제 동작이
 * 어긋날 수 있는 틈이 없다.
 *
 * 만료됐다고 해서 복원이 막히지는 않는다. 아직 정리가 돌지 않았다면 그
 * 행은 여전히 거기 있고, 있는 것을 되살리지 못할 이유가 없다.
 */
export default function MasterDataTrashRetentionBadge({ deletedAt }: { deletedAt: string }) {
  const status = getMasterDataTrashRetentionStatus(deletedAt);
  if (status.isExpired) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-400">
        만료됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      만료까지 {status.daysRemaining}일
    </span>
  );
}
