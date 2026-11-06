import {
  domesticOrderDetailHeadFacts,
  type DomesticOrderDetailHeadRow,
} from "@/lib/domain/domestic-order-basic-info";

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
 */
export default function DomesticOrderDetailHeader({ row }: { row: DomesticOrderDetailHeadRow }) {
  const facts = domesticOrderDetailHeadFacts(row);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기타건 상세</h1>
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
