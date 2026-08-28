"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createStatusOptionAction,
  updateStatusOptionAction,
} from "@/lib/server/actions/customer-portal";

/**
 * 고객 안내 상태 목록 관리.
 *
 * ■ 지우는 단추가 없다
 *
 * 이미 그 상태를 쓰고 있는 접수가 있다. 지우면 그 접수의 안내가 사라지거나
 * FK 가 막는다. **비활성**은 "앞으로 고르지 못한다"이지 "지난 것을 없앤다"가
 * 아니다 — 이미 그 값을 쓰는 건은 고객 화면에 그대로 남고, 그 사실을 화면에
 * 적어 둔다.
 *
 * ■ 여기서 정한 말이 그대로 고객에게 보인다
 *
 * 사내 용어가 아니라 고객이 읽을 문장이다. 화면 맨 위에 그 사실을 적어
 * 두어야, 「PO대기중」 같은 말을 넣기 전에 한 번 더 생각하게 된다.
 */
export default function CustomerStatusOptionSettings({
  options,
  canManage,
}: {
  options: { id: string; label: string; displayOrder: number; isActive: boolean }[];
  canManage: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  }

  const active = options.filter((o) => o.isActive);
  const inactive = options.filter((o) => !o.isActive);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-5">
      <header>
        <h2 className="text-base font-bold text-zinc-900">고객 안내 상태 목록</h2>
        <p className="mt-1 text-sm text-zinc-600">
          「고객 안내 현황」에서 고를 수 있는 상태입니다.{" "}
          <strong className="text-zinc-900">
            여기 적은 말이 그대로 고객 화면에 보입니다.
          </strong>
        </p>
      </header>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border px-4 py-2 text-sm ${
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {active.map((option) => (
          <li
            key={option.id}
            className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-3 py-2"
          >
            <LabelEditor
              option={option}
              canManage={canManage}
              onSave={(label) =>
                run(() => updateStatusOptionAction({ id: option.id, label }))
              }
            />
            {canManage ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => updateStatusOptionAction({ id: option.id, isActive: false }))
                }
                className="ml-auto rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-900 disabled:opacity-50"
              >
                비활성
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="flex gap-2">
          <input
            value={newLabel}
            maxLength={50}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="새 상태 이름 (예: 고객 확인 대기)"
            className="h-10 w-64 rounded border border-zinc-300 px-3 text-sm"
          />
          <button
            type="button"
            disabled={pending || !newLabel.trim()}
            onClick={() =>
              run(async () => {
                const result = await createStatusOptionAction({ label: newLabel });
                if (result.ok) setNewLabel("");
                return result;
              })
            }
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            더하기
          </button>
        </div>
      ) : null}

      {inactive.length > 0 ? (
        <div>
          <h3 className="text-xs font-bold text-zinc-500">비활성</h3>
          <p className="mt-1 text-xs text-zinc-500">
            앞으로 고를 수 없습니다. 이미 이 상태로 안내 중인 건은 고객 화면에
            그대로 남아 있습니다.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {inactive.map((option) => (
              <li key={option.id} className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-500 line-through">
                  {option.label}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        updateStatusOptionAction({ id: option.id, isActive: true })
                      )
                    }
                    className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50"
                  >
                    되살리기
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function LabelEditor({
  option,
  canManage,
  onSave,
}: {
  option: { id: string; label: string };
  canManage: boolean;
  onSave: (label: string) => void;
}) {
  const [value, setValue] = useState(option.label);
  const dirty = value.trim() !== option.label;

  if (!canManage) {
    return <span className="text-sm text-zinc-800">{option.label}</span>;
  }

  return (
    <>
      <input
        value={value}
        maxLength={50}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 w-56 rounded border border-zinc-300 px-2 text-sm"
      />
      {dirty && value.trim() ? (
        <button
          type="button"
          onClick={() => onSave(value.trim())}
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
        >
          저장
        </button>
      ) : null}
    </>
  );
}
