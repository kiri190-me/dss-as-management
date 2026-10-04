"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { setCustomerStatusAction } from "@/lib/server/actions/customer-portal";

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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  /**
   * 🔴 양식 식별자를 **양식 정의로 되짚는다.** 화면이 고른 글자를 그대로 믿고
   * 그리지 않는다 — 양식이 빠진 뒤에도 남아 있던 id 가 들어오면 null 이 되고,
   * 그때는 표 대신 아무것도 그리지 않는다.
   */
  const form = findPortalFormById(selectedFormId);
  const items = form ? (itemsByForm[form.id] ?? []) : [];

  /**
   * [통문증에서 읽기]가 내놓은 결과(줄 열쇠 → 칸 키 → 색과 글자).
   *
   * 🔴 **저장된 값이 아니다.** 읽은 값을 칸에 채워 보여 줄 뿐이고, 저장은 예전
   * 그대로 줄마다 [저장] 단추가 한다. 그래서 여기 머물고 새로고침하면 사라진다.
   */
  const [passSlipResults, setPassSlipResults] = useState<Record<string, PassSlipRowOutcome>>({});
  /**
   * 통문증에서 읽어 채울 수 있는 칸들(통문번호 · PRV No. · Q코드)이 있는 양식에서만
   * 단추를 그린다. ICD · INVENIA 에는 그 칸이 없다.
   */
  const passSlipColumns = form ? passSlipColumnsOf(form) : [];

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ ok: false, text: result.message });
        return;
      }
      // 성공은 저장 팝업으로 알린다(common/SavePopup.tsx) — 이 화면이 곧 목록이라 머문다.
      setMessage(null);
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

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
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

          {/* ───── 고객사 양식 엑셀 내보내기 ───── */}
          <CustomerFormExportPanel
            formId={form.id}
            formLabel={form.label}
            canSave={canEdit}
          />

          {/* ───── 통문증에서 읽기 ─────
              🔴 그 양식에 읽을 수 있는 칸이 있고 · 고칠 권한이 있을 때만 보인다.
              읽은 값을 **칸에 채워만** 두므로, 고칠 수 없는 사람에게 보이면 누를
              수는 있는데 아무 일도 일어나지 않는다. */}
          {passSlipColumns.length > 0 && canEdit ? (
            <PassSlipOcrPanel form={form} items={items} onResults={setPassSlipResults} />
          ) : null}

          {/* ───── 고객사 양식 표 ───── */}
          {items.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
              이 양식에 묶인 고객사에 진행 중인 건이 없습니다.
            </p>
          ) : (
            <CustomerFormTable
              form={form}
              items={items}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onSave={run}
              passSlipResults={passSlipResults}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * 시스템이 아는 값 한 칸. 🔴 **여기에는 통문증 알림을 붙이지 않는다** — 붙였더니
 * 그 열이 넓어지고 밀린 폭을 마지막 열([저장])이 뒤집어써 글자가 세로로 쪼개졌다
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
  items,
  statusOptions,
  canEdit,
  onSave,
  passSlipResults,
}: {
  form: CustomerPortalForm;
  items: CustomerPortalItem[];
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onSave: (action: () => Promise<{ ok: boolean; message: string }>) => void;
  /** 통문증에서 읽은 줄별 결과. 아무것도 안 읽었으면 빈 객체다. */
  passSlipResults: Record<string, PassSlipRowOutcome>;
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
            {/* 엑셀에는 없는 칸이다. 적은 것을 저장하는 단추 자리 — 열이 열 개를
                넘어 비고 옆에 끼워 넣으면 어느 줄의 단추인지 알기 어렵다.
                🔴 **줄어들지 않는 열이다.** 다른 열이 넓어질 때 표가 희생시키는 것은
                언제나 마지막 열이라, 여기가 눌리면 「저장」 두 글자가 세로로 쪼개진다
                (사용자 지적 2026-10-01). 폭을 못 박고 줄바꿈을 막는다. */}
            {canEdit ? (
              <th scope="col" className="w-20 px-3 py-2 whitespace-nowrap">
                저장
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <FormItemRow
              key={`${item.sourceKind}:${item.sourceId}`}
              form={form}
              item={item}
              rowNumber={index + 1}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onSave={onSave}
              passSlipOutcome={passSlipResults[portalRowKey(item)] ?? null}
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

function FormItemRow({
  form,
  item,
  rowNumber,
  statusOptions,
  canEdit,
  onSave,
  passSlipOutcome,
}: {
  form: CustomerPortalForm;
  item: CustomerPortalItem;
  rowNumber: number;
  statusOptions: { id: string; label: string }[];
  canEdit: boolean;
  onSave: (action: () => Promise<{ ok: boolean; message: string }>) => void;
  /** 통문증에서 읽은 이 줄의 결과. 안 읽었으면 null. */
  passSlipOutcome: PassSlipRowOutcome | null;
}) {
  const currentOption = statusOptions.find((o) => o.label === item.statusLabel);
  const [optionId, setOptionId] = useState(currentOption?.id ?? "");
  const [note, setNote] = useState(item.statusNote ?? "");
  /**
   * 손으로 적은 값들. 🔴 저장된 것을 **지금 양식으로 걸러** 담는다 — 양식에서
   * 열이 빠진 뒤에 남아 있던 옛 값이 그대로 들어오면, 어느 칸에도 안 보이는
   * 값을 다음 저장이 그대로 다시 써 넣는다.
   */
  const initialValues = readManualValues(form, item.formValues);
  const [typedValues, setTypedValues] = useState<Record<string, string>>(initialValues);

  /**
   * 통문증에서 읽은 값들을 칸에 **얹는다**(저장하지 않는다 · 상태로 옮겨 담지도 않는다).
   *
   * 🔴 **아직 손대지 않은 칸에만 얹는다.** 「비었는가」가 아니라 「그 키가 있는가」로
   * 가리는 까닭 둘 — 저장된 값이 있으면 키가 있으므로 덮지 않고, 사람이 적었다가
   * **지운** 칸도 키가 남으므로 다시 채워 넣지 않는다(지운 값이 되살아나면
   * 지운 사람은 영문을 모른다). 🔴 **칸마다 따로** 본다 — 통문번호는 적혀 있고
   * PRV 는 비었으면 PRV 만 얹힌다.
   *
   * 상태로 옮겨 담지 않고 그릴 때마다 얹는 까닭: 읽은 값은 화면에 잠시 떠 있는
   * **제안**이다. 상태에 넣으면 그 순간 「사람이 적은 값」과 구별할 수 없어진다.
   * 얹히면 아래 dirty 가 참이 되어 그 줄의 [저장] 단추가 저절로 나타나고,
   * 저장 방식은 예전 그대로다(줄마다 한 번 · expectedVersion).
   *
   * 🔴 **서류의 S/N 이 이 건과 다른 줄은 애초에 값이 오지 않는다**(읽기 쪽이
   * 걸러 낸다 — pass-slip-suggestions.ts). 그래서 여기서 막을 것이 없다.
   */
  const values = applyPassSlipSuggestions(typedValues, passSlipOutcome);

  // 접수 전 의뢰는 아직 접수가 아니라 값을 붙일 자리가 없다. 🔴 2026-10-04 부터
  // 조회가 그 줄을 내지 않지만, 갈래 자체는 서버에 남아 있어 막음을 그대로 둔다.
  const pending = item.sourceKind === "REQUEST";
  const valuesChanged = manualValuesDiffer(form, initialValues, values);
  const dirty =
    !pending &&
    (optionId !== (currentOption?.id ?? "") ||
      note !== (item.statusNote ?? "") ||
      valuesChanged);

  function setValue(key: string, next: string) {
    setTypedValues((previous) => ({ ...previous, [key]: next }));
  }

  return (
    <tr className="border-b border-zinc-200 align-top">
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
                    value={optionId}
                    disabled={!canEdit}
                    aria-label={column.label}
                    onChange={(e) => setOptionId(e.target.value)}
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
                    value={note}
                    disabled={!canEdit}
                    maxLength={1000}
                    aria-label={column.label}
                    onChange={(e) => setNote(e.target.value)}
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
                      onChange={(e) => setValue(column.key, e.target.value)}
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
      {canEdit ? (
        // 🔴 머리글과 같은 폭·같은 줄바꿈 금지(까닭은 그 주석에).
        <td className="w-20 px-3 py-2 whitespace-nowrap">
          {dirty ? (
            <button
              type="button"
              onClick={() =>
                onSave(() =>
                  setCustomerStatusAction({
                    repairCaseId: item.sourceId,
                    statusOptionId: optionId || null,
                    note: note || null,
                    // 🔴 상태·비고와 **한 번에** 보낸다. 나눠 보내면 저장이 둘이
                    //    되고, 첫 저장이 올린 version 때문에 둘째가 충돌로 막힌다.
                    formValues: values,
                    expectedVersion: item.statusVersion,
                  })
                )
              }
              className="rounded bg-primary-900 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white disabled:opacity-50"
            >
              저장
            </button>
          ) : (
            <span className="text-xs text-zinc-400">—</span>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * 손으로 적은 값이 처음과 달라졌는가. 🔴 **그 양식의 칸만** 견준다 — 양식에
 * 없는 키가 양쪽에 남아 있어도 "고쳤다"가 되지 않게.
 */
function manualValuesDiffer(
  form: CustomerPortalForm,
  before: Record<string, string>,
  after: Record<string, string>
): boolean {
  return manualColumnsOf(form).some(
    (column) => (before[column.key] ?? "") !== (after[column.key] ?? "")
  );
}
