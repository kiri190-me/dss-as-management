"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MyWorkRecordRow } from "@/lib/db/queries/my-work-records";
import {
  formatKstDayTime,
  groupMyWorkRecordsByKstMonth,
  MY_WORK_RECORD_MONTH_WINDOW,
} from "@/lib/domain/my-work-record-months";
import { workRecordKindLabels } from "@/lib/domain/types";
import { StatusBadge } from "@/components/repair-cases/badges";

/**
 * 「내 작업기록」 — 로그인한 엔지니어가 **본인이 적은** 작업기록을 달별로 보는
 * 화면. `rows` 는 이미 서버에서 본인 것으로 좁혀져 도착한다
 * (repair-cases/mine/work-records/page.tsx → listMyWorkRecords(actorId)) —
 * 여기서 하는 일은 묶고 접었다 펴는 것뿐이고, 다시 가져오거나 더 넓은 집합을
 * 받지 않는다. 「내 담당 제품」(MyActiveWorkScreen)과 같은 약속이다.
 *
 * ── 왜 ResponsiveList(표↔카드)를 안 타는가 ───────────────────────────────
 * 옆 탭의 목록은 열 일곱 개짜리 **표**라 좁은 화면에서 카드로 갈아타야 했다.
 * 이 화면은 애초에 표가 아니다 — 한 줄에 값 대여섯 개가 늘어서고 그 아래 메모가
 * 통째로 붙는 **목록**이라, 좁아지면 줄이 접히기만 하면 된다(flex-wrap). 표가
 * 없는데 ResponsiveList 를 끼우면 「표/카드」 토글이 아무 일도 하지 않는 채로
 * 보이게 된다.
 */

const baseBadgeClass =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/**
 * 메모를 접기 시작하는 줄 수.
 *
 * 근거: 엔지니어가 적는 작업기록은 대개 두세 줄이고, 길어도 대여섯 줄이다
 * (인수점검 결과를 항목별로 적을 때가 가장 길다). 그 정도까지는 접지 않는 편이
 * 낫다 — 매번 「더 보기」를 눌러야 하면 달 묶음을 펼친 뜻이 없어진다. 대신 수십
 * 줄짜리 하나가 달 전체를 밀어내는 것은 막아야 하므로, **평소 글이 그대로 다
 * 보이는 가장 작은 값**인 여덟 줄을 경계로 잡았다.
 */
const MEMO_FOLD_LINE_COUNT = 8;

function WorkRecordKindBadge({ kind }: { kind: MyWorkRecordRow["recordKind"] }) {
  // 라벨은 domain/types.ts 의 것을 그대로 쓴다 — 작업내용 탭과 같은 글자여야
  // 같은 것으로 읽힌다(여기서 다시 적으면 한쪽만 바뀐다).
  return (
    <span className={`${baseBadgeClass} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
      {workRecordKindLabels[kind]}
    </span>
  );
}

/**
 * 메모 본문. 🔴 **줄바꿈이 살아 있어야 한다** — 엔지니어가 항목을 줄로 나눠 적는다
 * (whitespace-pre-wrap). 긴 글만 접고, 접힌 동안에도 글 자체는 지우지 않는다.
 */
function MemoBody({ memo }: { memo: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = memo.split("\n");
  const foldable = lines.length > MEMO_FOLD_LINE_COUNT;
  const shown = foldable && !expanded ? lines.slice(0, MEMO_FOLD_LINE_COUNT).join("\n") : memo;

  return (
    <div className="mt-1">
      <p className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{shown}</p>
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1 text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {expanded ? "접기" : `더 보기 (${lines.length}줄)`}
        </button>
      )}
    </div>
  );
}

/**
 * 건으로 가는 자리. 🔴 **지워진 건에는 링크를 걸지 않는다** — 영구 삭제(기록의
 * repair_case_id 가 NULL)든 소프트 삭제(repair_cases.is_deleted)든, 누르면
 * "없는 건"으로 떨어지는 링크를 내미는 것이 더 나쁘다. 대신 그 자리에
 * 「(삭제된 건)」이라고 적어 **왜 누를 수 없는지**를 말한다.
 */
function CaseRef({ row }: { row: MyWorkRecordRow }) {
  const deletedMark = (
    <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">(삭제된 건)</span>
  );

  if (!row.repairCaseId) return deletedMark;

  if (row.isCaseDeleted) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="font-medium whitespace-nowrap text-zinc-500 line-through dark:text-zinc-400">
          {row.intakeNumber}
        </span>
        {deletedMark}
      </span>
    );
  }

  return (
    <Link
      href={`/repair-cases/${row.repairCaseId}`}
      className="font-medium whitespace-nowrap text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
    >
      {row.intakeNumber}
    </Link>
  );
}

function WorkRecordItem({ row }: { row: MyWorkRecordRow }) {
  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800">
      {/* 좁은 화면에서는 이 줄이 그대로 접힌다 — 표가 아니므로 가로 스크롤이 생기지 않는다. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatKstDayTime(row.createdAt)}
        </span>
        <WorkRecordKindBadge kind={row.recordKind} />
        <CaseRef row={row} />
        {row.customerName && <span className="text-sm text-zinc-600 dark:text-zinc-400">{row.customerName}</span>}
        {row.modelName && <span className="text-sm text-zinc-600 dark:text-zinc-400">{row.modelName}</span>}
        {row.status && <StatusBadge status={row.status} />}
      </div>
      <MemoBody memo={row.memo} />
    </li>
  );
}

export default function MyWorkRecordsScreen({
  rows,
  currentYearMonth,
}: {
  rows: MyWorkRecordRow[];
  /**
   * 「YYYY-MM」(한국시간). 🔴 **서버가 재서 넘긴다** — 화면에서 new Date() 로
   * 구하면 서버가 그린 것과 브라우저가 그린 것이 달라질 수 있고(hydration 어긋남),
   * 사용자 PC 시계가 다른 나라에 맞춰져 있으면 엉뚱한 달이 펼쳐진다.
   */
  currentYearMonth: string;
}) {
  const groups = useMemo(() => groupMyWorkRecordsByKstMonth(rows), [rows]);

  // 이번 달만 펼친 채로 연다. 나머지는 접힌 채다 — 열두 달이 한꺼번에 펼쳐지면
  // 「최근에 무엇을 했나」를 보러 온 사람이 다시 스크롤로 찾아야 한다.
  const [openMonths, setOpenMonths] = useState<ReadonlySet<string>>(() => new Set([currentYearMonth]));

  function toggleMonth(yearMonth: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) next.delete(yearMonth);
      else next.add(yearMonth);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 담당 제품</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          최근 {MY_WORK_RECORD_MONTH_WINDOW}개월 내 작업기록 {rows.length}건
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          최근 {MY_WORK_RECORD_MONTH_WINDOW}개월 동안 적은 작업기록이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* 🔴 기록이 없는 달은 묶음 자체가 없다(groupMyWorkRecordsByKstMonth) —
              「0건」짜리 줄을 12개 늘어놓지 않는다. */}
          {groups.map((group) => {
            const isOpen = openMonths.has(group.yearMonth);
            const panelId = `my-work-records-${group.yearMonth}`;
            return (
              <section
                key={group.yearMonth}
                className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    // 접힌 달은 줄을 아예 그리지 않으므로(12개월치 메모를 전부
                    // DOM 에 둘 이유가 없다) 가리킬 것이 없을 때는 aria-controls
                    // 도 붙이지 않는다 — 없는 id 를 가리키면 보조기기가 헛돈다.
                    aria-controls={isOpen ? panelId : undefined}
                    onClick={() => toggleMonth(group.yearMonth)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span aria-hidden="true" className="text-xs text-zinc-500 dark:text-zinc-400">
                      {isOpen ? "▼" : "▶"}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{group.label}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{group.count}건</span>
                  </button>
                </h2>
                {isOpen && (
                  <ul id={panelId} className="border-t border-zinc-200 dark:border-zinc-800">
                    {group.records.map((row) => (
                      <WorkRecordItem key={row.id} row={row} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
