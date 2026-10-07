"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NoticePopup from "@/components/common/NoticePopup";
import { showSavePopup } from "@/components/common/SavePopup";
import type { CustomerPortalItem } from "@/lib/db/queries/customer-portal";
import {
  findPortalFormById,
  manualColumnsOf,
  partsNameFromModelName,
  readManualValues,
  PORTAL_MANUAL_VALUE_MAX_LENGTH,
  type CustomerPortalForm,
  type PortalSystemField,
} from "@/lib/domain/customer-portal-forms";
import CustomerFormExportPanel from "./CustomerFormExportPanel";
import PassSlipOcrPanel, {
  PassSlipRowNotice,
  passSlipColumnsOf,
  portalRowKey,
} from "./PassSlipOcrPanel";
import {
  applyPassSlipSuggestions,
  type PassSlipRowOutcome,
} from "./pass-slip-suggestions";
import {
  WEEKLY_REPORT_KIND_FILTERS,
  weeklyReportKindFilterLabels,
  type WeeklyReportKindFilter,
} from "@/lib/domain/weekly-report-kind-filter";
import { WEEKLY_REPORT_KINDS } from "@/lib/domain/weekly-report";
import {
  saveCustomerStatusesAction,
  type CustomerStatusInputRow,
  type SaveCustomerStatusesResult,
} from "@/lib/server/actions/customer-portal";

/**
 * 고객 안내 현황 — 담당자가 실제로 일하는 화면.
 *
 * ■ 그리는 것은 **고객사 양식 표 하나**다 (2026-10-04)
 *
 * 고객사들은 저마다 자기 엑셀 현황표를 쓴다(사용자 요청 2026-09-30). 이 화면은
 * 그 표를 그대로 그리고, 담당자가 거기서 상태 · 비고 · 손으로 적는 칸을 채운다.
 *
 * 🔴 전에는 보기가 둘이었다 — **기본 9열 표**(고객이 전용 주소로 보던 모양)와
 * 고객사 양식. 전용 주소 기능을 화면에서 걷어내면서(사용자 요청 2026-10-04)
 * 기본 표와 보기 전환 단추를 함께 없앴다. 고를 것이 하나뿐이면 전환은 뜻을
 * 잃고, 나가지 않는 화면의 미리보기는 볼 사람이 없다.
 *
 * ■ 단추의 근거는 **양식**이다
 *
 * 전에는 주소가 발급된 고객사가 단추였다. 지금은 양식 하나가 단추 하나이고,
 * 🔴 **한 회사가 여러 이름으로 등록돼 있어도 한 표로 합쳐** 보인다
 * (queries/customer-portal.ts 의 listPortalItemsForForm).
 *
 * ■ 화면 표와 엑셀이 **같은 조회**를 쓴다
 *
 * 내보내기도 같은 `listPortalItemsForForm` 을 지난다. 각자 모으면 담당자가 본
 * 표와 저장된 파일이 갈리고, 그 어긋남은 아무도 눈치채지 못한 채 굳는다.
 *
 * ■ 저장과 내보내기를 나눈 이유
 *
 * 저장은 사내 기록이고 내보내기는 공유폴더에 파일을 만드는 조작이다. 저장할
 * 때마다 자동으로 나가게 하면, 여러 건을 고치는 동안 **반쯤 고친 표가 파일로
 * 계속 쌓인다.** 다 고치고 한 번 누르게 한다.
 *
 * ■ 🔴 **[저장]은 화면에 하나다** (사용자 지시 2026-10-07)
 *
 * 전에는 표의 마지막 열이 줄마다의 [저장] 단추였다. 「각 줄을 각각 저장하는 것이
 * 아니라 한번에 저장하는 거로」 바꾸면서 그 열을 없애고 표 아래 **붙어 다니는
 * 저장 줄**(PortalSaveBar)을 하나 두었다. 표가 길어도 닿아야 하므로 `sticky
 * bottom-0` 이다 — 밑으로 굴러 내려가 버리면 열 줄을 고친 사람이 단추를 찾아
 * 다시 올라와야 한다.
 *
 * 그러면서 세 가지가 함께 따라온다:
 *
 *  1. 🔴 **고친 줄만 보낸다**(collectEditedRows). 안 고친 줄까지 실어 보내면 내
 *     화면의 옛 값이 **그사이 남이 고친 값을 덮는다** — 아무 오류도 없이.
 *  2. 🔴 **한 줄이라도 충돌하면 아무것도 저장하지 않는다**(서버가 한 트랜잭션).
 *     반만 저장되면 사람은 「저장됐다」고 믿고 그대로 엑셀을 만들어 고객사에
 *     보낸다. 어느 줄이 어긋났는지는 **사람이 닫는 팝업**으로 알린다.
 *  3. 🔴 **저장하지 않고 떠나면 다 잃는다.** 줄마다 저장일 때는 한 줄 고치고
 *     누르면 끝이었지만, 이제는 여러 줄을 한참 고치다 다른 데로 가면 전부
 *     사라진다. 떠나기 전 경고(beforeunload)를 건다 — 이 저장소가 이미 세
 *     화면에서 쓰는 방식 그대로다(ProcedureTemplateEditorScreen ·
 *     CaseFlowchartEditorScreen · KyosanIntakeImportScreen). 🔴 그 셋과 똑같은
 *     한계도 함께 온다: **앱 안에서 메뉴를 눌러 옮기는 길은 막지 못한다.**
 *     그래서 저장 줄이 늘 떠 있으면서 「고친 줄 N개가 아직 저장되지 않았습니다」를
 *     글자로 들고 있는다.
 *
 * ■ `전체 / RFG / MB` 고르개 — 엑셀의 필터처럼 (2026-10-07 사용자 요청)
 *
 * 양식 단추 아래에 단추 셋이 더 선다(KindFilterTabs). 🔴 **낱말은 주간보고에서
 * 그대로 가져온다**(domain/weekly-report-kind-filter.ts 의
 * `WEEKLY_REPORT_KIND_FILTERS` · `weeklyReportKindFilterLabels`) — 두 화면이
 * 같은 축을 다른 말로 부르면 사람은 그 차이를 기능의 차이로 읽는다. 종류를 가르는
 * 규칙 자체도 그쪽 함수 하나다(queries/customer-portal.ts 의 foldPortalKind).
 *
 * 🔴 **주소가 아니라 화면 상태(useState)다 — 주간보고와 다른 점이고, 일부러다.**
 * 주간보고는 서버 컴포넌트라 고른 값을 서버가 알아야 하고, 그래서 `?kind=` 으로
 * 오간다. 이 화면은 반대다:
 *   - 바로 위의 **양식 고르개가 이미 useState** 다. 나란히 선 두 고르개 중 하나만
 *     주소를 바꾸면, 한쪽은 즉시 바뀌고 한쪽은 페이지가 다시 도는 화면이 된다.
 *   - 이 페이지는 `dynamic = "force-dynamic"` 이라 주소가 바뀌면 **양식마다의
 *     목록을 전부 다시 읽는다**(page.tsx). 이미 브라우저에 와 있는 줄을 고르는
 *     일에 그 왕복을 들일 까닭이 없다.
 *   - 사용자가 말한 모양이 「엑셀에서 필터를 먹이듯이」다 — 제자리에서 바로 접힌다.
 * 인쇄·링크로 건네기가 필요해지면 그때 주소로 옮긴다(그때는 양식 고르개도 함께).
 *
 * 🔴 **걸렀으면 걸렀다고 적는다**(KindFilterBanner). 줄 수만 조용히 줄면 사람은
 * 「건이 줄었다」로 읽는다 — 주간보고가 같은 까닭으로 같은 줄을 둔다.
 *
 * 🔴 **종류를 알 수 없는 줄은 어느 보기에서도 감추지 않는다**(아래
 * filterPortalItemsByKind). 감추면 「있던 줄이 없어졌다」가 되고, 그 줄이야말로
 * 사람이 손봐야 할 줄이다.
 *
 * 🔴 **고친 줄은 지금 안 보이더라도 저장한다.** 고르개는 보기일 뿐이고, 고친
 * 값을 보기에서 뺐다는 이유로 버리면 그 사람은 적은 것을 잃는다. 다만 자기가 보지
 * 않는 줄이 함께 저장되는 것을 모르면 안 되므로, **저장 줄이 그 수를 적는다.**
 */
export default function CustomerPortalScreen({
  formIds,
  itemsByForm,
  statusOptions,
  canEdit,
}: {
  /** 건이 들어갈 수 있는 양식들. 차례는 CUSTOMER_PORTAL_FORMS 그대로다. */
  formIds: string[];
  itemsByForm: Record<string, CustomerPortalItem[]>;
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
}) {
  /** 처음 고르는 것은 첫 양식. 양식이 하나도 없으면 null 이고 아무것도 안 그린다. */
  const [selectedFormId, setSelectedFormId] = useState<string | null>(
    formIds[0] ?? null
  );
  /**
   * 🔴 **처음은 `전체`다** — 고르개가 붙기 전과 똑같은 표가 먼저 보여야 한다.
   * 양식을 바꿔도 여기 고른 값은 그대로 간다: 「MB 만 본다」는 이 사람이 지금
   * 하는 일이지 그 양식의 성질이 아니다.
   */
  const [kindFilter, setKindFilter] = useState<WeeklyReportKindFilter>("ALL");
  /**
   * 사람이 손댄 줄들(줄 열쇠 → 고친 값). 🔴 **손댄 줄만 들어온다** — 표 전체를
   * 복사해 두면 「고쳤는가」를 물을 자리가 없어지고, 안 고친 줄까지 서버로 가서
   * 남이 고친 값을 덮는다.
   *
   * 🔴 양식을 바꾸거나 고르개를 움직여도 **지우지 않는다.** 보기를 바꾼 것이지
   * 적은 것을 버린 것이 아니다.
   */
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  /**
   * 저장이 막혔을 때 뜨는 팝업. 🔴 `SavePopup` 이 아니다 — 그것은 0.5초 뒤 저절로
   * 닫히는 **성공 전용**이고, 「어느 줄이 왜 막혔는가」는 읽는 데 그보다 오래
   * 걸린다(common/NoticePopup.tsx 머리말).
   */
  const [failure, setFailure] = useState<{ title: string; lines: string[] } | null>(null);
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  /**
   * 🔴 양식 식별자를 **양식 정의로 되짚는다.** 화면이 고른 글자를 그대로 믿고
   * 그리지 않는다 — 양식이 빠진 뒤에도 남아 있던 id 가 들어오면 null 이 되고,
   * 그때는 표 대신 아무것도 그리지 않는다.
   */
  const form = findPortalFormById(selectedFormId);
  /**
   * 그 양식의 줄 **전부**. 🔴 걸러도 이 값은 줄지 않는다 — 아래 안내 줄이
   * 「몇 줄 중 몇 줄인지」를 말하려면 거르기 전의 수가 있어야 하고, 엑셀
   * 내보내기가 실제로 내보내는 것도 이쪽이다(KindFilterBanner).
   */
  const allItems = form ? (itemsByForm[form.id] ?? []) : [];
  const items = filterPortalItemsByKind(allItems, kindFilter);
  /** 종류를 알 수 없는 줄. 어느 보기에서도 빠지지 않으므로 그 사실을 적어 둔다. */
  const unknownKindCount = allItems.filter((item) => item.kind === null).length;

  /**
   * [통문증에서 읽기]가 내놓은 결과(줄 열쇠 → 칸 키 → 색과 글자).
   *
   * 🔴 **저장된 값이 아니다.** 읽은 값을 칸에 채워 보여 줄 뿐이고, 저장은 사람이
   * 화면 아래 [저장]을 눌러야 일어난다. 그래서 여기 머물고 새로고침하면 사라진다.
   */
  const [passSlipResults, setPassSlipResults] = useState<Record<string, PassSlipRowOutcome>>({});
  /**
   * 통문증에서 읽어 채울 수 있는 칸들(통문번호 · PRV No. · Q코드)이 있는 양식에서만
   * 단추를 그린다. ICD · INVENIA 에는 그 칸이 없다.
   */
  const passSlipColumns = form ? passSlipColumnsOf(form) : [];

  /**
   * 🔴 **거르기 전의 줄 전부**를 본다. 고친 값이 지금 보기에서 빠져 있어도 저장
   * 대상이기 때문이다(파일 머리말).
   */
  const rowViews = form
    ? buildRowViews({ form, items: allItems, statusOptions, drafts, passSlipResults })
    : [];
  const viewByKey = new Map(rowViews.map((view) => [view.rowKey, view]));
  const editedRows = collectEditedRows(rowViews);
  const visibleKeys = new Set(items.map(portalRowKey));
  const visibleViews = rowViews.filter((view) => visibleKeys.has(view.rowKey));
  /** 고쳤는데 지금 보기에서 빠진 줄. 0 이 아니면 저장 줄이 그 수를 적는다. */
  const hiddenEditedCount = editedRows.filter((view) => !visibleKeys.has(view.rowKey)).length;

  /**
   * 🔴 **저장하지 않고 떠나려 할 때 한 번 묻는다.** 줄마다 저장이던 때는 없던
   * 위험이다(파일 머리말 3번). 이 저장소가 이미 쓰는 방식 그대로이고, 같은
   * 한계도 그대로다 — 브라우저를 닫거나 새로고침하는 길만 막고 **앱 안에서 메뉴를
   * 눌러 옮기는 길은 막지 못한다.**
   */
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (editedRows.length === 0) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editedRows.length]);

  /** 줄 하나의 칸을 고친다. 아직 손대지 않은 줄이면 처음 값에서 떠서 담는다. */
  function editRow(rowKey: string, patch: (draft: RowDraft) => RowDraft) {
    const view = viewByKey.get(rowKey);
    if (!view) return;
    setDrafts((previous) => ({
      ...previous,
      [rowKey]: patch(previous[rowKey] ?? view.baseline),
    }));
  }

  function save() {
    // 할 일이 없을 때는 단추가 눌리지 않지만, 통로가 열려 있으면 언젠가 불린다.
    if (editedRows.length === 0 || saving) return;
    const rows = toSavePayload(editedRows);
    startTransition(async () => {
      const result = await saveCustomerStatusesAction({ rows });
      if (!result.ok) {
        // 🔴 저절로 닫히지 않는 팝업이다 — 어느 줄이 왜 막혔는지를 읽어야 한다.
        setFailure({
          title: "저장하지 못했습니다",
          lines: buildFailureLines(result, editedRows),
        });
        return;
      }
      /*
       * 🔴 고친 값(drafts)을 여기서 지우지 않는다. 지우면 다시 읽어 온 줄이
       * 화면에 들어오기 전까지 **옛 값이 잠깐 보인다.** 다시 읽고 나면 처음 값이
       * 저장한 값과 같아져 「고친 줄」에서 저절로 빠진다(buildRowViews).
       */
      router.refresh();
      showSavePopup({ message: result.message, redirectTo: null });
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-bold text-zinc-900">고객 안내 현황</h1>
        <p className="mt-2 text-sm text-zinc-600">
          고객사별 현황표입니다. 여기서 정한 상태와 비고가 그 표에 그대로
          들어갑니다 —{" "}
          <strong className="text-zinc-900">실제 작업 진행과는 별개</strong>이고,
          출하 완료된 건은 목록에서 빠집니다.
        </p>
        </div>
      </header>

      {failure ? (
        <NoticePopup
          title={failure.title}
          lines={failure.lines}
          onClose={() => setFailure(null)}
        />
      ) : null}

      {/* ───── 양식 고르기 ─────
          🔴 단추 글자는 **양식 식별자**(ICD · INVENIA · JUSUNG)다. `form.label`
          은 「ICD 양식」이라 단추에 넣기에 길다(사용자가 보내 준 화면이 짧은
          쪽이다). 어느 양식인지는 바로 아래 안내 문장이 긴 이름으로 말한다. */}
      <section className="flex flex-wrap items-center gap-2">
        {formIds.length === 0 ? (
          <p className="text-sm text-zinc-500">
            양식이 정해진 고객사가 없습니다.
          </p>
        ) : (
          formIds.map((formId) => (
            <button
              key={formId}
              type="button"
              aria-pressed={formId === selectedFormId}
              onClick={() => setSelectedFormId(formId)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                formId === selectedFormId
                  ? "border-primary-900 bg-primary-900 text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-500"
              }`}
            >
              {formId}
            </button>
          ))
        )}
      </section>

      {form ? (
        <>
          {/* 어느 양식을 보고 있는지 글자로 분명히 말한다 — 양식마다 열이 달라
              글자로 말해 주지 않으면 "자료가 바뀐 것"으로 읽힌다. */}
          <p className="text-xs text-zinc-600">
            지금 <strong className="text-zinc-900">{form.label}</strong>으로 보고
            있습니다.
          </p>

          {/* ───── 종류 고르개 ─────
              양식 고르개 바로 아래에 둔다 — 두 고르개가 붙어 있어야 「이 표를
              어떻게 좁혀 보는가」가 한자리에서 읽힌다. 낱말과 방식의 근거는
              파일 헤더에 있다. */}
          <KindFilterTabs current={kindFilter} onSelect={setKindFilter} />

          {/* 🔴 걸러져 있을 때만 — 줄 수만 조용히 줄면 「건이 줄었다」로 읽힌다. */}
          {kindFilter !== "ALL" ? (
            <KindFilterBanner
              filter={kindFilter}
              totalCount={allItems.length}
              shownCount={items.length}
              unknownKindCount={unknownKindCount}
            />
          ) : null}

          {/* ───── 고객사 양식 엑셀 내보내기 ───── */}
          <CustomerFormExportPanel
            formId={form.id}
            formLabel={form.label}
            canSave={canEdit}
          />

          {/* ───── 통문증에서 읽기 ─────
              🔴 그 양식에 읽을 수 있는 칸이 있고 · 고칠 권한이 있을 때만 보인다.
              읽은 값을 **칸에 채워만** 두므로, 고칠 수 없는 사람에게 보이면 누를
              수는 있는데 아무 일도 일어나지 않는다.

              🔴 **걸러진 줄(items)을 그대로 받는다** — 종류를 걸러 놓으면 그
              읽기도 보이는 줄만 본다. 안 보이는 줄의 칸이 몰래 채워지면, 사람은
              자기가 보지 않은 줄에 값이 들어간 것을 모른 채 저장하게 된다. */}
          {passSlipColumns.length > 0 && canEdit ? (
            <PassSlipOcrPanel form={form} items={items} onResults={setPassSlipResults} />
          ) : null}

          {/* ───── 고객사 양식 표 ─────
              🔴 빈 표의 까닭을 가른다. 걸러서 비었는데 「진행 중인 건이 없습니다」
              라고 적으면 거짓말이 된다 — 건은 있고 지금 보기에서 빠졌을 뿐이라,
              사람은 자료가 없어진 줄 알고 엉뚱한 데를 찾는다. */}
          {items.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
              {allItems.length === 0
                ? "이 양식에 묶인 고객사에 진행 중인 건이 없습니다."
                : `진행 중인 ${allItems.length}건이 있지만 ${weeklyReportKindFilterLabels[kindFilter]} 에 드는 건은 없습니다 — 위에서 「${weeklyReportKindFilterLabels.ALL}」를 누르면 모두 보입니다.`}
            </p>
          ) : (
            <CustomerFormTable form={form} views={visibleViews} statusOptions={statusOptions} canEdit={canEdit} onEdit={editRow} />
          )}

          {/* ───── 🔴 한 번에 저장 ─────
              표 아래에 붙어 다닌다. 표가 비어 있어도 그린다 — 고르개로 걸러 지금
              표가 비었을 뿐 **다른 보기에 고친 줄이 남아 있을 수 있고**, 그때
              저장 단추가 함께 사라지면 적은 것을 저장할 길이 없어진다. */}
          {canEdit ? (
            <PortalSaveBar
              editedCount={editedRows.length}
              hiddenEditedCount={hiddenEditedCount}
              saving={saving}
              onSave={save}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 고친 줄 모으기 — 화면이 서버로 무엇을 보내는가
 * ══════════════════════════════════════════════════════════════════════════ */

/** 줄 하나에서 사람이 고칠 수 있는 것 전부. 처음 값도 고친 값도 이 꼴이다. */
export type RowDraft = {
  /** 고른 상태의 id. 「정하지 않음」은 빈 글자다. */
  optionId: string;
  note: string;
  /** 손으로 적는 칸들. 🔴 **빈 칸은 키가 없다**(readManualValues 와 같은 규약). */
  values: Record<string, string>;
};

/** 표의 한 줄을 그리는 데 필요한 것 전부. 처음 값과 지금 값을 함께 들고 있다. */
export type PortalRowView = {
  item: CustomerPortalItem;
  rowKey: string;
  /** 🔴 서버에서 온 값. 「고쳤는가」를 재는 자이고, 아직 손대지 않은 줄의 지금 값이다. */
  baseline: RowDraft;
  optionId: string;
  note: string;
  /** 통문증이 읽어 얹은 값까지 포함한 지금 값. */
  values: Record<string, string>;
  /** 통문증에서 읽은 이 줄의 결과(칸 밑에 붙는 알림). 안 읽었으면 null. */
  passSlipOutcome: PassSlipRowOutcome | null;
  /** 접수 전 의뢰 — 값을 붙일 자리가 없어 칸을 그리지 않는다. */
  pending: boolean;
  dirty: boolean;
};

/**
 * 서버에서 온 값 그대로의 줄. 🔴 손으로 적은 값은 **지금 양식으로 걸러** 담는다 —
 * 양식에서 열이 빠진 뒤에 남아 있던 옛 값이 그대로 들어오면, 어느 칸에도 안 보이는
 * 값을 다음 저장이 그대로 다시 써 넣는다.
 */
function baselineRowDraft(
  form: CustomerPortalForm,
  item: CustomerPortalItem,
  statusOptions: { id: string; label: string }[]
): RowDraft {
  const currentOption = statusOptions.find((option) => option.label === item.statusLabel);
  return {
    optionId: currentOption?.id ?? "",
    note: item.statusNote ?? "",
    values: readManualValues(form, item.formValues),
  };
}

/**
 * 줄마다 「처음 값 · 지금 값 · 고쳤는가」를 한 번에 센다.
 *
 * 🔴 **통문증이 읽은 값은 상태로 옮겨 담지 않고 여기서 얹는다.** 읽은 값은 화면에
 * 잠시 떠 있는 **제안**이다. 상태에 넣는 순간 「사람이 적은 값」과 구별할 수
 * 없어진다. 얹히면 그 줄이 고친 줄로 잡혀 아래 저장 줄의 수가 하나 는다.
 *
 * 🔴 **아직 손대지 않은 칸에만 얹는다**(applyPassSlipSuggestions). 「비었는가」가
 * 아니라 「그 키가 있는가」로 가리는 까닭 둘 — 저장된 값이 있으면 키가 있으므로
 * 덮지 않고, 사람이 적었다가 **지운** 칸도 키가 남으므로 다시 채워 넣지 않는다
 * (지운 값이 되살아나면 지운 사람은 영문을 모른다).
 *
 * 🔴 **서류의 S/N 이 이 건과 다른 줄은 애초에 값이 오지 않는다**(읽기 쪽이
 * 걸러 낸다 — pass-slip-suggestions.ts). 그래서 여기서 막을 것이 없다.
 */
function buildRowViews({
  form,
  items,
  statusOptions,
  drafts,
  passSlipResults,
}: {
  form: CustomerPortalForm;
  items: CustomerPortalItem[];
  statusOptions: { id: string; label: string }[];
  drafts: Record<string, RowDraft>;
  passSlipResults: Record<string, PassSlipRowOutcome>;
}): PortalRowView[] {
  return items.map((item) => {
    const rowKey = portalRowKey(item);
    const baseline = baselineRowDraft(form, item, statusOptions);
    const draft = drafts[rowKey] ?? baseline;
    const passSlipOutcome = passSlipResults[rowKey] ?? null;
    const values = applyPassSlipSuggestions(draft.values, passSlipOutcome);
    // 접수 전 의뢰는 아직 접수가 아니라 값을 붙일 자리가 없다. 🔴 2026-10-04 부터
    // 조회가 그 줄을 내지 않지만, 갈래 자체는 서버에 남아 있어 막음을 그대로 둔다.
    const pending = item.sourceKind === "REQUEST";
    /*
     * 🔴 **앞뒤 공백은 빼고 견준다.** 서버가 저장할 때 공백을 떼므로(액션의 note
     * trim · domain 의 sanitizeManualValues), 그대로 견주면 「P-1 」을 적은 줄이
     * 저장한 뒤에도 영영 「고친 줄」로 남는다 — 저장 줄의 수가 0 이 되지 않고
     * 떠날 때마다 경고가 뜬다. 줄마다 저장이던 때는 그 줄의 [저장] 단추가 하나
     * 더 보일 뿐이었지만, 지금은 화면 전체의 셈이 틀어진다.
     */
    const dirty =
      !pending &&
      (draft.optionId !== baseline.optionId ||
        draft.note.trim() !== baseline.note.trim() ||
        manualValuesDiffer(form, baseline.values, values));
    return {
      item,
      rowKey,
      baseline,
      optionId: draft.optionId,
      note: draft.note,
      values,
      passSlipOutcome,
      pending,
      dirty,
    };
  });
}

/** 🔴 서버로 갈 줄은 **고친 줄뿐이다.** 까닭은 파일 머리말 1번. */
function collectEditedRows(views: PortalRowView[]): PortalRowView[] {
  return views.filter((view) => view.dirty);
}

/**
 * 서버가 받는 꼴로 옮긴다.
 *
 * 🔴 **줄마다 자기 `expectedVersion` 을 그대로 싣는다.** 한 번에 저장한다고 해서
 * 낙관적 잠금이 느슨해지지 않는다 — 줄 하나하나가 「내가 읽은 그 판본인가」를
 * 묻고, 하나라도 아니면 서버가 통째로 되돌린다.
 */
function toSavePayload(editedRows: PortalRowView[]): CustomerStatusInputRow[] {
  return editedRows.map(({ item, optionId, note, values }) => ({
    repairCaseId: item.sourceId,
    statusOptionId: optionId || null,
    note: note || null,
    // 🔴 상태·비고와 **한 번에** 보낸다. 나눠 보내면 저장이 둘이 되고, 첫 저장이
    //    올린 version 때문에 둘째가 충돌로 막힌다.
    formValues: values,
    expectedVersion: item.statusVersion,
  }));
}

/** 팝업에 몇 줄까지 이름을 적는가. 넘치면 「그 밖에 N줄」로 접는다. */
const FAILURE_ROW_LINE_LIMIT = 10;

/** 사람이 표에서 그 줄을 찾을 수 있는 이름. 접수번호가 없으면 모델명으로 짚는다. */
function describeRow(item: CustomerPortalItem): string {
  const parts = [item.intakeNumber, item.modelName].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return parts.length > 0 ? parts.join(" · ") : "접수번호를 알 수 없는 줄";
}

/**
 * 🔴 **어느 줄이 왜 막혔는지**를 글자로 만든다. 「저장하지 못했습니다」만 띄우면
 * 사람은 무엇을 어떻게 해야 할지 모른 채 같은 단추를 다시 누른다.
 *
 * 마지막 줄의 경고가 중요하다 — 충돌을 푸는 길은 **새로고침**인데, 새로고침하면
 * 지금 화면에 적어 둔 값이 함께 사라진다. 그 사실을 모르고 누르면 한 번 더 잃는다.
 */
function buildFailureLines(
  result: Extract<SaveCustomerStatusesResult, { ok: false }>,
  editedRows: PortalRowView[]
): string[] {
  const lines = [result.message];
  const itemById = new Map(editedRows.map((view) => [view.item.sourceId, view.item]));
  result.failedRows.slice(0, FAILURE_ROW_LINE_LIMIT).forEach((failed, index) => {
    const item = itemById.get(failed.repairCaseId);
    lines.push(`${index + 1}. ${item ? describeRow(item) : failed.repairCaseId} — ${failed.message}`);
  });
  if (result.failedRows.length > FAILURE_ROW_LINE_LIMIT) {
    lines.push(`그 밖에 ${result.failedRows.length - FAILURE_ROW_LINE_LIMIT}줄이 더 있습니다.`);
  }
  if (result.failedRows.length > 0) {
    lines.push(
      "화면을 새로고침하면 그 줄의 최신 값을 다시 읽습니다. 🔴 다만 새로고침하면 지금 적어 둔 값도 함께 사라지니, 먼저 옮겨 적어 두세요."
    );
  }
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 🔴 저장 줄 — 화면에 하나뿐인 [저장]
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 표 아래에 **붙어 다니는** 저장 줄.
 *
 * 🔴 `sticky bottom-0` 인 까닭: 표가 스무 줄을 넘으면 아래로 굴러 내려가 버리고,
 * 열 줄을 고친 사람이 단추를 찾아 다시 내려와야 한다. 붙어 있으면 어디서 고치든
 * 손이 닿는 자리에 있다. `-mx-6` 는 바깥 상자의 `p-6` 을 되돌려 화면 끝까지
 * 깔리게 한다 — 가운데만 뜬 띠는 「표의 일부」로 읽힌다.
 *
 * 🔴 **고친 줄이 없으면 눌리지 않는다**(disabled). 눌러도 아무 일이 없는 단추는
 * 「저장이 안 된다」로 읽히므로, 그 자리에 **왜 할 일이 없는지**를 글자로 적는다.
 *
 * 🔴 **지금 안 보이는 줄이 함께 저장되는 것을 미리 적는다.** 고르개로 걸러 놓고
 * 다른 보기에서 고친 값이 있으면, 누르기 **전에** 그 수가 보여야 한다 — 누른
 * 뒤에 알려 주면 이미 저장된 다음이다.
 */
function PortalSaveBar({
  editedCount,
  hiddenEditedCount,
  saving,
  onSave,
}: {
  editedCount: number;
  hiddenEditedCount: number;
  saving: boolean;
  onSave: () => void;
}) {
  const nothingToSave = editedCount === 0;
  return (
    <div className="sticky bottom-0 z-20 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-white px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <p className="text-xs leading-relaxed text-zinc-600">
        {nothingToSave ? (
          "고친 줄이 없습니다 — 표에서 상태 · 비고 · 손으로 적는 칸을 고치면 여기서 한 번에 저장합니다."
        ) : (
          <>
            <strong className="text-zinc-900">
              고친 줄 <span className="tabular-nums">{editedCount}</span>개
            </strong>
            가 아직 저장되지 않았습니다.
            {hiddenEditedCount > 0 ? (
              <span className="ml-1 font-semibold text-amber-700">
                지금 보이지 않는 줄 <span className="tabular-nums">{hiddenEditedCount}</span>개도
                함께 저장됩니다.
              </span>
            ) : null}
          </>
        )}
      </p>
      <button
        type="button"
        disabled={nothingToSave || saving}
        onClick={onSave}
        className="rounded-lg bg-primary-900 px-5 py-2 text-sm font-semibold whitespace-nowrap text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 종류 고르개 — `전체 / RFG / MB`
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 고른 종류만 남긴다. `전체`면 받은 배열을 **그대로** 돌려준다(베끼지 않는다).
 *
 * 🔴 **종류를 알 수 없는 줄(`kind === null`)은 어느 보기에서도 빠지지 않는다.**
 * 작업 종류를 RFG 에도 MB 에도 접을 수 없는 줄이 그것인데(까닭은
 * queries/customer-portal.ts 의 foldPortalKind), 거르면서 함께 사라지면 사람은
 * 「있던 줄이 없어졌다」로 읽는다. 오히려 손이 필요한 줄이라 늘 보이는 편이 맞고,
 * 몇 줄인지는 아래 안내 줄이 말한다(KindFilterBanner).
 *
 * 그래서 `RFG` 와 `MB` 를 더해도 `전체` 보다 줄이 많을 수 있다 — 종류를 알 수
 * 없는 줄이 양쪽에 다 들어가기 때문이다. 그 사실도 안내 줄이 적는다.
 */
function filterPortalItemsByKind(
  items: CustomerPortalItem[],
  filter: WeeklyReportKindFilter
): CustomerPortalItem[] {
  if (filter === "ALL") return items;
  return items.filter((item) => item.kind === filter || item.kind === null);
}

/** 눌린 단추 / 안 눌린 단추. 바로 위 양식 고르개와 같은 색이고 크기만 작다. */
const KIND_TAB_BASE =
  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors";
const KIND_TAB_CURRENT = "border-primary-900 bg-primary-900 text-white";
const KIND_TAB_OTHER = "border-zinc-300 text-zinc-700 hover:border-zinc-500";

/**
 * 단추 셋. 🔴 **글자도 값도 주간보고에서 그대로 가져온다**
 * (`WEEKLY_REPORT_KIND_FILTERS` · `weeklyReportKindFilterLabels`) — 여기서 다시
 * 적으면 두 화면의 말이 갈린다(파일 헤더).
 *
 * 🔴 링크가 아니라 **단추**다. 주간보고는 서버 컴포넌트라 주소로 오가지만 이
 * 화면은 줄이 이미 브라우저에 와 있고, 바로 위 양식 고르개도 단추다 — 까닭은
 * 파일 헤더에 적어 두었다.
 */
function KindFilterTabs({
  current,
  onSelect,
}: {
  current: WeeklyReportKindFilter;
  onSelect: (next: WeeklyReportKindFilter) => void;
}) {
  return (
    <nav aria-label="종류로 거르기" className="flex flex-wrap items-center gap-2">
      {WEEKLY_REPORT_KIND_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          // 지금 보고 있는 것을 색만으로 말하지 않는다 — 양식 고르개와 같은 방식이다.
          aria-pressed={filter === current}
          onClick={() => onSelect(filter)}
          className={`${KIND_TAB_BASE} ${filter === current ? KIND_TAB_CURRENT : KIND_TAB_OTHER}`}
        >
          {weeklyReportKindFilterLabels[filter]}
        </button>
      ))}
    </nav>
  );
}

/**
 * 🔴 걸러져 있을 때 표 위에 붙는 한 줄 — **감춘 것을 말하지 않고 감추지 않는다.**
 * 주간보고의 같은 이름 조각과 같은 판단이고, 거기에 이 화면에만 있는 두 가지를
 * 더 적는다.
 *
 *  1. **엑셀은 이 고르개를 따르지 않는다.** 내보내기는 서버가 양식 식별자
 *     하나로 같은 조회를 다시 도는 길이라(CustomerFormExportPanel ·
 *     services/customer-portal-export.ts), 화면에서 RFG 만 보고 있어도 저장되는
 *     파일에는 그 양식의 건이 전부 들어간다. 적어 두지 않으면 사람은 「보이는
 *     대로 저장된다」고 믿고 고객사에 보낸다. (고르개가 엑셀까지 가려야 하는지는
 *     이 조각에서 정하지 않았다 — 정할 때까지는 사실을 적어 둔다.)
 *  2. **종류를 알 수 없는 줄은 빠지지 않는다**(filterPortalItemsByKind). 0줄이면
 *     이 문장을 아예 내지 않는다 — 늘 나는 줄은 읽히지 않는다.
 *
 * 색은 빨강이 아니다. 고장이 아니라 **사람이 스스로 고른 상태**다.
 */
function KindFilterBanner({
  filter,
  totalCount,
  shownCount,
  unknownKindCount,
}: {
  /** 🔴 `ALL` 로는 불리지 않는다 — 부르는 쪽이 걸러져 있을 때만 그린다. */
  filter: WeeklyReportKindFilter;
  /** 거르기 **전**의 줄 수. 엑셀에 실제로 들어가는 수이기도 하다. */
  totalCount: number;
  shownCount: number;
  unknownKindCount: number;
}) {
  const hiddenKinds = WEEKLY_REPORT_KINDS.filter((kind) => kind !== filter);
  return (
    <p
      role="status"
      className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-900"
    >
      <strong>{weeklyReportKindFilterLabels[filter]}</strong>만 보고 있습니다 — 이 양식의 진행 중인{" "}
      <strong className="tabular-nums">{totalCount}</strong>건 가운데{" "}
      <strong className="tabular-nums">{shownCount}</strong>건이고, {hiddenKinds.join(" · ")}{" "}
      <strong className="tabular-nums">{totalCount - shownCount}</strong>건은 이 표에서 빠져 있습니다.
      {unknownKindCount > 0 ? (
        <>
          {" "}
          종류를 알 수 없는 <strong className="tabular-nums">{unknownKindCount}</strong>건은 어느
          보기에서도 빠지지 않고 그대로 보입니다.
        </>
      ) : null}{" "}
      <strong>엑셀 미리보기 · 공유폴더에 저장은 이 고르개를 따르지 않습니다</strong> — 저장되는
      파일에는 {totalCount}건이 모두 들어갑니다.
    </p>
  );
}

/**
 * 시스템이 아는 값 한 칸. 🔴 **여기에는 통문증 알림을 붙이지 않는다** — 붙였더니
 * 그 열이 넓어지고 밀린 폭을 마지막 열이 뒤집어써 글자가 세로로 쪼개졌다
 * (사용자 지적 2026-10-01). 통문증 알림은 **값이 들어가는 입력 칸 밑**에만 붙는다.
 */
function Cell({ value }: { value: string | null }) {
  return (
    <td className="px-3 py-2 whitespace-nowrap text-zinc-700">
      {value ? value : <span className="text-zinc-400">-</span>}
    </td>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 고객사 양식 표
 * ══════════════════════════════════════════════════════════════════════════
 * 열 구성은 여기 적지 않는다 — domain/customer-portal-forms.ts 가 갖는다. 이
 * 표가 하는 일은 그 목록을 차례대로 그리는 것뿐이라, 열이 늘거나 이름이 바뀔 때
 * 고칠 곳이 한 군데다.
 *
 * 🔴 **마지막의 [저장] 열이 없어졌다**(사용자 지시 2026-10-07). 저장은 표 아래
 * 저장 줄 하나가 한다(PortalSaveBar). 그래서 이 표의 열은 **엑셀 양식의 열과
 * 정확히 같다** — 전에는 엑셀에 없는 칸이 하나 더 서 있었다.
 *
 * ⚠️ 가로 스크롤은 **표를 감싼 상자가 소유한다**(아래 overflow 상자). 표 자체에
 * 넘침을 맡기면 넘친 폭이 페이지로 퍼져 화면 전체가 옆으로 밀린다 — 이 저장소에
 * 그 고장이 있었다. 열이 열셋인 양식이 있어 최소 폭을 넉넉히 준다.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 빈 칸에 치는 **빗금**. 클래스가 아니라 인라인 스타일인 까닭 둘 —
 * 이 한 칸에만 쓰는 모양이라 유틸리티 클래스로 만들 값이 아니고, 대각선
 * 그라디언트를 클래스 이름으로 적으면 글자가 길어 무엇을 그리는지 읽히지 않는다.
 */
const EMPTY_SLASH_STYLE = {
  backgroundImage:
    "linear-gradient(to top right, transparent calc(50% - 0.5px), #a1a1aa calc(50% - 0.5px), #a1a1aa calc(50% + 0.5px), transparent calc(50% + 0.5px))",
} as const;

function CustomerFormTable({
  form,
  views,
  statusOptions,
  canEdit,
  onEdit,
}: {
  form: CustomerPortalForm;
  /** 🔴 **지금 보이는 줄만**. 거르기는 부르는 쪽이 이미 끝냈다. */
  views: PortalRowView[];
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onEdit: (rowKey: string, patch: (draft: RowDraft) => RowDraft) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[80rem] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-zinc-800 text-left text-xs text-zinc-500">
            {form.columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {views.map((view, index) => (
            <FormItemRow
              key={view.rowKey}
              form={form}
              view={view}
              rowNumber={index + 1}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onEdit={onEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 시스템이 아는 값 하나를 꺼낸다. 🔴 여기 빠진 이름이 있으면 tsc 가 막는다. */
function systemValueOf(item: CustomerPortalItem, field: PortalSystemField): string | null {
  switch (field) {
    case "intakeNumber":
      return item.intakeNumber;
    case "endUserName":
      return item.endUserName;
    case "modelName":
      return item.modelName;
    case "lotNumber":
      return item.lotNumber;
    case "serialNumber":
      return item.serialNumber;
    case "receivedAt":
      return item.receivedAt;
    case "quoteNumber":
      return item.quoteNumber;
    case "quoteIssuedDate":
      return item.quoteIssuedDate;
    case "orderIssuedDate":
      return item.orderIssuedDate;
    case "customerRequestedDueDate":
      return item.customerRequestedDueDate;
  }
}

/**
 * 표의 한 줄.
 *
 * 🔴 **자기 상태를 갖지 않는다.** 고친 값은 화면(CustomerPortalScreen)이 한곳에
 * 모아 두고, 이 줄은 받은 것을 그리고 고친 것을 위로 올린다. 줄마다 상태를 들고
 * 있으면 화면 하나짜리 [저장]이 그 값을 모을 길이 없다 — 「한 번에 저장」으로
 * 바꾸면서 가장 크게 달라진 곳이 여기다.
 *
 * 🔴 통문증이 읽어 얹은 값도 이미 `view.values` 에 들어 있다(buildRowViews).
 */
function FormItemRow({
  form,
  view,
  rowNumber,
  statusOptions,
  canEdit,
  onEdit,
}: {
  form: CustomerPortalForm;
  view: PortalRowView;
  rowNumber: number;
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onEdit: (rowKey: string, patch: (draft: RowDraft) => RowDraft) => void;
}) {
  const { item, rowKey, pending, values, passSlipOutcome } = view;

  return (
    <tr
      className={`border-b border-zinc-200 align-top ${
        view.dirty ? "bg-amber-50" : ""
      }`}
    >
      {form.columns.map((column) => {
        switch (column.kind) {
          case "ROW_NUMBER":
            return (
              <td
                key={column.key}
                className="px-3 py-2 whitespace-nowrap text-zinc-500 tabular-nums"
              >
                {rowNumber}
              </td>
            );
          case "SYSTEM":
            return <Cell key={column.key} value={systemValueOf(item, column.field)} />;
          case "DERIVED":
            // 지금 이 갈래의 칸은 ICD 의 「Parts 명」 하나다. 모르는 모델명은 빈칸.
            return <Cell key={column.key} value={partsNameFromModelName(item.modelName)} />;
          case "STATUS":
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <select
                    value={view.optionId}
                    disabled={!canEdit}
                    aria-label={column.label}
                    onChange={(e) => {
                      const next = e.target.value;
                      onEdit(rowKey, (draft) => ({ ...draft, optionId: next }));
                    }}
                    className="h-9 w-32 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                  >
                    <option value="">- 정하지 않음</option>
                    {statusOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            );
          case "NOTE":
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <input
                    value={view.note}
                    disabled={!canEdit}
                    maxLength={1000}
                    aria-label={column.label}
                    onChange={(e) => {
                      const next = e.target.value;
                      onEdit(rowKey, (draft) => ({ ...draft, note: next }));
                    }}
                    className="h-9 w-48 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                  />
                )}
              </td>
            );
          case "MANUAL": {
            const value = values[column.key] ?? "";
            const slashWhenEmpty = column.emptyMark === "SLASH" && !value;
            // 통문증 알림은 그 값이 들어가는 칸 **바로 밑**에 붙인다. 표 밖에 모아
            // 두면 열이 열셋인 표에서 어느 줄의 말인지 알 수 없다.
            const notice = passSlipOutcome?.[column.key] ?? null;
            return (
              <td key={column.key} className="px-3 py-2">
                {pending ? (
                  <span className="text-zinc-400">-</span>
                ) : (
                  <>
                    <input
                      type={column.valueKind === "date" ? "date" : "text"}
                      value={value}
                      disabled={!canEdit}
                      maxLength={PORTAL_MANUAL_VALUE_MAX_LENGTH}
                      aria-label={column.label}
                      style={slashWhenEmpty ? EMPTY_SLASH_STYLE : undefined}
                      onChange={(e) => {
                        const next = e.target.value;
                        onEdit(rowKey, (draft) => ({
                          ...draft,
                          values: { ...draft.values, [column.key]: next },
                        }));
                      }}
                      className="h-9 w-32 rounded border border-zinc-300 px-2 text-sm disabled:bg-zinc-100"
                    />
                    {notice ? <PassSlipRowNotice outcome={notice} /> : null}
                  </>
                )}
              </td>
            );
          }
        }
      })}
    </tr>
  );
}

/**
 * 손으로 적은 값이 처음과 달라졌는가. 🔴 **그 양식의 칸만** 견준다 — 양식에
 * 없는 키가 양쪽에 남아 있어도 "고쳤다"가 되지 않게.
 *
 * 🔴 **앞뒤 공백은 빼고 견준다** — 저장하는 쪽이 공백을 떼므로(domain 의
 * sanitizeManualValues), 그대로 견주면 저장한 뒤에도 영영 「고친 줄」로 남는다.
 */
function manualValuesDiffer(
  form: CustomerPortalForm,
  before: Record<string, string>,
  after: Record<string, string>
): boolean {
  return manualColumnsOf(form).some(
    (column) => (before[column.key] ?? "").trim() !== (after[column.key] ?? "").trim()
  );
}
