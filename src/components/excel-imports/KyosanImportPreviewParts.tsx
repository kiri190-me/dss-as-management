"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useUiText } from "@/components/providers/UiTextProvider";
import type { KyosanRawRow } from "@/lib/domain/kyosan-intake-import/types";
import { billingTypeLabels } from "@/lib/domain/types";
import { workflowKindLabels } from "@/lib/domain/workflow-kind";
import type {
  KyosanExistingCaseView,
  KyosanNameSuggestion,
  KyosanNewNames,
  KyosanPreviewCounts,
  KyosanPreviewRow,
  KyosanPreviewStatus,
  KyosanRowPlan,
} from "@/lib/server/services/kyosan-intake-import";
import {
  KYOSAN_STATUS_LABELS,
  REPAIR_CASE_TRASH_HREF,
  REPAIR_CASE_TRASH_LABEL,
  formatKyosanRowNumbers,
  repairCaseHref,
  type KyosanBillingFlagCounts,
  type KyosanFailureText,
  type KyosanRowFilter,
} from "./kyosan-import-view-model";

/**
 * ============================================================================
 * 과거 인수품 가져오기 — 미리보기를 그리기만 하는 조각
 * ============================================================================
 * 서버 액션을 부르는 쪽(KyosanIntakeImportScreen.tsx)과 나눠 둔다. 이 파일은 서버 모듈을
 * 타입으로만 가져오므로 test:components 에서 그대로 그려 볼 수 있다
 * (KyosanImportParts.test.tsx — UserDeletionParts.tsx 와 같은 방식).
 * ============================================================================
 */

export const KYOSAN_SECTION_CLASS =
  "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

export const KYOSAN_TH_CLASS =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

const TD_CLASS = "px-3 py-2 align-top";
const LINK_CLASS = "font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300";
const ATTENTION_TEXT_CLASS = "text-amber-700 dark:text-amber-400";

const STATUS_BADGE_CLASS: Record<KyosanPreviewStatus, string> = {
  IMPORTABLE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  NEEDS_REVIEW: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ALREADY_EXISTS: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ALREADY_EXISTS_TRASHED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  EXCLUDED: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
};

// ── 실패 ──────────────────────────────────────────────────────────────────

/** 미리보기 · 조각 실패를 사람이 읽을 문장으로. 머리글 불일치 · 안전 검사 항목은 목록으로. */
export function KyosanFailureNotice({ failure }: { failure: KyosanFailureText }) {
  return (
    <div
      role="alert"
      data-role="kyosan-failure"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
    >
      <p className="font-medium">{failure.title}</p>
      {failure.detail ? <p className="mt-1">{failure.detail}</p> : null}
      {failure.lines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {failure.lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── 건수 카드 (누르면 거른다) ───────────────────────────────────────────────

type CountCard = { filter: KyosanRowFilter; label: string; value: number; tone: "plain" | "good" | "attention" };

function countCards(counts: KyosanPreviewCounts, billing: KyosanBillingFlagCounts): CountCard[] {
  return [
    { filter: "ALL", label: "전체", value: counts.total, tone: "plain" },
    { filter: "IMPORTABLE", label: KYOSAN_STATUS_LABELS.IMPORTABLE, value: counts.IMPORTABLE, tone: "good" },
    {
      filter: "NEEDS_REVIEW",
      label: KYOSAN_STATUS_LABELS.NEEDS_REVIEW,
      value: counts.NEEDS_REVIEW,
      tone: counts.NEEDS_REVIEW > 0 ? "attention" : "plain",
    },
    { filter: "ALREADY_EXISTS", label: KYOSAN_STATUS_LABELS.ALREADY_EXISTS, value: counts.ALREADY_EXISTS, tone: "plain" },
    {
      filter: "ALREADY_EXISTS_TRASHED",
      label: KYOSAN_STATUS_LABELS.ALREADY_EXISTS_TRASHED,
      value: counts.ALREADY_EXISTS_TRASHED,
      tone: "plain",
    },
    { filter: "EXCLUDED", label: KYOSAN_STATUS_LABELS.EXCLUDED, value: counts.EXCLUDED, tone: "plain" },
    {
      filter: "BILLING_REVIEW",
      label: "가져올 것 중 유/무상 확인 필요",
      value: billing.billingReview,
      tone: billing.billingReview > 0 ? "attention" : "plain",
    },
    {
      filter: "BILLING_ADJUSTED",
      label: "가져올 것 중 일부 유상으로 바뀜",
      value: billing.billingAdjusted,
      tone: billing.billingAdjusted > 0 ? "attention" : "plain",
    },
  ];
}

const CARD_VALUE_CLASS: Record<CountCard["tone"], string> = {
  plain: "text-zinc-900 dark:text-zinc-50",
  good: "text-emerald-700 dark:text-emerald-300",
  attention: ATTENTION_TEXT_CLASS,
};

export function KyosanCountCards({
  counts,
  billing,
  filter,
  onFilterChange,
}: {
  counts: KyosanPreviewCounts;
  billing: KyosanBillingFlagCounts;
  filter: KyosanRowFilter;
  onFilterChange: (filter: KyosanRowFilter) => void;
}) {
  return (
    <div role="group" aria-label="상태로 거르기" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {countCards(counts, billing).map((card) => {
        const active = card.filter === filter;
        return (
          <button
            key={card.filter}
            type="button"
            data-filter={card.filter}
            aria-pressed={active}
            onClick={() => onFilterChange(card.filter)}
            className={`rounded-lg border px-3 py-2 text-left ${
              active
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            }`}
          >
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{card.label}</span>
            <span className={`block text-lg font-semibold tabular-nums ${CARD_VALUE_CLASS[card.tone]}`}>{card.value}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 새로 생길 이름 ─────────────────────────────────────────────────────────

type NewNameEntry = {
  key: string;
  name: string;
  note: string | null;
  rowNumbers: number[];
  suggestions: KyosanNameSuggestion[];
};

function NewNameGroup({ group, title, entries }: { group: string; title: string; entries: NewNameEntry[] }) {
  return (
    <div data-group={group}>
      <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{`${title} ${entries.length}개`}</h4>
      {entries.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">없음</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {entries.map((entry) => (
            <li key={entry.key} className="break-words text-sm text-zinc-900 dark:text-zinc-100">
              <span className="font-medium">{entry.name}</span>
              {entry.note ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{` · ${entry.note}`}</span> : null}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{`행 ${formatKyosanRowNumbers(entry.rowNumbers)}`}</p>
              {entry.suggestions.length > 0 ? (
                <p className={`text-xs ${ATTENTION_TEXT_CLASS}`}>
                  {`비슷한 기존 이름: ${entry.suggestions.map((suggestion) => `「${suggestion.name}」`).join(" · ")}`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KyosanNewNamesPanel({ newNames }: { newNames: KyosanNewNames }) {
  const customers: NewNameEntry[] = newNames.customers.map((entry, index) => ({
    key: `${index}-${entry.name}`,
    name: entry.name,
    note: null,
    rowNumbers: entry.rowNumbers,
    suggestions: entry.suggestions,
  }));
  const endUsers: NewNameEntry[] = newNames.endUsers.map((entry, index) => ({
    key: `${index}-${entry.customerName}-${entry.name}`,
    name: entry.name,
    note: entry.customerId === null ? `새 고객사 「${entry.customerName}」 밑` : `고객사 「${entry.customerName}」 밑`,
    rowNumbers: entry.rowNumbers,
    suggestions: entry.suggestions,
  }));
  const productModels: NewNameEntry[] = newNames.productModels.map((entry, index) => ({
    key: `${index}-${entry.name}`,
    name: entry.name,
    note: workflowKindLabels[entry.kind],
    rowNumbers: entry.rowNumbers,
    suggestions: entry.suggestions,
  }));
  const total = customers.length + endUsers.length + productModels.length;

  return (
    <section data-role="new-names" className={KYOSAN_SECTION_CLASS}>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{`새로 생길 이름 (${total}개)`}</h3>
      {total === 0 ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          새로 생길 이름이 없습니다 — 가져올 줄은 모두 기존 고객사 · End-User · 모델에 붙습니다.
        </p>
      ) : (
        <>
          <p className={`mt-1 text-xs ${ATTENTION_TEXT_CLASS}`}>
            가져오면 아래 이름이 새로 등록됩니다. 오타면 여기서 고칠 수 없습니다 — 엑셀을 고쳐 다시 올리세요.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <NewNameGroup group="customers" title="고객사" entries={customers} />
            <NewNameGroup group="end-users" title="End-User" entries={endUsers} />
            <NewNameGroup group="product-models" title="모델" entries={productModels} />
          </div>
        </>
      )}
    </section>
  );
}

// ── 줄 표 ─────────────────────────────────────────────────────────────────

/** 가져올 줄이 무엇이 되는가 — 절차 종류 · 절차 · 유무상 · 목표 단계(key) · 출하일. */
export function KyosanPlanSummary({ plan }: { plan: KyosanRowPlan }) {
  const uiText = useUiText();
  const created = [
    plan.customer.kind === "NEW" ? `고객사 「${plan.customer.name}」` : null,
    plan.endUser?.kind === "NEW" ? `End-User 「${plan.endUser.name}」` : null,
    plan.productModel.kind === "NEW" ? `모델 「${plan.productModel.name}」` : null,
  ].filter((value): value is string => value !== null);

  return (
    <div data-role="plan" className="space-y-0.5 text-xs text-zinc-700 dark:text-zinc-300">
      <p>
        {`${workflowKindLabels[plan.workflowKind]} · ${uiText.workflowType[plan.workflowType]} · ${billingTypeLabels[plan.billingType]}`}
      </p>
      <p>
        {"목표 단계 "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{plan.targetStepKey}</code>
        {plan.actualShipmentDate ? ` · 출하일 ${plan.actualShipmentDate}` : ""}
      </p>
      {plan.billingReview ? (
        <p data-role="billing-review" className={`font-medium ${ATTENTION_TEXT_CLASS}`}>
          {`유/무상 확인 필요 — 원본 費用: ${plan.sourceBilling ?? "비어 있음"}`}
        </p>
      ) : null}
      {plan.billingAdjustment === "WARRANTY_PO_TO_PARTIAL_PAID" ? (
        <p data-role="billing-adjusted" className={`font-medium ${ATTENTION_TEXT_CLASS}`}>
          원본 無償 · PO 대기 → 일부 유상으로 바뀜
        </p>
      ) : null}
      {created.length > 0 ? <p className="text-zinc-500 dark:text-zinc-400">{`새로 생김: ${created.join(" · ")}`}</p> : null}
    </div>
  );
}

/** 같은 인수번호의 기존 건 — 파일과 나란히. 다른 물건으로 보이면 눈에 띄게. */
export function KyosanExistingComparison({
  existing,
  raw,
}: {
  existing: KyosanExistingCaseView;
  raw: Pick<KyosanRawRow, "customerName" | "modelName" | "serialNumber">;
}) {
  const lines: [string, string | null, string | null][] = [
    ["고객사", raw.customerName, existing.customerName],
    ["모델", raw.modelName, existing.modelName],
    ["S/N", raw.serialNumber, existing.serialNumber],
  ];
  return (
    <div data-role="existing" data-trashed={existing.trashed ? "true" : "false"} className="space-y-1 text-xs">
      {existing.looksDifferent ? (
        <p
          data-role="looks-different"
          className="inline-block rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          다른 건으로 보임 — 인수번호를 잘못 적었을 수 있습니다
        </p>
      ) : null}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-zinc-700 dark:text-zinc-300">
        <span />
        <span className="font-medium text-zinc-500 dark:text-zinc-400">파일</span>
        <span className="font-medium text-zinc-500 dark:text-zinc-400">{existing.trashed ? "기존 건(휴지통)" : "기존 건"}</span>
        {lines.map(([label, fileValue, existingValue]) => (
          <Fragment key={label}>
            <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
            <span className="break-words">{fileValue ?? "—"}</span>
            <span className="break-words">{existingValue ?? "—"}</span>
          </Fragment>
        ))}
      </div>
      {existing.trashed ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {"휴지통에 있는 건입니다 — "}
          <Link href={REPAIR_CASE_TRASH_HREF} className={LINK_CLASS}>
            {REPAIR_CASE_TRASH_LABEL}
          </Link>
          에서 복원 또는 완전 삭제 후 다시 가져오기
        </p>
      ) : (
        <Link href={repairCaseHref(existing.repairCaseId)} className={LINK_CLASS}>
          {`기존 건 ${existing.intakeNumber} 열기`}
        </Link>
      )}
    </div>
  );
}

function MessageList({ items, attention, prefix }: { items: readonly string[]; attention: boolean; prefix: string }) {
  if (items.length === 0) return null;
  return (
    <ul
      className={`mt-1 list-disc space-y-0.5 pl-4 text-xs ${attention ? ATTENTION_TEXT_CLASS : "text-zinc-600 dark:text-zinc-400"}`}
    >
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{`${prefix}${item}`}</li>
      ))}
    </ul>
  );
}

function KyosanPreviewTableRow({ row }: { row: KyosanPreviewRow }) {
  const raw = row.raw;
  const looksDifferent = row.existing?.looksDifferent === true;
  return (
    <tr
      data-row={row.rowNumber}
      data-status={row.status}
      data-looks-different={looksDifferent ? "true" : undefined}
      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${
        looksDifferent ? "bg-red-50 dark:bg-red-950/40" : ""
      }`}
    >
      <td className={`${TD_CLASS} tabular-nums text-zinc-500 dark:text-zinc-400`}>{row.rowNumber}</td>
      <td className={TD_CLASS}>
        <div className="whitespace-nowrap font-medium">{raw.intakeNumber ?? "—"}</div>
        <div className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{raw.receivedAt ?? "인수일 없음"}</div>
      </td>
      <td className={TD_CLASS}>
        <div className="break-words">{raw.customerName ?? "—"}</div>
        {raw.endUserName ? (
          <div className="break-words text-xs text-zinc-500 dark:text-zinc-400">{`End-User ${raw.endUserName}`}</div>
        ) : null}
      </td>
      <td className={TD_CLASS}>
        <div className="break-words">
          {raw.modelName ?? "—"}
          {raw.kindText ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{` (${raw.kindText})`}</span> : null}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {`S/N ${raw.serialNumber ?? "—"}${raw.lotNumber ? ` · L/N ${raw.lotNumber}` : ""}`}
        </div>
      </td>
      <td className={TD_CLASS}>
        <div className="break-words">{raw.statusText ?? "—"}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{`費用 ${raw.billingText ?? "—"}`}</div>
      </td>
      <td className={TD_CLASS}>
        <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
          {KYOSAN_STATUS_LABELS[row.status]}
        </span>
      </td>
      <td className={`${TD_CLASS} min-w-[18rem]`}>
        {row.plan ? <KyosanPlanSummary plan={row.plan} /> : null}
        {row.existing ? <KyosanExistingComparison existing={row.existing} raw={raw} /> : null}
        <MessageList items={row.reasons} attention={row.status === "NEEDS_REVIEW"} prefix="" />
        <MessageList items={row.warnings} attention prefix="주의: " />
      </td>
    </tr>
  );
}

/** 걸러지고 쪽이 나뉜 줄들. 표만 가로로 밀린다(좁은 화면에서 페이지는 넘치지 않는다). */
export function KyosanPreviewTable({ rows }: { rows: readonly KyosanPreviewRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        이 조건에 맞는 줄이 없습니다.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[960px] border-collapse text-sm text-zinc-900 dark:text-zinc-100">
        <thead>
          <tr>
            <th scope="col" className={KYOSAN_TH_CLASS}>행</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>인수번호 · 인수일</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>고객사 · End-User</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>모델 · S/N</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>원본 상태 · 費用</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>판정</th>
            <th scope="col" className={KYOSAN_TH_CLASS}>무엇이 되는가 · 사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <KyosanPreviewTableRow key={row.rowNumber} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
