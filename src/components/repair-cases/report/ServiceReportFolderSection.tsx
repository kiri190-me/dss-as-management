"use client";

import { useEffect, useState } from "react";

import ContactFolderEntryOpenButton from "@/components/repair-cases/files/ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton from "@/components/repair-cases/files/ContactFolderPlaceOpenButton";
import {
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT,
  CONTACT_FOLDER_SECTION_LOADING_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  CONTACT_FOLDER_SECTION_TITLE,
  canOpenContactFolderEntry,
  contactFolderEntryMeta,
  loadContactFolderEntries,
  truncatedText,
  type ContactFolderEntriesFetch,
  type ContactFolderEntryView,
  type ContactFolderSectionState,
} from "@/components/repair-cases/files/ContactFolderSection";
import { attachmentCategoryLabels } from "@/lib/domain/attachment-category";
import { contactFolderCategoryFolderName } from "@/lib/domain/contact-folder-naming";
import {
  serviceReportContactFolderCategory,
  serviceReportContactFolderRelativePath,
} from "@/lib/domain/service-report-contact-folder";
import {
  SHARE_FOLDER_ENTRY_ACTIONS_CLASS,
  SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS,
  SHARE_FOLDER_ENTRY_META_SIZE_CLASS,
  SHARE_FOLDER_ENTRY_NAME_GROW_CLASS,
  SHARE_FOLDER_ENTRY_ROW_CLASS,
} from "@/lib/domain/share-folder-entry-meta";
import { normalizeShareFolderNameForCompare } from "@/lib/domain/share-folder-naming";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 「보고서」 탭의 **공유폴더 구역** — 그 건의 연락서 폴더에 저장된 보고서만 (2026-10-12)
 * ============================================================================
 * 바로 앞 조각에서 보고서 [저장]이 그 건의 **연락서 폴더 안 분류 폴더**에 엑셀을 꽂고 그
 * 자리에서 PDF 로 바꾼다(domain/service-report-contact-folder.ts). 그것이 실제로 들어갔는지
 * 보려고 탐색기를 따로 열던 것을 이 자리에서 그대로 보여 준다.
 *
 *   D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *     ├─ DATA              ← 🔴 안 보인다
 *     ├─ 공통/              ← 🔴 안 보인다
 *     ├─ 인수 사진/         ← 🔴 안 보인다
 *     ├─ 견적서/            ← 🔴 안 보인다
 *     ├─ 검사 보고서/       ← ✅ 이 안만
 *     └─ 수리 보고서/       ← ✅ 그리고 이 안만
 *
 * ── 🔴 **보고서 둘을 한 창에 모은다**(사용자 결정 2026-10-12) ──────────────
 * 지금 보고 있는 종류만이 아니다 — 한 건에 검사 한 장 + 수리 한 장이 붙는 것이 보통이라
 * 둘을 갈라 두면 사람이 창을 두 번 봐야 한다.
 *
 * ── 🔴 어느 보고서인지는 **묶음 머리**로 가른다 ──────────────────────────
 * 줄에 「검사」 딱지를 붙이거나 열을 하나 더 두지 않았다. 까닭 셋:
 *  1. 표의 열 넷(`이름 · 수정날짜 · 크기 · 동작`)은 **공유폴더를 보여 주는 다섯 창이 함께
 *     쓰는 한 벌**이다(domain/share-folder-entry-meta.ts). 다섯째 열을 더하면 그 한 벌이
 *     갈라지거나 다른 네 창까지 따라 바뀐다.
 *  2. 묶음이 곧 **디스크의 분류 폴더 하나**다 — 화면의 생김새가 탐색기에서 보는 모양과 같다.
 *  3. 묶음마다 **[열기] 주소의 뿌리가 다르다**(`연락서 폴더/검사 보고서`). 줄을 섞으면 줄마다
 *     뿌리를 다시 들고 다녀야 한다.
 *
 * ── 🔴 **이미 있는 것을 가져다 쓴다** — 베끼지 않았다 ───────────────────────
 *  · 통로 · 읽기 · 상태 읽기 · 실패 문장 — 연락서 쪽 구역의 `loadContactFolderEntries`
 *    하나다(components/repair-cases/files/ContactFolderSection.tsx). 🔴 **그 파일은 한 글자도
 *    고치지 않았다.** 「아직 이 건의 폴더가 없습니다」 같은 문장도 그대로 가져다 쓴다 — 같은
 *    폴더를 두고 두 탭이 다른 말을 하지 않게.
 *  · 줄의 [열기] · 맨 아래 [폴더 열기] — 연락서 쪽 단추 두 벌을 **그대로** 쓴다. 도우미는
 *    PC 당 한 벌이라 베껴 두 벌을 만들면 반드시 한쪽만 고쳐진다. 🔴 그 단추가 함께 내는
 *    안내(「열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해 주세요」)도 그대로 따라오고
 *    **끄지 않는다.**
 *  · 분류 폴더 이름 — `contactFolderCategoryFolderName` 이 정한 것뿐이다. 🔴 **「검사 보고서」를
 *    글자로 적지 않는다** — 두 벌이 되면 이름표가 바뀌는 날 저장한 자리와 보여 주는 자리가
 *    갈라진다. 종류 → 분류를 잇는 표도 앞 조각의 것 하나다.
 *
 * ── 🔴 읽기만 한다 ─────────────────────────────────────────────────────────
 * 폴더를 만들지도, 파일을 올리지도, 지우지도 않는다. `node:fs` 가 들어올 길이 없고(화면이다),
 * 부르는 통로는 **목록 하나**뿐이다. 맨 아래 [폴더 열기]도 **여는 것만** 하는 단추다 —
 * 폴더가 없을 때 만들어 주는 단추는 여기 들어오지 않는다(그것은 「파일 관리」 탭의 몫이다).
 *
 * ── 🔴 서버 컴포넌트에서 읽지 않는다 ───────────────────────────────────────
 * 보고서 탭의 페이지는 이미 DB 를 여러 번 때리는 서버 컴포넌트다. 거기에 공유폴더 읽기를
 * 더하면 **NAS 가 느리거나 꺼진 날 보고서 탭 자체가 안 뜬다.** 화면이 뜬 뒤 여기서 따로
 * 통로를 부른다 — 이 구역만 「불러오는 중…」 → 「읽지 못했습니다」가 되고 보고서 목록 ·
 * 갈림길은 멀쩡하다(견적서 구역 · 연락서 구역과 같은 판단).
 *
 * ── 🔴 분류 폴더가 **아직 없는 것이 정상**이다 ─────────────────────────────
 * 보고서를 한 번도 저장하지 않은 건에는 `검사 보고서/` 도 `수리 보고서/` 도 없다 — 분류
 * 폴더는 **쓸 때 그때그때 생긴다**(contact-folder-naming.ts 머리말). 그래서 맨 위 칸을 **먼저
 * 한 번 읽어** 어느 분류 폴더가 **실제로 서 있는지** 보고, 서 있는 것만 한 번 더 읽는다.
 * 없는 자리를 바로 읽으러 가면 서버가 「하위 폴더를 찾을 수 없습니다」로 끝나 **아무 일도
 * 없는 건이 빨간 글씨**가 된다.
 *  · 🔴 견줄 때는 **다듬은 이름**으로, 경로를 이을 때는 **디스크의 실제 이름**으로 한다
 *    (share-folder-naming.ts 머리말의 규율 — 사람이 NFD 로 만든 폴더가 있을 수 있다).
 *
 * ── 🔴 인쇄에 안 찍힌다 ───────────────────────────────────────────────────
 * 공유폴더는 그때그때 달라지는 바깥 사정이라 종이에 남길 것이 아니다 — 바깥 틀에
 * `print:hidden` 을 건다.
 *
 * ── 상태별로 무엇을 보이는가 ───────────────────────────────────────────────
 *  · `disabled`  → 🔴 **구역 자체를 그리지 않는다**(설정이 없는 개발 PC 에서 빈 상자가 늘지 않게)
 *  · 불러오는 중 → 「불러오는 중…」
 *  · `not-found` → 「아직 이 건의 폴더가 없습니다」(muted)
 *  · `multiple`  → 🔴 「맞는 폴더가 여럿입니다」 — **목록을 내지 않는다**(어느 폴더인지 모르는데
 *                   내용을 보이면 남의 건 서류를 보일 수 있다)
 *  · `failed`    → 「공유폴더를 읽지 못했습니다」(warning) + 서버가 준 짧은 사유
 *  · `found` + 분류 폴더가 하나도 없다 → 「아직 공유폴더에 저장된 보고서가 없습니다 …」
 *  · `found` + 묶음 → 묶음마다 머리(분류 이름) + 표. 빈 분류 폴더는 「이 폴더가 비어 있습니다」,
 *                     그 분류만 못 읽었으면 그 묶음에만 사유가 선다
 * 🔴 어느 문장에도 **경로를 적지 않는다** — 폴더 이름은 찾았을 때만, 머리 오른쪽에 보인다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ──────────────────────────────────────
 * fetch 를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 없이 값으로 시험한다. 그려지는 것은
 * 상태를 직접 넣어 본다(ServiceReportFolderSection.test.tsx).
 * ============================================================================
 */

// ── 문장 ─────────────────────────────────────────────────────────────────

/** 🔴 연락서 쪽 구역과 **같은 머리말**이다 — 같은 폴더를 두 탭이 다르게 부르지 않게. */
export const SERVICE_REPORT_FOLDER_SECTION_TITLE = CONTACT_FOLDER_SECTION_TITLE;

/**
 * 🔴 **무엇만 보이는지 미리 적는다.** 이 구역은 연락서 폴더의 **두 분류 폴더 안**만 보여
 * 준다 — 그 말이 없으면 「인수 사진이 없어졌다」로 읽힌다(견적서 쪽이 숨긴 개수를 한 줄로
 * 알리는 것과 같은 까닭). 폴더 전체는 맨 아래 [폴더 열기]로 본다.
 */
export const SERVICE_REPORT_FOLDER_SECTION_SCOPE_TEXT =
  "이 건의 연락서 폴더에 저장된 보고서만 보입니다 — 폴더 전체는 [폴더 열기]로 보세요.";

/**
 * 🔴 폴더는 있는데 **보고서 분류 폴더가 하나도 없다.** 「폴더가 비어 있습니다」와 다른
 * 상황이라 다른 글자로 적는다 — 분류 폴더는 보고서를 처음 저장할 때 생긴다.
 */
export const SERVICE_REPORT_FOLDER_SECTION_NO_REPORTS_TEXT =
  "아직 공유폴더에 저장된 보고서가 없습니다 — 보고서를 [저장]하면 들어갑니다";

/** 그 분류 폴더만 못 읽었을 때의 머리말. 구역 전체가 실패한 것과 다르다. */
export const SERVICE_REPORT_FOLDER_GROUP_FAILED_TEXT = "이 분류 폴더를 읽지 못했습니다";

/** 🔴 올 수 없는 답이 왔다 — 묶음 하나만 사유 줄로 끝낸다(화면을 깨지 않는다). */
const UNEXPECTED_GROUP_REASON = "서버가 뜻밖의 답을 보냈습니다";

// ── 값 ───────────────────────────────────────────────────────────────────

/**
 * 묶음을 그리는 차례. 🔴 **`Record<ServiceReportKind, …>` 로 적는다** — 종류가 하나 늘면
 * tsc 가 빠진 칸을 짚는다(domain/service-report-contact-folder.ts 의 같은 판단). 배열로만
 * 적으면 새 종류가 조용히 빠진 채 화면이 멀쩡해 보인다.
 */
const SERVICE_REPORT_FOLDER_KIND_ORDER: Record<ServiceReportKind, number> = { INSPECTION: 0, REPAIR: 1 };

/** 검사 → 수리. 갈림길(report/page.tsx)이 내미는 차례와 같다. */
export const SERVICE_REPORT_FOLDER_KINDS: readonly ServiceReportKind[] = (
  Object.keys(SERVICE_REPORT_FOLDER_KIND_ORDER) as ServiceReportKind[]
).sort((a, b) => SERVICE_REPORT_FOLDER_KIND_ORDER[a] - SERVICE_REPORT_FOLDER_KIND_ORDER[b]);

/** 한 묶음 — 디스크의 분류 폴더 하나. 🔴 담는 경로는 **루트 기준 상대 경로**뿐이다. */
export type ServiceReportFolderGroupView = {
  reportKind: ServiceReportKind;
  /** 사람이 보는 분류 이름표 — 「검사 보고서」. 🔴 여기서 짓지 않는다. */
  label: string;
  /** 루트 기준 상대 경로 `연락서 폴더/분류 폴더`. 빈 글자면 줄의 [열기]를 그리지 않는다. */
  relativePath: string;
  entries: ContactFolderEntryView[];
  totalCount: number;
  truncated: boolean;
  /** 그 분류 폴더만 읽다 실패했을 때의 짧은 사유. 없으면 빈 글자다. */
  failedReason: string;
};

export type ServiceReportFolderSectionState =
  | { kind: "loading" }
  /** 🔴 이 상태에서는 구역을 아예 그리지 않는다. */
  | { kind: "disabled" }
  | { kind: "not-found" }
  /** 🔴 목록도 경로도 없다. */
  | { kind: "multiple" }
  | { kind: "failed"; reason: string }
  | {
      kind: "found";
      /** 연락서 폴더의 **디스크 이름**. 머리 오른쪽에 보이고 맨 아래 [폴더 열기]가 쓴다. */
      folderName: string;
      /** 🔴 **실제로 서 있는 분류 폴더만** 든다 — 없는 분류는 묶음이 서지 않는다. */
      groups: ServiceReportFolderGroupView[];
    };

/**
 * 맨 위 칸의 줄들 가운데 그 분류 폴더를 고른다. 🔴 **견줄 때만 다듬고, 돌려주는 것은 디스크의
 * 실제 이름**이다 — 다듬은 이름으로 경로를 이으면 없는 폴더가 된다(NFD · 공백 두 칸).
 * 폴더 줄만 본다(같은 이름의 **파일**이 자리를 막고 있을 수 있다).
 */
export function findServiceReportCategoryFolderName(
  entries: readonly ContactFolderEntryView[],
  categoryFolderName: string
): string | null {
  if (categoryFolderName === "") return null;
  const wanted = normalizeShareFolderNameForCompare(categoryFolderName);
  const found = entries.find(
    (entry) => entry.isDirectory && normalizeShareFolderNameForCompare(entry.name) === wanted
  );
  return found === undefined ? null : found.name;
}

/** 그 종류의 분류 폴더 이름(디스크에 서야 할 이름). 🔴 글자로 적지 않는다. */
export function serviceReportFolderCategoryName(reportKind: ServiceReportKind): string | null {
  return contactFolderCategoryFolderName(serviceReportContactFolderCategory(reportKind));
}

/** 묶음 머리에 적는 이름표. 🔴 분류 이름표 한 자리에서 온다(여기서 짓지 않는다). */
export function serviceReportFolderCategoryLabel(reportKind: ServiceReportKind): string {
  return attachmentCategoryLabels[serviceReportContactFolderCategory(reportKind)];
}

/**
 * 맨 위 칸을 읽은 답을 이 구역의 상태로 옮긴다 — `found` 는 여기서 다루지 않는다
 * (그때는 분류 폴더를 한 번 더 읽어야 한다).
 */
function withoutEntries(state: ContactFolderSectionState): ServiceReportFolderSectionState | null {
  switch (state.kind) {
    case "loading":
      return { kind: "loading" };
    case "disabled":
      return { kind: "disabled" };
    case "not-found":
      return { kind: "not-found" };
    case "multiple":
      // 🔴 이름도 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이지 않는다.
      return { kind: "multiple" };
    case "failed":
      return { kind: "failed", reason: state.reason };
    default:
      return null;
  }
}

/**
 * 통로를 **맨 위 칸 한 번 + 서 있는 분류 폴더마다 한 번** 부른다. **던지지 않는다** —
 * 무슨 일이 나도 상태 하나로 끝난다. 이 구역이 실패해도 같은 화면의 보고서 목록 · 갈림길은
 * 아무 영향을 받지 않는다.
 *
 * 🔴 **분류 폴더가 없으면 묶음을 세우지 않는다** — 없는 자리를 읽으러 가지 않는다.
 */
export async function loadServiceReportFolderEntries(
  repairCaseId: string,
  fetchImpl?: ContactFolderEntriesFetch
): Promise<ServiceReportFolderSectionState> {
  const top = await loadContactFolderEntries(repairCaseId, fetchImpl, "");
  const plain = withoutEntries(top);
  if (plain !== null) return plain;
  if (top.kind !== "found") return { kind: "failed", reason: UNEXPECTED_GROUP_REASON };

  const groups: ServiceReportFolderGroupView[] = [];
  for (const reportKind of SERVICE_REPORT_FOLDER_KINDS) {
    const categoryFolderName = serviceReportFolderCategoryName(reportKind);
    if (categoryFolderName === null) continue;
    // 🔴 맨 위 칸에 **폴더로 서 있을 때만** 읽으러 간다. 이름은 디스크의 것을 그대로 쓴다.
    const onDisk = findServiceReportCategoryFolderName(top.entries, categoryFolderName);
    if (onDisk === null) continue;

    const label = serviceReportFolderCategoryLabel(reportKind);
    // 🔴 도우미가 받을 수 없는 모양이면 빈 글자다 — 주소를 지어내지 않는다(앞 조각의 규칙).
    const relativePath = serviceReportContactFolderRelativePath(top.folderName, onDisk) ?? "";
    const inside = await loadContactFolderEntries(repairCaseId, fetchImpl, onDisk);
    if (inside.kind === "found") {
      groups.push({
        reportKind,
        label,
        relativePath,
        entries: inside.entries,
        totalCount: inside.totalCount,
        truncated: inside.truncated,
        failedReason: "",
      });
      continue;
    }
    groups.push({
      reportKind,
      label,
      relativePath,
      entries: [],
      totalCount: 0,
      truncated: false,
      failedReason: inside.kind === "failed" ? inside.reason : UNEXPECTED_GROUP_REASON,
    });
  }

  return { kind: "found", folderName: top.folderName, groups };
}

// ── 그리기 ───────────────────────────────────────────────────────────────

const ENTRY_NAME_CLASS = `min-w-0 ${SHARE_FOLDER_ENTRY_NAME_GROW_CLASS} break-all text-left text-sm text-zinc-700 dark:text-zinc-300`;
const MUTED_CLASS = "text-sm text-zinc-500 dark:text-zinc-400";
const WARNING_CLASS = "text-sm font-medium text-amber-700 dark:text-amber-400";
const NOTE_CLASS = "text-xs text-zinc-500 dark:text-zinc-400";

/**
 * 한 묶음 — 분류 폴더 하나. 🔴 표의 생김새는 **공유폴더를 보여 주는 창들이 함께 쓰는 한
 * 벌**이다(share-folder-entry-meta.ts). 여기서 열을 더하거나 폭을 다시 적지 않는다.
 */
function Group({ group }: { group: ServiceReportFolderGroupView }) {
  return (
    <section data-service-report-folder-group="" className="flex flex-col gap-1">
      {/* 🔴 **어느 보고서인가**는 이 한 줄이 가른다 — 줄마다 딱지를 붙이지 않는다(머리말). */}
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{group.label}</h3>

      {group.failedReason !== "" ? (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{SERVICE_REPORT_FOLDER_GROUP_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{group.failedReason}</p>
        </div>
      ) : group.entries.length === 0 ? (
        <p className={MUTED_CLASS}>{CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {group.entries.map((entry) => {
              const openable = group.relativePath !== "" && canOpenContactFolderEntry(entry);
              const meta = contactFolderEntryMeta(entry);
              return (
                <li
                  key={`${entry.isDirectory ? "d" : "f"}:${entry.name}`}
                  data-service-report-folder-entry-openable={openable ? "" : undefined}
                  className={SHARE_FOLDER_ENTRY_ROW_CLASS}
                >
                  <span className={ENTRY_NAME_CLASS}>
                    {entry.isDirectory ? "📁 " : ""}
                    {entry.name}
                  </span>
                  {/* 🔴 수정시각이 없어도 **칸은 그대로** 그린다 — 빼면 그 줄만 열이 어긋난다. */}
                  <span className={SHARE_FOLDER_ENTRY_META_MODIFIED_CLASS}>{meta.modifiedText}</span>
                  <span className={SHARE_FOLDER_ENTRY_META_SIZE_CLASS}>{meta.sizeText}</span>
                  {/* 🔴 동작 칸은 **비어도 그린다** — 칸까지 빼면 그 줄만 날짜·크기가 어긋난다. */}
                  <span className={SHARE_FOLDER_ENTRY_ACTIONS_CLASS}>
                    {openable && (
                      <ContactFolderEntryOpenButton folderName={group.relativePath} fileName={entry.name} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {group.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {truncatedText(group.entries.length, group.totalCount)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 상태 하나를 그린다. 🔴 `disabled` 면 **아무것도 그리지 않는다**(null).
 * 상태를 직접 넣어 그려 볼 수 있게 따로 두었다(통로 · 네트워크 없이 시험한다).
 */
export function ServiceReportFolderSectionView({ state }: { state: ServiceReportFolderSectionState }) {
  if (state.kind === "disabled") return null;

  const folderName = state.kind === "found" ? state.folderName : "";
  const groups = state.kind === "found" ? state.groups : [];

  return (
    <section
      aria-labelledby="service-report-folder-section-title"
      data-service-report-folder-section=""
      className="print:hidden flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="service-report-folder-section-title"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {SERVICE_REPORT_FOLDER_SECTION_TITLE}
        </h2>
        {folderName !== "" && (
          <span className="min-w-0 break-all text-xs text-zinc-500 dark:text-zinc-400">{folderName}</span>
        )}
      </div>

      {state.kind === "loading" && (
        <p aria-live="polite" className={MUTED_CLASS}>
          {CONTACT_FOLDER_SECTION_LOADING_TEXT}
        </p>
      )}

      {state.kind === "not-found" && <p className={MUTED_CLASS}>{CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT}</p>}

      {/* 🔴 목록을 내지 않는다 — 어느 폴더인지 모르는 채로 내용을 보이면 안 된다. */}
      {state.kind === "multiple" && <p className={WARNING_CLASS}>{CONTACT_FOLDER_SECTION_MULTIPLE_TEXT}</p>}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-0.5">
          <p className={WARNING_CLASS}>{CONTACT_FOLDER_SECTION_FAILED_TEXT}</p>
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        </div>
      )}

      {state.kind === "found" &&
        (groups.length === 0 ? (
          <p className={MUTED_CLASS}>{SERVICE_REPORT_FOLDER_SECTION_NO_REPORTS_TEXT}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <Group key={group.reportKind} group={group} />
            ))}
          </div>
        ))}

      {/* 🔴 무엇만 보이는지 — 찾았을 때만 적는다(못 찾은 화면에서는 할 말이 아니다). */}
      {state.kind === "found" && <p className={NOTE_CLASS}>{SERVICE_REPORT_FOLDER_SECTION_SCOPE_TEXT}</p>}

      {/*
        🔴 **연락서 폴더를 연다** — 분류 폴더 둘이 그 안에 나란히 있어 한 번에 둘 다 닿는다.
        찾았고 이름이 도우미가 받을 수 있는 모양일 때만 선다: `not-found` · `multiple`(어느
        폴더인지 모른다) · `disabled` · `failed` · 불러오는 중에는 **열 자리가 없다.**
        🔴 여는 장치는 연락서 쪽 자리 열기 단추 한 벌이다 — Windows 가 아니면 스스로 아무것도
        그리지 않고, 도우미 재설치 안내도 그 단추가 제 결과 줄로 함께 낸다. 여기서 끄지 않는다.
        🔴 **만들어 주는 단추가 아니다** — 이 구역은 읽고 여는 것뿐이다.
      */}
      {state.kind === "found" && serviceReportContactFolderRelativePath(folderName, null) !== null && (
        <ContactFolderPlaceOpenButton relativePath={folderName} />
      )}
    </section>
  );
}

/**
 * 화면이 뜬 **뒤에** 따로 통로를 부른다. 떠난 뒤에 답이 와도 상태를 건드리지 않는다.
 *
 * 받은 답은 **어느 수리 건의 것인지와 함께** 든다 — 그래야 다른 건으로 넘어갔을 때 지난
 * 폴더의 목록이 잠깐 비치지 않는다(효과 안에서 「불러오는 중」으로 되돌리면 그릴 때마다 한
 * 번 더 그리게 된다).
 *
 * 🔴 「다시 읽어라」를 받는 칸을 두지 않았다 — 보고서를 저장하면 그 화면에서 이 탭으로
 * 돌아오며 통째로 다시 그려진다. 쓰지 않을 칸을 미리 들이지 않는다.
 */
export default function ServiceReportFolderSection({ repairCaseId }: { repairCaseId: string }) {
  const [answer, setAnswer] = useState<{ repairCaseId: string; state: ServiceReportFolderSectionState } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void loadServiceReportFolderEntries(repairCaseId).then((state) => {
      if (!cancelled) setAnswer({ repairCaseId, state });
    });
    return () => {
      cancelled = true;
    };
  }, [repairCaseId]);

  const state: ServiceReportFolderSectionState =
    answer !== null && answer.repairCaseId === repairCaseId ? answer.state : { kind: "loading" };

  return <ServiceReportFolderSectionView state={state} />;
}
