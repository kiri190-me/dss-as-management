"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { isExactNormalizedMatch, rankSimilarNames } from "@/lib/domain/entity-name-match";
import { MAX_OH_TEMPLATE_ITEMS } from "@/lib/validation/oh-part-template-input";
import { OVERHAUL_UNIT_PRICE_FIELD_ERROR_PREFIX } from "@/lib/validation/part-overhaul-unit-price-input";
import {
  linkProductModelAction,
  saveOhTemplateAction,
  unlinkProductModelAction,
} from "@/lib/server/actions/oh-part-templates";
import type { OhTemplateRow } from "@/lib/db/queries/oh-part-templates";

/**
 * ============================================================================
 * O/H 부품 템플릿 관리 — 재고 관리 안쪽
 * ============================================================================
 * 이 목록은 원래 **견적서 OH 양식의 숨은 열**에 살았다(P~AD열 34~46행, K11 에
 * 기종 코드를 넣으면 IFS 로 나타나던 값들). 부품 하나를 고치려면 숨긴 열을 다시
 * 펴야 했고, 기종이 늘면 수식을 직접 고쳐야 했으며, 재고와 이어져 있지 않았다.
 * 이 화면이 그 셋을 대신한다.
 *
 * ── 재고 연결이 없는 줄이 정상이다 ──────────────────────────────────────
 * 양식에서 옮겨 온 이름 중에는 재고 마스터에 없는 것이 있다. 그런 줄은
 * `재고 미연결` 로 표시하고, **부품 요청에는 담기지 않는다** — 요청은 재고
 * 부품에만 걸 수 있기 때문이다. 그 사실을 담을 때 사람에게 알린다.
 *
 * ── 13줄이 상한이다 ────────────────────────────────────────────────────
 * OH 견적서 양식의 부품 칸이 34~46행이다. 더 담아 두면 견적서를 만들 때 넘치는
 * 줄이 갈 곳이 없고, 그때 조용히 자르면 청구할 부품이 문서에서 사라진다.
 *
 * ── 재고 연결은 품명 칸에서 만든다 ───────────────────────────────────────
 * 편집 폼의 품명 칸은 `<input list>` + `<datalist>` 다 — 고객사·End-User·제품
 * 모델 칸이 쓰는 그 방식이고, 후보 순위와 일치 판정도 그 칸들과 같은 함수를
 * 쓴다(rankSimilarNames · isExactNormalizedMatch). 여기만의 규칙을 만들지 않는다.
 *
 * 다른 점은 **친 글자가 곧 저장되는 값**이라는 것이다. 고객사 칸은 고르기 위한
 * 글자와 저장되는 값이 따로였지만, 여기서는 `partNameText` 가 그대로 견적서에
 * 찍힌다. 그래서 후보의 `value` 는 언제나 품명 그대로여야 하고, 규격 같은 곁가지
 * 정보는 `<option>` 의 본문(브라우저가 부제로 보여 준다)에만 실린다.
 * ============================================================================
 */

type ItemRow = {
  key: string;
  partId: string | null;
  partNameText: string;
  quantity: string;
};

/**
 * 품명 칸이 검색할 재고 부품. **페이지가 `{id, partName, partSpec}` 만 넘긴다** —
 * 이 파일은 "use client" 라 넘긴 값이 그대로 브라우저까지 실려 간다(PartListRow
 * 의 재고 수량·삭제 가능 여부 따위를 실어 보낼 이유가 없다).
 *
 * `partSpec`(품명2)만 예외로 함께 온다. `parts` 에는 **품명 유니크 제약이 없다**
 * (schema/inventory.ts: "no reliable identity key" — 품명이 같은 부품이 여럿일 수
 * 있다). 같은 이름이 둘 나왔을 때 사람이 어느 재고인지 고르려면 단서가 하나는
 * 있어야 하고, 그 스키마 주석이 품명2를 "closest thing to a real identifier" 라고
 * 짚는다. 도번·교산 품번까지 늘리지 않은 것은 셋 다 "independently,
 * inconsistently populated" 라 칸만 늘고 판별력은 그만큼 안 늘기 때문이다.
 */
export type OhTemplatePartOption = {
  id: string;
  partName: string;
  partSpec: string | null;
};

/** 고객사 콤보박스(ProductModelEditForm)와 같은 수. 같은 부품이라 같게 둔다. */
const MAX_PART_SUGGESTIONS = 8;

/**
 * ============================================================================
 * 🔴 품명을 고치면 재고 연결이 풀린다 — 이 파일의 판단
 * ============================================================================
 * 연결해 둔 줄의 품명을 손으로 고쳤을 때 무엇을 할지의 답이다. 이 함수가 연결을
 * **만드는 쪽과 푸는 쪽 둘 다**를 맡는다 — 품명이 재고 부품과 정확히 일치하면
 * 그 부품에 잇고, 어긋나면 `null` 로 되돌린다.
 *
 * 왜 "연결은 두고 어긋났다고 표시" 가 아니라 자동으로 푸는가:
 *
 *  1. **연결을 만드는 유일한 몸짓이 이름 일치다.** `<input list>` 에는 "골랐다"
 *     는 사건이 없고 글자만 온다 — 그래서 잇는 규칙이 곧 이름 일치다. 그렇다면
 *     유지하는 규칙도 같아야 한다. 만들 때와 지킬 때가 다른 잣대를 쓰면 사람은
 *     지금 무엇이 연결돼 있는지 화면만 보고 알 수 없다.
 *  2. **어긋난 값이 견적서로 나간다.** `partNameText` 는 문서에 찍히고 `partId`
 *     는 부품 요청이 재고에서 꺼내는 값이다. 둘이 다르면 서류와 창고가 다른 것을
 *     말한다. 저장 쪽(mutations/oh-part-templates.ts 의 checkParts)은 그 id 가
 *     **있는지**만 보지 이름이 맞는지는 보지 않는다 — 막을 곳이 여기뿐이다.
 *  3. **풀린 자리가 이미 정상이다.** `재고 미연결` 은 예외가 아니라 지금 들어 있는
 *     37줄 전부의 상태다(파일 머리말). 어긋난 채 이어 두는 것보다 훨씬 덜 위험한
 *     곳으로 떨어진다.
 *  4. **되돌리는 데 아무것도 잃지 않는다.** 이름을 다시 고르면 연결이 그대로
 *     돌아온다. 반대로 "연결된 줄은 이름을 못 고치게" 하면 오타 하나 고치자고
 *     연결부터 풀어야 한다.
 *
 * 자동으로 풀리는 것이 조용하지 않도록, 줄마다 지금 상태를 글로 보여 준다
 * (describePartLink → 아래 화면). 규칙은 여기 하나뿐이라 "만들 때"와 "고칠 때"가
 * 갈라질 자리가 없다.
 * ============================================================================
 */
export function resolvePartLinkId(
  partNameText: string,
  currentPartId: string | null,
  options: readonly OhTemplatePartOption[]
): string | null {
  const matches = options.filter((option) => isExactNormalizedMatch(option.partName, partNameText));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;
  // 같은 품명이 여럿이다. 지금 연결이 그중 하나면 그대로 둔다 — 같은 이름을 다시
  // 쳤다는 이유만으로 사람이 이미 고른 것을 빼앗지 않는다. 그렇지 않으면 어느
  // 것인지 찍지 않고 사람에게 고르게 한다(화면의 재고 고르기 select).
  if (currentPartId !== null && matches.some((option) => option.id === currentPartId)) {
    return currentPartId;
  }
  return null;
}

/**
 * 줄 하나가 지금 어떤 연결 상태인지. 화면이 이 값 하나로 무엇을 보여 줄지 정한다.
 *
 * `MISMATCHED` 는 이 화면에서는 만들어지지 않는다(resolvePartLinkId 가 곧바로
 * 푼다). DB 에서 온다 — 이어 둔 뒤 재고 마스터에서 그 부품 이름을 바꾸면 저장된
 * 두 값이 어긋난 채 남는다. 그 줄을 조용히 지나치지 않으려고 상태를 따로 둔다.
 */
export type PartLinkState =
  | { kind: "EMPTY" }
  | { kind: "UNLINKED"; ambiguous: OhTemplatePartOption[] }
  | { kind: "LINKED"; part: OhTemplatePartOption }
  | { kind: "MISMATCHED"; part: OhTemplatePartOption }
  | { kind: "MISSING" };

export function describePartLink(
  row: { partId: string | null; partNameText: string },
  options: readonly OhTemplatePartOption[]
): PartLinkState {
  // 빈 줄은 저장할 때 걸러진다(save 의 filter). 아직 아무것도 아니다.
  if (row.partNameText.trim() === "") return { kind: "EMPTY" };
  if (row.partId === null) {
    const matches = options.filter((option) => isExactNormalizedMatch(option.partName, row.partNameText));
    // 같은 품명이 여럿이라 연결을 못 정한 경우에만 고를 것을 들려 보낸다.
    return { kind: "UNLINKED", ambiguous: matches.length > 1 ? matches : [] };
  }
  const part = options.find((option) => option.id === row.partId);
  if (!part) return { kind: "MISSING" };
  if (!isExactNormalizedMatch(part.partName, row.partNameText)) return { kind: "MISMATCHED", part };
  return { kind: "LINKED", part };
}

/**
 * 같은 품명이 여럿일 때 고르는 줄. 품명2가 유일한 단서다(OhTemplatePartOption).
 * 품명도 품명2도 똑같은 부품이 둘이면 여기서 더 해 줄 것이 없다 — 그것은 이
 * 화면이 아니라 재고 부품 목록에서 정리할 일이다.
 */
function partOptionLabel(option: OhTemplatePartOption): string {
  return option.partSpec ? `${option.partName} — ${option.partSpec}` : `${option.partName} (규격 미입력)`;
}

export default function OhTemplateScreen({
  templates,
  unlinkedModels,
  partOptions,
  ohUnitPrices,
  canEdit,
}: {
  templates: OhTemplateRow[];
  /** 아직 어느 템플릿에도 안 붙은 제품 모델. 고칠 수 없는 세션에는 빈 배열이 온다. */
  unlinkedModels: { id: string; modelName: string }[];
  /** 품명 칸이 검색할 재고 부품. 고칠 수 없는 세션에는 빈 배열이 온다(모델 목록과 같은 결). */
  partOptions: OhTemplatePartOption[];
  /**
   * 부품 id → 지금 정해 둔 O/H 단가. **정해진 것만 들어 있다** — 키가 없으면
   * "정하지 않음"이고, 그것이 0원과 다른 뜻이다.
   */
  ohUnitPrices: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">O/H 부품 템플릿</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          기종마다 &ldquo;오버홀이면 이 부품들&rdquo;. 제품 모델을 이어 두면 그 장비의 부품 요청에서
          한 번에 담을 수 있습니다.
        </p>
      </div>

      {message && (
        <p className="rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {message}
        </p>
      )}

      {templates.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          등록된 템플릿이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    기종 {template.code}
                    <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                      {template.name}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    부품 {template.items.length}종
                    {template.items.some((item) => item.partId === null) &&
                      ` · 재고 미연결 ${template.items.filter((i) => i.partId === null).length}종`}
                    {" · "}
                    연결된 모델 {template.models.length}개
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === template.id ? null : template.id)}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
                  >
                    {openId === template.id ? "닫기" : "편집"}
                  </button>
                )}
              </div>

              <ModelLinks
                template={template}
                unlinkedModels={unlinkedModels}
                canEdit={canEdit}
                onMessage={setMessage}
                onDone={() => router.refresh()}
              />

              {openId === template.id ? (
                <TemplateEditor
                  template={template}
                  partOptions={partOptions}
                  ohUnitPrices={ohUnitPrices}
                  onMessage={setMessage}
                  onDone={() => {
                    setOpenId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <ol className="mt-3 flex flex-col gap-0.5 text-sm">
                  {template.items.map((item) => (
                    <li key={item.id} className="flex items-baseline gap-2">
                      <span className="w-5 text-right text-xs text-zinc-400">{item.displayOrder}</span>
                      <span className="text-zinc-800 dark:text-zinc-200">{item.partNameText}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">×{item.quantity}</span>
                      {item.partId === null && (
                        <span className="rounded border border-amber-300 px-1 text-[11px] text-amber-800 dark:border-amber-800 dark:text-amber-300">
                          재고 미연결
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 제품 모델 잇기·풀기. 모델 하나는 템플릿 하나에만 붙는다(스키마의 unique). */
function ModelLinks({
  template,
  unlinkedModels,
  canEdit,
  onMessage,
  onDone,
}: {
  template: OhTemplateRow;
  unlinkedModels: { id: string; modelName: string }[];
  canEdit: boolean;
  onMessage: (message: string | null) => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  async function link() {
    if (selected === "" || busy) return;
    setBusy(true);
    onMessage(null);
    const result = await linkProductModelAction({ templateId: template.id, productModelId: selected });
    setBusy(false);
    if (!result.ok) {
      onMessage(result.message);
      return;
    }
    setSelected("");
    onDone();
  }

  async function unlink(linkId: string) {
    if (busy) return;
    setBusy(true);
    onMessage(null);
    const result = await unlinkProductModelAction({ linkId });
    setBusy(false);
    if (!result.ok) {
      onMessage(result.message);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className={editLabelClass}>연결된 제품 모델</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {template.models.length === 0 && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            없음 — 이어 두지 않으면 부품 요청에서 이 템플릿을 담을 수 없습니다.
          </span>
        )}
        {template.models.map((model) => (
          <span
            key={model.id}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700"
          >
            {model.modelName}
            {canEdit && (
              <button
                type="button"
                onClick={() => void unlink(model.id)}
                disabled={busy}
                aria-label={`${model.modelName} 연결 풀기`}
                className="text-zinc-400 hover:text-red-600 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && unlinkedModels.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={editInputClass}
            disabled={busy}
          >
            <option value="">모델 고르기…</option>
            {unlinkedModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.modelName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void link()}
            disabled={busy || selected === ""}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            연결
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  partOptions,
  ohUnitPrices,
  onMessage,
  onDone,
}: {
  template: OhTemplateRow;
  partOptions: OhTemplatePartOption[];
  ohUnitPrices: Record<string, string>;
  onMessage: (message: string | null) => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(template.code);
  const [name, setName] = useState(template.name);
  /**
   * 부품별 O/H 단가. **줄(key)이 아니라 부품 id 로 담는다** — 단가는 그 부품의
   * 값이지 이 줄의 값이 아니다. 그래서 같은 부품이 두 줄에 있으면 두 칸이 같은
   * 값을 보여 주고 함께 움직인다(그게 사실이다. 부품 하나에 O/H 단가는 하나다).
   *
   * 여기 **없는 키가 "정하지 않음"**이다. numeric 이 `"125000.00"` 으로 오므로
   * 작업비 칸과 같은 방법으로 소수점을 지워 채운다.
   */
  const [ohPrices, setOhPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(ohUnitPrices).map(([partId, price]) => [partId, String(Number(price))])
    )
  );
  const [items, setItems] = useState<ItemRow[]>(
    template.items.map((item) => ({
      key: generateClientUuid(),
      partId: item.partId,
      partNameText: item.partNameText,
      quantity: String(item.quantity),
    }))
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // rankSimilarNames 는 `name` 을 본다(고객사·End-User 칸과 같은 함수라 그렇다).
  // 부품은 그 칸이 `partName` 이라 한 번만 이름을 붙여 둔다.
  const nameableParts = useMemo(
    () => partOptions.map((option) => ({ ...option, name: option.partName })),
    [partOptions]
  );

  /**
   * 줄마다의 후보. 줄이 여럿이라 훅을 줄 안에서 부를 수 없어 한 번에 만든다.
   * 후보의 `value` 는 언제나 품명 그대로다 — 고르면 그 글자가 곧 저장되는
   * `partNameText` 이기 때문이다(파일 머리말). 규격은 `<option>` 본문으로만
   * 실어 브라우저가 부제로 보여 주게 한다. 품명이 같은 부품이 둘이면 후보도 둘
   * 나오는데, 그것을 접지 않는 것이 낫다 — "같은 이름이 둘 있다" 를 그 자리에서
   * 보여 주는 것이 곧 아래 재고 고르기 select 가 왜 뜨는지의 설명이다.
   */
  const suggestionsByKey = useMemo(() => {
    const map = new Map<string, typeof nameableParts>();
    for (const row of items) {
      map.set(row.key, rankSimilarNames(row.partNameText, nameableParts).slice(0, MAX_PART_SUGGESTIONS));
    }
    return map;
  }, [items, nameableParts]);

  /** 품명을 고칠 때마다 연결을 다시 정한다 — 만드는 쪽과 푸는 쪽이 같은 규칙이다. */
  function changePartName(key: string, text: string) {
    setItems((prev) =>
      prev.map((row) =>
        row.key === key
          ? { ...row, partNameText: text, partId: resolvePartLinkId(text, row.partId, partOptions) }
          : row
      )
    );
  }

  /**
   * 줄이 상한까지 찼다. `+ 부품 추가` 가 잠기는 조건이자, 왜 잠겼는지 적어 주는
   * 조건이다 — 한 값에서 갈라져 나오므로 단추와 안내가 어긋날 자리가 없다.
   *
   * 숫자만으로는 사람이 상한을 고장과 구별하지 못한다. 실제로 `부품 (13 / 13)` 을
   * 보고도 "부품 추가가 안 된다" 는 고장 신고가 올라왔다. 잠긴 것이 안전장치라면
   * 그 이유(견적서 양식의 칸 수)를 그 자리에서 말해야 한다.
   */
  const atItemLimit = items.length >= MAX_OH_TEMPLATE_ITEMS;
  const itemLimitHintId = `oh-template-item-limit-${template.id}`;

  /** 잘못 이어 둔 줄을 되돌린다. 품명은 건드리지 않는다 — 적어 둔 글자는 사람 것이다. */
  function unlinkPart(key: string) {
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, partId: null } : row)));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    onMessage(null);
    /**
     * 보낼 단가 줄. **재고와 이어진 줄만** 담는다 — 단가는 부품에 붙는 값이라
     * 이어지지 않은 줄에는 붙일 곳이 없다.
     *
     * 부품 id 로 한 번 접는다: 같은 부품이 두 줄에 있으면 검증이 "같은 부품이
     * 두 번 들어왔습니다"로 거절하는데, 화면에서는 두 칸이 애초에 같은 값을
     * 보여 주고 있으므로 그건 사람의 잘못이 아니다. 접어서 보내면 사실도
     * 그대로다 — 부품 하나에 O/H 단가는 하나다.
     *
     * 칸을 비운 부품은 `""` 로 간다. 그것이 "정하지 않음"이고, 저장 쪽이 그 줄을
     * 지운다(0 으로 저장하지 않는다).
     */
    const overhaulUnitPrices = [
      ...new Map(
        items
          .filter((row) => row.partId !== null && row.partNameText.trim() !== "")
          .map((row) => [row.partId as string, ohPrices[row.partId as string] ?? ""] as const)
      ),
    ].map(([partId, unitPrice]) => ({ partId, unitPrice }));

    const result = await saveOhTemplateAction({
      id: template.id,
      expectedVersion: template.version,
      overhaulUnitPrices,
      fields: {
        code,
        name,
        note: template.note,
        items: items
          .filter((row) => row.partNameText.trim() !== "")
          .map((row) => ({
            partId: row.partId,
            partNameText: row.partNameText,
            quantity: Number(row.quantity),
          })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      if ("fieldErrors" in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
      onMessage(result.message);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>기종 코드</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} className={editInputClass} disabled={busy} />
          {fieldErrors.code && <p className={editErrorClass}>{fieldErrors.code}</p>}
        </label>
        <label className="flex flex-col gap-1">
          <span className={editLabelClass}>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={editInputClass} disabled={busy} />
          {fieldErrors.name && <p className={editErrorClass}>{fieldErrors.name}</p>}
        </label>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className={editLabelClass}>부품 ({items.length} / {MAX_OH_TEMPLATE_ITEMS})</span>
        <button
          type="button"
          onClick={() =>
            setItems((prev) => [
              ...prev,
              { key: generateClientUuid(), partId: null, partNameText: "", quantity: "1" },
            ])
          }
          disabled={busy || atItemLimit}
          aria-describedby={atItemLimit ? itemLimitHintId : undefined}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
        >
          + 부품 추가
        </button>
      </div>
      {/* 꽉 찼을 때만 뜬다. 늘 떠 있으면 잔소리가 되고, 정작 단추가 잠긴 순간에
          눈에 띄지 않는다. 오류가 아니라 안전장치라서 빨강(editErrorClass)이
          아닌 호박색을 쓴다 — 이 파일이 `재고 미연결` 에 쓰는 그 색이다. */}
      {atItemLimit && (
        <p id={itemLimitHintId} className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
          견적서 양식의 O/H 부품 칸이 {MAX_OH_TEMPLATE_ITEMS}줄이라 {MAX_OH_TEMPLATE_ITEMS}종까지만
          담을 수 있습니다 — 다른 부품을 넣으려면 아래에서 필요 없는 줄을 먼저 지워 주세요.
        </p>
      )}
      {fieldErrors.items && <p className={editErrorClass}>{fieldErrors.items}</p>}

      <div className="mt-2 flex flex-col gap-2.5">
        {/* 칸 이름. 값이 차면 placeholder 가 사라지므로 머리글이 없으면 셋째 칸이
            무엇인지 알 길이 없다. 지우기 칸은 이름을 붙일 것이 없어 비워 둔다. */}
        {items.length > 0 && (
          <div className="grid grid-cols-[1fr_4.5rem_7rem_2rem] gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>품명</span>
            <span>수량</span>
            <span>O/H 단가 (원)</span>
            <span aria-hidden />
          </div>
        )}
        {items.map((row, index) => {
          const link = describePartLink(row, partOptions);
          const listId = `oh-part-suggestions-${row.key}`;
          const priceErrorKey = `${OVERHAUL_UNIT_PRICE_FIELD_ERROR_PREFIX}${row.partId ?? ""}`;
          return (
          <div key={row.key} className="grid grid-cols-[1fr_4.5rem_7rem_2rem] gap-2">
            <div>
              <input
                value={row.partNameText}
                onChange={(e) => changePartName(row.key, e.target.value)}
                list={listId}
                autoComplete="off"
                placeholder={`${index + 1}번째 부품 품명`}
                aria-label={`${index + 1}번째 부품 품명`}
                className={editInputClass}
                disabled={busy}
              />
              <datalist id={listId}>
                {(suggestionsByKey.get(row.key) ?? []).map((option) => (
                  // value 는 품명 그대로, 규격은 본문으로만(파일 머리말).
                  <option key={option.id} value={option.partName}>
                    {option.partSpec ?? ""}
                  </option>
                ))}
              </datalist>

              {/* 이 줄이 지금 재고와 이어져 있는지. 말은 목록 화면과 맞춘다
                  (`재고 미연결` — 새 용어를 만들지 않는다). */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                {link.kind === "LINKED" && (
                  <>
                    <span className="rounded border border-emerald-300 px-1 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300">
                      재고 연결됨
                    </span>
                    {link.part.partSpec && (
                      <span className="text-zinc-500 dark:text-zinc-400">{link.part.partSpec}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => unlinkPart(row.key)}
                      disabled={busy}
                      aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                      className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400"
                    >
                      연결 풀기
                    </button>
                  </>
                )}

                {link.kind === "UNLINKED" && (
                  <span className="rounded border border-amber-300 px-1 text-amber-800 dark:border-amber-800 dark:text-amber-300">
                    재고 미연결
                  </span>
                )}

                {/* DB 에서 온 어긋남이다 — 이 화면은 이 상태를 만들지 않는다
                    (resolvePartLinkId 머리말). 조용히 두면 견적서와 창고가
                    다른 것을 말하므로 무엇에 이어져 있는지 그대로 보여 준다. */}
                {link.kind === "MISMATCHED" && (
                  <>
                    <span className="rounded border border-red-300 px-1 text-red-700 dark:border-red-800 dark:text-red-300">
                      연결된 재고와 품명이 다름
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      연결: {partOptionLabel(link.part)}
                    </span>
                    <button
                      type="button"
                      onClick={() => unlinkPart(row.key)}
                      disabled={busy}
                      aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                      className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400"
                    >
                      연결 풀기
                    </button>
                  </>
                )}

                {link.kind === "MISSING" && (
                  <>
                    <span className="rounded border border-red-300 px-1 text-red-700 dark:border-red-800 dark:text-red-300">
                      연결된 재고를 찾을 수 없음
                    </span>
                    <button
                      type="button"
                      onClick={() => unlinkPart(row.key)}
                      disabled={busy}
                      aria-label={`${index + 1}번째 부품 재고 연결 풀기`}
                      className="text-zinc-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400"
                    >
                      연결 풀기
                    </button>
                  </>
                )}
              </div>

              {/* 품명이 같은 부품이 여럿이라 이름만으로는 정할 수 없다. 찍지 않고
                  사람에게 고르게 한다(OhTemplatePartOption 의 품명2 판단). */}
              {link.kind === "UNLINKED" && link.ambiguous.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const picked = e.target.value;
                    if (picked === "") return;
                    setItems((prev) =>
                      prev.map((r) => (r.key === row.key ? { ...r, partId: picked } : r))
                    );
                  }}
                  disabled={busy}
                  aria-label={`${index + 1}번째 부품 재고 고르기`}
                  className={`${editInputClass} mt-1`}
                >
                  <option value="">
                    같은 품명이 {link.ambiguous.length}개입니다 — 어느 재고인지 고르세요…
                  </option>
                  {link.ambiguous.map((option) => (
                    <option key={option.id} value={option.id}>
                      {partOptionLabel(option)}
                    </option>
                  ))}
                </select>
              )}

              {fieldErrors[`items.${index}.partNameText`] && (
                <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
              )}
              {fieldErrors[`items.${index}.partId`] && (
                <p className={editErrorClass}>{fieldErrors[`items.${index}.partId`]}</p>
              )}
            </div>
            <div>
              <input
                value={row.quantity}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((r) => (r.key === row.key ? { ...r, quantity: e.target.value } : r))
                  )
                }
                inputMode="numeric"
                aria-label={`${index + 1}번째 부품 수량`}
                className={editInputClass}
                disabled={busy}
              />
              {fieldErrors[`items.${index}.quantity`] && (
                <p className={editErrorClass}>{fieldErrors[`items.${index}.quantity`]}</p>
              )}
            </div>
            {/* ── 부품별 O/H 단가 ─────────────────────────────────────────────
                재고와 이어진 줄에만 적을 수 있다 — 단가는 부품에 붙는 값이라
                이어지지 않은 줄에는 붙일 곳이 없다. **잠그기만 하고 이유를 안
                적으면 안 된다**: 설명 없이 회색인 단추를 두었다가 "추가가 안
                된다"는 고장 신고를 받은 적이 있다(위 부품 상한 안내). */}
            <div>
              <input
                value={row.partId === null ? "" : ohPrices[row.partId] ?? ""}
                onChange={(e) => {
                  const partId = row.partId;
                  if (partId === null) return;
                  const next = e.target.value;
                  setOhPrices((prev) => ({ ...prev, [partId]: next }));
                }}
                inputMode="numeric"
                disabled={busy || row.partId === null}
                placeholder={row.partId === null ? "재고 연결 필요" : "미정"}
                title={
                  row.partId === null
                    ? "재고와 이어야 O/H 단가를 정할 수 있습니다."
                    : "비워 두면 정하지 않음. 0 은 무상이라는 뜻입니다."
                }
                aria-label={`${index + 1}번째 부품 O/H 단가`}
                className={`${editInputClass} disabled:opacity-50`}
              />
              {row.partId !== null && fieldErrors[priceErrorKey] && (
                <p className={editErrorClass}>{fieldErrors[priceErrorKey]}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((r) => r.key !== row.key))}
              disabled={busy}
              aria-label={`${index + 1}번째 줄 지우기`}
              className="rounded-md border border-zinc-300 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            >
              ×
            </button>
          </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
