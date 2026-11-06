import {
  domesticOrderBasicInfoGroups,
  type DomesticOrderBasicInfoRow,
} from "@/lib/domain/domestic-order-basic-info";

/**
 * 「기타건 상세」의 **기본정보 탭** — 그 줄의 내자 정리 값을 한눈에
 * (2026-11-06 사용자 지정: 「견적서 번호, 내자정리의 내용들을 한눈에 볼 수
 * 있도록」 · 「기본정보를 첫화면으로」).
 *
 * 🔴 **무엇을 어떤 글자로 적는지는 여기서 정하지 않는다** — 묶음·칸·글자를 전부
 * 도메인 하나가 내놓는다(domesticOrderBasicInfoGroups). 이 파일이 하는 일은 그것을
 * 늘어놓는 것뿐이다. 까닭은 그 파일 머리말에 있다: 「어느 칸이 어느 묶음에 몇 개
 * 들어가는가」는 값으로 잴 수 있는 사실인데, JSX 안에 늘어놓으면 칸 하나가 빠져도
 * 아무 데서도 티가 나지 않는다.
 *
 * 🔵 **서버 컴포넌트다**(`"use client"` 가 없다). 표시 전용이고, 여기서 클라이언트
 * 경계를 그으면 이 줄 전체가 브라우저로 한 번 더 실려 간다.
 *
 * 🔵 **눌러 고치는 칸이 하나도 없다.** 내자 정리 값을 고치는 자리는 목록 화면이고
 * (칸을 눌러 그 자리에서 · 줄 수정 폼), 이 화면은 읽기 전용이다 — 같은 값을 고칠 수
 * 있는 자리를 둘로 늘리면 낙관적 잠금이 두 화면에서 서로를 밀어낸다.
 *
 * 묶음마다 `<section>` 과 `<h2>` 를 둔다 — 화면 낭독기가 「지금 어느 묶음의 칸을
 * 읽고 있는지」 말할 수 있어야 한다(목록의 표가 고객사 소제목에 scope="rowgroup"
 * 을 두는 것과 같은 까닭).
 */
export default function DomesticOrderBasicInfoView({ row }: { row: DomesticOrderBasicInfoRow }) {
  const groups = domesticOrderBasicInfoGroups(row);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.label}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{group.label}</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map((field) => (
              <div key={field.label}>
                {/* 설명이 있는 칸은 목록의 표 머리말과 **같은 글자**를 title 로 받는다
                    (field.hint) — 화면이 달라졌다고 설명이 사라지면 같은 칸이 화면마다
                    다른 규칙으로 읽힌다. */}
                <dt className="text-xs text-zinc-500 dark:text-zinc-500" title={field.hint}>
                  {field.label}
                </dt>
                <dd className="break-words text-zinc-900 dark:text-zinc-100">
                  {/* 🔴 한 줄에 하나씩 **마디로** 쌓는다 — 줄바꿈 문자와 CSS 에
                      맡기지 않는다(목록의 납기요청일 칸과 같은 까닭: 그러면 무엇이
                      한 줄인지가 whitespace 설정에 달린다). 거의 모든 칸은 한 줄이다. */}
                  {field.lines.map((line, index) => (
                    <span key={index} className="block">
                      {line}
                    </span>
                  ))}
                  {/* 빌려 온 값에 붙는 꼬리표(지금은 납기요청일 하나). 목록의 같은
                      꼬리표와 같은 글자·같은 중립적인 회색이다 — 「발주일 미정」 같은
                      주의 표시가 아니라 값의 출처를 알리는 표시다. */}
                  {field.note !== undefined && (
                    <span className="mt-0.5 inline-block rounded border border-zinc-300 px-1 py-0.5 text-[11px] leading-none font-normal text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                      {field.note}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
