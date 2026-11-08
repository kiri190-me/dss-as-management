import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import MiscCaseStatusBadge from "@/components/misc-cases/MiscCaseStatusBadge";
import {
  domesticOrderDetailHeadFacts,
  type DomesticOrderDetailHeadRow,
} from "@/lib/domain/domestic-order-basic-info";
import type { MiscCaseStatus } from "@/lib/domain/misc-case-status";

/**
 * 「기타건 상세」의 머리 카드 — 🔴 **품명 · 공급처 · 발행일자 · 발행번호**
 * (2026-11-06 사용자 지정: 「기타건 상세의 헤드에는 [품명, 공급처, 발행일자,
 * 발행번호]등이 표시되도록 해줘」).
 *
 * 생김새는 수리 건 상세의 머리 카드에서 가져왔다(DetailHeader) — 값마다 연한
 * 배경 알약을 입히고 그 안에 짧은 이름표를 넣는다. 같은 서비스의 상세 화면 둘이
 * 서로 다른 모양의 머리를 달고 있으면, 같은 자리에서 다른 눈높이를 요구한다.
 *
 * ⚠️ **저쪽과 일부러 다른 점 하나 — 빈 값도 알약을 그린다.** 수리 건 쪽은 빈
 * 조각을 통째로 빼는데(한 줄로 줄이는 것이 그 화면의 요점이라 `-` 하나가 자리를
 * 먹는 것을 피했다), 여기 넷은 **사용자가 「이것들이 보이게」라고 지목한 넷**이다.
 * 값이 없다고 알약이 사라지면 사람은 「값이 없다」가 아니라 「화면이 덜 그려졌다」로
 * 읽는다 — 특히 공급처는 견적서를 고객사 마스터에 안 이어도 저장되므로 실제로
 * 비어 올 수 있다(domain/domestic-order-basic-info.ts 의 그 ⚠️).
 *
 * 🔴 **넷을 무엇으로 채우는지는 여기서 정하지 않는다** — 도메인 하나가 정한다
 * (domesticOrderDetailHeadFacts). 왜 견적서가 아니라 내자 줄에서 읽는지가 그
 * 함수 주석에 적혀 있다(견적서 없이 생기는 줄이 있고, 기타 견적서가 만든 줄에서는
 * 두 길이 같은 글자이며, 목록이 그리는 값과 갈라지지 않아야 한다).
 *
 * 🔵 **서버 컴포넌트다**(`"use client"` 가 없다). 상태도 훅도 없는 표시 전용이라
 * 클라이언트 경계를 새로 긋지 않는다 — 레이아웃이 그대로 그린다.
 *
 * ── 🔴 상태 배지 (2026-11-06 사용자 요구) ──────────────────────────────
 * 「[기타건 최종 출하 승인]요청을 누르면 [출하 승인 대기] 베찌가 뜨도록 해줘(기타건
 * 상세의 헤드와 기타건 현황 목록에) 그리고 출하 승인이 모두 완료되면 [출하 대기]로
 * 베찌가 바뀌도록 해줘」.
 *
 * 🔴 **그 판정도 글자도 여기 없다** — 기타건 현황 목록이 쓰는 **같은 배지**를 그린다
 * (components/misc-cases/MiscCaseStatusBadge · domain/misc-case-status.ts). 두 곳에
 * 적으면 같은 줄이 목록과 상세에서 다른 말을 하게 된다.
 *
 * ⚠️ [승인] 탭 안의 배지와는 **일부러 말이 다르다**(거기는 「승인 대기 · 승인 완료」).
 * 그쪽은 **결재 기록 자체**의 상태이고 이것은 **기타건**의 상태다 — 까닭은
 * domain/misc-case-status.ts 머리말에 적었다.
 *
 * 🔵 `status` 는 **선택 인자**다. 넘기지 않으면 배지를 아예 그리지 않는다 — 이 카드를
 * 값만 보려고 그려 보는 자리(시험)에서 승인 조회까지 세우게 만들지 않기 위해서다.
 *
 * ── 🔴 [최종 출하 승인 완료] 배지 (2026-11-08 사용자 요구) ──────────────
 * 「수리건과 기타건 모두 최종출하승인이 되면 [최종 출하 승인 완료]라는 베찌가 현황판과
 * **상세페이지 헤드**, 내자정리의 [완료 처리]버튼의 오른쪽에」.
 *
 * 🔴 **위 상태 배지와 겹치지 않는다.** 「출하 대기」(승인은 끝났고 아직 안 나갔다)와
 * 겹쳐 보이지만, 그 배지는 **완료된 줄에서 「완료」로 덮인다**(domain/misc-case-status.ts
 * 의 보는 차례 ①) — 끝난 기타건에서는 승인 사실을 말할 자리가 여기밖에 없다. 그래서
 * 판정을 나눠 받는다.
 *
 * 🔴 **회차 여럿이면 전부 승인됐을 때만 붙는다** — 접는 일은 조회가 하고
 * (foldDomesticOrderApprovalStates), 이 카드는 그 결과를 받는다. 회차 하나만 끝난
 * 줄에서 머리에 「승인 완료」가 뜨면, 바로 아래 [승인] 탭의 카드 둘과 어긋난다.
 */
export default function DomesticOrderDetailHeader({
  row,
  status,
  finalShipmentApproved = false,
}: {
  row: DomesticOrderDetailHeadRow;
  status?: MiscCaseStatus;
  /** 🔴 판정은 도메인 하나가 한다(isFinalShipmentApproved) — `STALE` 에는 안 붙는다. */
  finalShipmentApproved?: boolean;
}) {
  const facts = domesticOrderDetailHeadFacts(row);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기타건 상세</h1>
        {/* 🔴 제목 **바로 옆**이다 — 값 알약 넷보다 앞에 둔다. 이 줄에서 사람이 가장
            먼저 묻는 것이 「이 건이 지금 어디까지 왔나」이고, 알약 사이에 섞어 두면
            품명·공급처와 같은 무게의 또 하나의 값으로 읽힌다. */}
        {status !== undefined && <MiscCaseStatusBadge status={status} />}
        {/* 🔴 상태 배지 **바로 오른쪽**이다 — 둘은 한 물음의 두 답이라(「어디까지
            왔나」·「결재는 끝났나」) 떼어 놓으면 값 알약 사이에서 길을 잃는다. */}
        <FinalShipmentApprovedBadge approved={finalShipmentApproved} />
        {/* 값 알약 묶음 — 가운뎃점 구분자는 두지 않는다(알약의 테두리가 가른다).
            좁은 화면에서는 묶음 안에서 줄바꿈된다. */}
        <div className="flex flex-wrap items-baseline gap-1.5">
          {facts.map((fact) => (
            <span
              key={fact.key}
              className="inline-flex items-baseline gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 whitespace-nowrap dark:bg-zinc-800"
            >
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{fact.label}</span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{fact.value}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
