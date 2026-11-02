import type { ReactNode } from "react";
import type { ExecutionFoldGroup } from "@/lib/domain/procedure-execution-list-fold";

/**
 * 실행 화면 아래 목록을 담는 **접히는 묶음** 한 덩이. 두 번 쓴다 — 「전체 단계
 * 보기」와 「지나온 길」.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 왜 <details> 인가 — 상태를 하나도 안 늘린다
 * ──────────────────────────────────────────────────────────────────────
 * 실행 화면(ProcedureExecutionScreen)은 **서버 컴포넌트**다. 접기 하나 때문에
 * "use client" 를 붙이면 그 아래 트리가 통째로 클라이언트가 되고, DB 조회 타입과
 * 서버 액션 사슬까지 끌려간다. 네이티브 <details> 는 자바스크립트 없이 접히고
 * 키보드 조작·접근성도 브라우저가 처리한다 — 이 앱의 기존 접기(워크플로 변경
 * 이력, ManualStepSetPanel)가 이미 같은 방식이다.
 *
 * 열고 닫은 상태는 **기억하지 않는다.** 새로고침하면 아래 open 규칙이 정한
 * 기본으로 돌아간다. 기억하려면 쿠키든 localStorage 든 클라이언트가 필요한데,
 * 그렇게까지 할 만큼 비싼 조작이 아니다(한 번 누르면 열린다).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 접을지 말지를 **여기서 정하지 않는다**
 * ──────────────────────────────────────────────────────────────────────
 * open 도 머릿수도 덧말도 전부 buildExecutionListFold(도메인)가 정해서 group 에
 * 담아 준다. 이 컴포넌트가 다시 판정하면 「차단됨이 있으면 펼친다」가 두 벌이
 * 되고, 한쪽만 고치는 날이 온다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 접힌 줄에 덧말이 남는 까닭
 * ──────────────────────────────────────────────────────────────────────
 * <details open> 은 **사람이 눌러서 닫을 수 있다.** 닫힌 뒤에도 「차단됨 2」가
 * 줄에 남아야, 접어 둔 채로도 막힌 것이 있다는 사실이 화면에서 안 사라진다.
 */
export default function ExecutionFoldSection({
  group,
  children,
}: {
  group: ExecutionFoldGroup;
  children: ReactNode;
}) {
  return (
    <details
      open={group.open}
      data-execution-fold
      data-fold-open-reason={group.openReason ?? undefined}
      className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
        <span className="flex items-center gap-2">
          {/* 네이티브 삼각형 마커는 list-none 으로 숨겼다(브라우저마다 모양이
              다르고 글자 크기를 안 따른다). 대신 이 글자가 돌아간다. */}
          <span aria-hidden="true" className="text-zinc-400 transition-transform group-open:rotate-90 dark:text-zinc-500">
            ▶
          </span>
          <span data-fold-summary>{group.summary}</span>
          {group.note && (
            <span
              data-fold-note
              className={
                group.note.tone === "ATTENTION"
                  ? "rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : "rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }
            >
              {group.note.text}
            </span>
          )}
        </span>
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
          <span className="group-open:hidden">펼치기</span>
          <span className="hidden group-open:inline">접기</span>
        </span>
      </summary>

      {/* 🔴 안쪽은 받은 그대로 그린다. 펼쳤을 때 카드가 전과 똑같이 보여야
          한다 — 이번 조각은 **담는 그릇**만 바꾼다. */}
      <div className="flex flex-col gap-4 border-t border-zinc-200 p-3 dark:border-zinc-800">{children}</div>
    </details>
  );
}
