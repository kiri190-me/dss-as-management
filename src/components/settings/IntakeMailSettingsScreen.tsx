"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { roleLabels, type Role } from "@/lib/domain/types";
import {
  composeIntakeMail,
  INTAKE_MAIL_PLACEHOLDERS,
  INTAKE_MAIL_PREVIEW_SAMPLE,
} from "@/lib/domain/intake-mail-body";
import { sanitizeSignatureHtml } from "@/lib/domain/mail-signature-html";
import type { IntakeMailSettingsView } from "@/lib/db/queries/intake-mail-settings";
import {
  SIGNATURE_HTML_MAX,
  SIGNATURE_IMAGE_MAX_BYTES,
  SIGNATURE_IMAGE_MAX_COUNT,
  SUBJECT_MAX,
  TEXT_MAX,
  type IntakeMailSettingsFieldErrors,
} from "@/lib/validation/intake-mail-settings-input";
import {
  deleteSignatureImageAction,
  saveIntakeMailSettingsAction,
  uploadSignatureImageAction,
  sendTestIntakeMailAction,
} from "@/lib/server/actions/intake-mail-settings";

/**
 * ============================================================================
 * A/S 접수 알림 메일 설정 — 켤지 · 누가 받을지 · 뭐라고 쓸지
 * ============================================================================
 *
 * ■ 미리보기가 진짜 메일과 같은 함수를 쓴다
 *
 * 오른쪽 미리보기는 `composeIntakeMail` 로 그린다 — 실제로 나갈 메일을 만드는
 * 바로 그 함수다. 미리보기를 따로 만들면 사람이 확인한 문구와 실제로 나간
 * 문구가 갈리고, 그 어긋남은 **전사원에게 나간 뒤에** 발견된다.
 *
 * ■ 미리보기에 실제 접수 건을 쓰지 않는 이유
 *
 * 여기는 문구를 고치는 자리다. 실제 고객사·S/N·증상이 뜰 이유가 없고, 값이
 * 고정이라야 문구를 고칠 때마다 같은 자리에서 같은 모양으로 비교된다.
 *
 * ■ 자료 부분은 편집 대상이 아니다
 *
 * 사람이 고치는 것은 제목 형식·머리말·꼬리말 셋뿐이다. 가운데 표(제품·증상·
 * 유무상·O/H·과거 이력)까지 자유 편집으로 열면 값이 빠지거나 틀린 이름표가
 * 붙는데, 그걸 알아채는 건 메일이 나간 뒤다.
 * ============================================================================
 */
export default function IntakeMailSettingsScreen({
  initial,
}: {
  initial: IntakeMailSettingsView;
}) {
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [subjectTemplate, setSubjectTemplate] = useState(initial.subjectTemplate);
  const [introText, setIntroText] = useState(initial.introText);
  const [outroText, setOutroText] = useState(initial.outroText);
  const [signatureHtml, setSignatureHtml] = useState(initial.signatureHtml);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initial.recipientOptions.filter((o) => o.isSelected).map((o) => o.userId))
  );

  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<IntakeMailSettingsFieldErrors>({});
  const [pending, startTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();
  const router = useRouter();

  const [uploadPending, startUploadTransition] = useTransition();

  function uploadImage(file: File) {
    startUploadTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      // 이름은 파일명에서 만든다 — 확장자를 떼고 허용 글자만 남긴다.
      const base = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "") || "image";
      form.set("cid", base.slice(0, 40));
      const result = await uploadSignatureImageAction(form);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  }

  function removeImage(id: string, used: boolean) {
    // 쓰이는 중인 그림을 지우면 메일에서 그 자리가 깨진 그림으로 남는다.
    // 되돌릴 수 없는 조작은 아니지만(다시 올리면 된다) 모르고 지나가면 안 된다.
    if (used && !window.confirm("이 이미지는 서명에서 쓰이고 있습니다. 지우면 서명의 그 자리가 깨집니다. 계속할까요?")) {
      return;
    }
    startUploadTransition(async () => {
      const result = await deleteSignatureImageAction({ id });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  }

  // 실제 발송과 같은 함수. 문구를 한 글자 고칠 때마다 다시 그린다.
  const preview = useMemo(() => {
    /*
     * 미리보기의 서명도 **저장 경로와 같은 함수로 정화한다.**
     *
     * 이 값은 아래에서 dangerouslySetInnerHTML 로 그려지므로, 거르지 않으면
     * 붙여넣은 글이 곧 우리 화면의 스크립트가 된다. 저장 전 값을 그리는
     * 자리라 서버의 정화를 거치지 않았고, 그래서 여기서 한 번 거른다.
     */
    const signature = sanitizeSignatureHtml(signatureHtml);
    const composed = composeIntakeMail({
      template: { subject: subjectTemplate, intro: introText, outro: outroText },
      signature,
      ...INTAKE_MAIL_PREVIEW_SAMPLE,
    });
    /*
     * 메일에서는 `cid:` 가 동봉된 이미지를 가리키지만 브라우저는 그걸 모른다.
     * 미리보기에서만 실제 주소로 바꿔 끼운다 — 보내는 값은 건드리지 않는다.
     */
    let html = composed.html;
    for (const image of initial.signatureImages) {
      html = html.replaceAll(`cid:${image.cid}`, `/api/mail-signature-images/${image.id}`);
    }
    return { ...composed, previewHtml: html };
  }, [subjectTemplate, introText, outroText, signatureHtml, initial.signatureImages]);

  function toggleRecipient(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveIntakeMailSettingsAction({
        isEnabled,
        subjectTemplate,
        introText,
        outroText,
        signatureHtml,
        recipientUserIds: [...selectedIds],
      });
      setMessage({ ok: result.ok, text: result.message });
      setFieldErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    });
  }

  /**
   * 시험 메일은 **저장과 별개의 전환**으로 둔다. 같은 pending 을 쓰면 메일을
   * 보내는 동안 저장 버튼까지 "저장 중"으로 보여 무슨 일이 벌어지는지 흐려진다.
   */
  function sendTest() {
    startTestTransition(async () => {
      // 받는 사람은 넘기지 않는다 — 서버가 세션에서 내 주소를 구한다.
      const result = await sendTestIntakeMailAction({
        subjectTemplate,
        introText,
        outroText,
        signatureHtml,
      });
      setMessage({ ok: result.ok, text: result.message });
    });
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">메일 설정</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A/S 접수가 등록되면 아래 수신자에게 접수 내용과 그 제품의 과거 이력을
          메일로 보냅니다. 고객사명 · S/N · 고장증상이 그대로 나가므로 수신자를
          확인해 주세요.
        </p>
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

      {/* ───── 자동 발송 ───── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              접수되면 자동으로 메일을 보낸다
            </span>
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              꺼 두면 설정만 저장되고 메일은 나가지 않습니다. Excel 대량 이관으로
              들어온 접수는 켜져 있어도 보내지 않습니다 — 과거 자료를 옮길 때마다
              수백 통이 나가면 안 되기 때문입니다.
            </span>
          </span>
        </label>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ───── 왼쪽: 문구 ───── */}
        <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">문구</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              제목에 쓸 수 있는 치환자:{" "}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">
                {INTAKE_MAIL_PLACEHOLDERS.join(" ")}
              </span>
              . 목록에 없는 치환자는 바뀌지 않고 그대로 나갑니다.
            </p>
          </div>

          <Field label="제목 형식" error={fieldErrors.subjectTemplate} count={`${subjectTemplate.length}/${SUBJECT_MAX}`}>
            <input
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              maxLength={SUBJECT_MAX}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </Field>

          <Field label="머리말 (자료 위)" error={fieldErrors.introText} count={`${introText.length}/${TEXT_MAX}`}>
            <textarea
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
              maxLength={TEXT_MAX}
              rows={3}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </Field>

          <Field label="꼬리말 (자료 아래)" error={fieldErrors.outroText} count={`${outroText.length}/${TEXT_MAX}`}>
            <textarea
              value={outroText}
              onChange={(e) => setOutroText(e.target.value)}
              maxLength={TEXT_MAX}
              rows={3}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </Field>

          <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            가운데 자료 부분(제품 · 증상 · 유/무상 · O/H · 과거 이력)은 시스템이
            만듭니다. 머리말과 꼬리말을 비우면 그 줄은 아예 빠집니다.
          </p>
        </section>

        {/* ───── 오른쪽: 미리보기 ───── */}
        <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">미리보기</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            실제로 나갈 메일을 만드는 함수 그대로 그립니다. 값은 예시입니다 —
            실제 고객사 자료가 아닙니다.
          </p>
          <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">제목</span>
              <p className="mt-0.5 text-sm font-semibold break-all text-zinc-900 dark:text-zinc-50">
                {preview.subject}
              </p>
            </div>
            {/*
              실제로 나갈 HTML 을 그대로 그린다 — 맑은 고딕과 서명까지 보인다.
              값은 위 useMemo 에서 sanitizeSignatureHtml 로 이미 걸러졌다.
              그리기 직전에 또 거르지 않는 이유는 거르는 자리를 한 곳으로
              모으기 위해서다(domain/mail-signature-html.ts 주석).
            */}
            <div
              className="overflow-x-auto bg-white px-3 py-3"
              dangerouslySetInnerHTML={{ __html: preview.previewHtml }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={pending || testPending}
              onClick={sendTest}
              className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              {testPending ? "보내는 중…" : "시험 메일 보내기"}
            </button>
            {/* 어디로 가는지 버튼 옆에 늘 적어 둔다 — "시험"이라는 말만 믿고
                눌렀다가 전사원에게 나갔다고 오해할 여지를 없앤다. */}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              지금 화면의 문구로{" "}
              <strong className="font-semibold text-zinc-700 dark:text-zinc-300">나에게만</strong> 한 통
              보냅니다. 저장하지 않아도 됩니다.
            </span>
          </div>
        </section>
      </div>
      {/* ───── 서명 ───── */}
      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">서명</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              메일 맨 아래에 붙습니다. Outlook 서명을 HTML 로 복사해 붙여넣으면
              됩니다 — 안전하지 않은 태그(<code className="font-mono">script</code>,{" "}
              <code className="font-mono">onclick</code> 등)와 Outlook 이 딸려
              보내는 잡동사니는 저장할 때 자동으로 걸러집니다.
            </p>
          </div>

          <Field label="서명 HTML" count={`${signatureHtml.length}/${SIGNATURE_HTML_MAX}`}>
            <textarea
              value={signatureHtml}
              onChange={(e) => setSignatureHtml(e.target.value)}
              maxLength={SIGNATURE_HTML_MAX}
              rows={8}
              spellCheck={false}
              placeholder='<p><b>DSS Co.,Ltd.</b></p><p>Tel : 070-5227-3024</p>'
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </Field>

          {/* ── 이미지 ── */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                서명 이미지 ({initial.signatureImages.length}/{SIGNATURE_IMAGE_MAX_COUNT}장 ·
                장당 {Math.round(SIGNATURE_IMAGE_MAX_BYTES / 1024)}KB 까지)
              </span>
              <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300">
                {uploadPending ? "올리는 중…" : "이미지 올리기"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif"
                  disabled={uploadPending}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // 같은 파일을 다시 고를 수 있게 값을 비운다.
                    e.target.value = "";
                    if (file) uploadImage(file);
                  }}
                />
              </label>
            </div>

            {initial.signatureImages.length === 0 ? (
              <p className="rounded-md bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 dark:bg-zinc-800/60">
                올린 이미지가 없습니다. 글자만으로 된 서명이면 필요 없습니다.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {initial.signatureImages.map((image) => {
                  const used = signatureHtml.includes(`cid:${image.cid}`);
                  return (
                    <li
                      key={image.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/mail-signature-images/${image.id}`}
                        alt={image.fileName}
                        className="h-8 w-8 shrink-0 object-contain"
                      />
                      <code className="font-mono text-xs text-zinc-900 dark:text-zinc-50">
                        cid:{image.cid}
                      </code>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {image.fileName} · {Math.round(image.sizeBytes / 1024)}KB
                      </span>
                      {/* 서명에서 쓰이는지 바로 보여 준다 — 안 쓰는 그림은 메일에
                          동봉되지 않으므로, 넣었다고 믿는 상태를 막는다. */}
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          used
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {used ? "서명에서 사용 중" : "서명에 없음"}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSignatureHtml((prev) => `${prev}<img src="cid:${image.cid}">`)
                          }
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          서명에 넣기
                        </button>
                        <button
                          type="button"
                          disabled={uploadPending}
                          onClick={() => removeImage(image.id, used)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:border-red-600 disabled:opacity-50"
                        >
                          지우기
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

      {/* ───── 수신자 ───── */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            수신자 <span className="text-zinc-500">({selectedCount}명 선택됨)</span>
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(initial.recipientOptions.map((o) => o.userId)))}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
            >
              전체 해제
            </button>
          </div>
        </div>

        {fieldErrors.recipientUserIds ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{fieldErrors.recipientUserIds}</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            승인된 계정만 고를 수 있습니다. 아무도 고르지 않으면 메일은 나가지
            않습니다.
          </p>
        )}

        {initial.recipientOptions.length === 0 ? (
          <p className="mt-3 rounded-md bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-800/60">
            승인된 계정이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {initial.recipientOptions.map((option) => (
              <li key={option.userId}>
                <label className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(option.userId)}
                    onChange={() => toggleRecipient(option.userId)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-900 dark:text-zinc-50">
                      {option.name}{" "}
                      <span className="text-xs text-zinc-500">
                        {roleLabels[option.role as Role] ?? option.role}
                      </span>
                    </span>
                    {/* 이름이 같은 사람이 있을 수 있어 주소를 함께 보여 준다 —
                        엉뚱한 사람을 고르는 것이 이 화면의 가장 큰 사고다. */}
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {option.email}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {initial.updatedAt ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            마지막 수정: {new Date(initial.updatedAt).toLocaleString("ko-KR")}
            {initial.updatedByName ? ` · ${initial.updatedByName}` : ""}
          </span>
        ) : (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            아직 저장된 적이 없습니다 — 지금 보이는 값은 기본 문구입니다.
          </span>
        )}
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        자동 발송을 켜고 수신자를 고르면, 이제 <strong>접수가 등록될 때마다 실제로
        메일이 나갑니다.</strong> 켜기 전에 「시험 메일 보내기」로 문구를 한 번
        확인해 주세요. Excel 대량 이관으로 들어온 접수는 켜져 있어도 보내지 않습니다.
      </p>
    </div>
  );
}

function Field({
  label,
  error,
  count,
  children,
}: {
  label: string;
  error?: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{count}</span>
      </div>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
