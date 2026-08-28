"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { generateClientUuid } from "@/lib/client-uuid";
import { MAX_OH_TEMPLATE_ITEMS } from "@/lib/validation/oh-part-template-input";
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
 * ============================================================================
 */

type ItemRow = {
  key: string;
  partId: string | null;
  partNameText: string;
  quantity: string;
};

export default function OhTemplateScreen({
  templates,
  unlinkedModels,
  canEdit,
}: {
  templates: OhTemplateRow[];
  /** 아직 어느 템플릿에도 안 붙은 제품 모델. 고칠 수 없는 세션에는 빈 배열이 온다. */
  unlinkedModels: { id: string; modelName: string }[];
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
  onMessage,
  onDone,
}: {
  template: OhTemplateRow;
  onMessage: (message: string | null) => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(template.code);
  const [name, setName] = useState(template.name);
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

  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    onMessage(null);
    const result = await saveOhTemplateAction({
      id: template.id,
      expectedVersion: template.version,
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
          disabled={busy || items.length >= MAX_OH_TEMPLATE_ITEMS}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
        >
          + 부품 추가
        </button>
      </div>
      {fieldErrors.items && <p className={editErrorClass}>{fieldErrors.items}</p>}

      <div className="mt-2 flex flex-col gap-1.5">
        {items.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[1fr_5rem_auto] gap-2">
            <div>
              <input
                value={row.partNameText}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((r) => (r.key === row.key ? { ...r, partNameText: e.target.value } : r))
                  )
                }
                placeholder={`${index + 1}번째 부품 품명`}
                className={editInputClass}
                disabled={busy}
              />
              {fieldErrors[`items.${index}.partNameText`] && (
                <p className={editErrorClass}>{fieldErrors[`items.${index}.partNameText`]}</p>
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
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((r) => r.key !== row.key))}
              disabled={busy}
              aria-label={`${index + 1}번째 줄 지우기`}
              className="rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            >
              ×
            </button>
          </div>
        ))}
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
