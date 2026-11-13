import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import BorrowedSourceNote from "./BorrowedSourceNote";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "@/lib/domain/requested-due-date-link";

/**
 * ============================================================================
 * 「내자 정리에서 작성됨」 출처 표시 — **떼어냈는데 화면이 똑같은가** (2026-11-13)
 * ============================================================================
 * 이 한 줄은 2026-11-13 까지 `detail/IntakeInfoSection.tsx` 안의 비공개 `Field`
 * 조각이 제 손으로 그렸다. [시스템 설정] → [배지 표시]가 이름 옆에 **실제 모양**을
 * 세우는데 비공개라 가져다 쓸 수 없어, 배지 열다섯 가운데 이 하나만 보기가 비어
 * 있었다. 그래서 모양만 제 파일로 내렸다(BorrowedSourceNote.tsx).
 *
 * 🔴 **떼어내기는 「아무것도 안 바뀌어야 성공」인 일이다.** 글자 하나, 여백 한 칸이
 * 달라져도 오류는 안 나고 상세 화면에서만 드러난다 — 그것도 「빌려 온 날짜가 있는
 * 건」을 열어야 보인다. 그래서 옮기기 **전의 HTML 을 아래에 박아 두고** 맞댄다.
 *
 * 🔴 못 박는 것 넷
 *  ① 떼어낸 조각이 그리는 HTML 이 **옮기기 전과 한 글자도 다르지 않다.**
 *  ② 옛 사본이 화면 파일에 남아 있지 않다 — 두 벌이 되면 언젠가 한쪽만 고쳐진다.
 *  ③ 🔴 **「언제 그리는가」는 화면에 그대로 남았다** — 관문(BadgeVisibilityGate) ·
 *    배지 키 · 자리 키가 셋 다 IntakeInfoSection.tsx 것이고, 떼어낸 조각 안으로
 *    따라 들어가지 않았다. 따라 들어가면 설정 화면의 보기 배지가 함께 꺼져 끈
 *    사람이 다시 켤 길을 잃는다(settings/badge-samples.tsx 머리말).
 *  ④ 글자를 조각이 짓지 않는다 — 도메인 상수를 **받아서** 그린다.
 *
 * 🔵 그려 볼 수 있는 까닭: 떼어낸 조각은 훅도 서버 사슬도 물지 않는다. 화면 본체
 * (IntakeInfoSection)는 편집 폼 → 서버 액션 → `server-only` 로 이어져 이 환경에서
 * import 자체가 던지므로, 그쪽은 **원본 글자로** 읽는다(이웃
 * detail/due-date-inversion-note.test.ts 와 같은 사정·같은 방법).
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
/** 주석에 적힌 규칙 글자에 단언이 걸리지 않게 걷어 낸다(이 저장소가 겪은 함정). */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sectionSource = read("src/components/repair-cases/detail/IntakeInfoSection.tsx");
const sectionCode = stripComments(sectionSource);
const noteCode = stripComments(read("src/components/repair-cases/BorrowedSourceNote.tsx"));

/**
 * 🔴 **옮기기 전 HEAD 의 그 한 마디가 그리던 HTML 그대로다**(2026-11-13 에 손으로
 * 옮겨 적었다). 조각 쪽을 고쳐 가며 맞춰 적은 값이 아니다 — 그러면 이 시험은 지금
 * 모양을 베껴 적는 거울이 되어 아무것도 못 잡는다.
 *
 * 🔵 글자(`내자 정리에서 작성됨`)만 상수로 끼워 넣는다. 그 말은 조각의 **입력**이지
 * 모양이 아니라서, 도메인이 말을 바꾸는 날 이 줄이 함께 따라가야 맞다.
 */
const MARKUP_BEFORE_EXTRACTION =
  '<p class="mt-1 mr-1 inline-block whitespace-nowrap rounded border border-zinc-300 ' +
  'bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-700 ' +
  'dark:bg-zinc-800/60 dark:text-zinc-300">' +
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL +
  "</p>";

describe("출처 표시를 떼어냈다 — ① 화면이 똑같다", () => {
  test("표본 확인 — 그린 글자도 읽은 원본도 비어 있지 않다", () => {
    // 아래 단언들이 빈 글자를 뒤지다 전부 초록색이 되는 일을 막는다.
    assert.ok(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL.length > 0, "도메인 글자가 비었다");
    assert.ok(sectionCode.includes("function Field("), "인수 정보의 칸 조각을 못 찾았다");
    assert.ok(noteCode.includes("export default function BorrowedSourceNote("));
  });

  test("🔴 그리는 HTML 이 옮기기 전과 한 글자도 다르지 않다", () => {
    const html = renderToStaticMarkup(
      <BorrowedSourceNote label={DUE_DATE_FROM_DOMESTIC_ORDER_LABEL} />
    );
    assert.equal(html, MARKUP_BEFORE_EXTRACTION);
  });

  test("🔵 일부러 깨 보면 잡힌다 — 다른 글자를 넣으면 어긋난다", () => {
    // 위 단언이 실제로 무는지를 보인다. 글자는 조각의 입력이라 여기서만 지어낸다.
    const html = renderToStaticMarkup(<BorrowedSourceNote label="시험용 다른 말" />);
    assert.notEqual(html, MARKUP_BEFORE_EXTRACTION);
    // 그래도 **옷은 그대로**다 — 바뀌는 것은 글자뿐이다.
    assert.ok(html.startsWith(MARKUP_BEFORE_EXTRACTION.split(">")[0]));
  });
});

describe("② 옛 사본이 화면 파일에 남아 있지 않다", () => {
  test("🔴 상자의 className 이 화면 파일에 다시 적혀 있지 않다", () => {
    // 두 벌이 되면 언젠가 한쪽만 고쳐지고, 설정 화면의 보기만 옛 모양으로 남는다.
    assert.equal(
      sectionSource.includes("mt-1 mr-1 inline-block whitespace-nowrap rounded"),
      false,
      "떼어낸 상자의 옷이 화면 파일에 그대로 남아 있다"
    );
  });

  test("🔴 화면이 **그 조각을 불러서** 그린다", () => {
    assert.ok(
      sectionCode.includes('from "@/components/repair-cases/BorrowedSourceNote"'),
      "화면이 떼어낸 조각을 가져오지 않는다"
    );
    assert.ok(
      sectionCode.includes("<BorrowedSourceNote label={borrowedLabel} />"),
      "화면이 그 조각에 빌려 온 값의 글자를 안 넘긴다"
    );
  });
});

describe("③ 🔴 「언제 그리는가」는 화면에 남고, 조각은 설정을 모른다", () => {
  test("🔴 관문 · 배지 키 · 자리 키가 셋 다 화면 파일 것이다", () => {
    for (const marker of [
      "BadgeVisibilityGate",
      'badgeKey="dueDateFromDomesticOrder"',
      "placeKey={borrowedLabelPlaceKey}",
      'borrowedLabelPlaceKey="repairCaseDetailBasicInfo"',
    ]) {
      assert.ok(sectionCode.includes(marker), `화면 파일에서 '${marker}' 가 사라졌다`);
    }
    // 🔴 관문 **안에** 조각이 들어 있다 — 밖으로 나가면 끄는 설정이 안 듣는다.
    const gateAt = sectionCode.indexOf("<BadgeVisibilityGate");
    const noteAt = sectionCode.indexOf("<BorrowedSourceNote");
    const gateEnd = sectionCode.indexOf("</BadgeVisibilityGate>");
    assert.ok(gateAt >= 0 && noteAt > gateAt && noteAt < gateEnd, "조각이 관문 밖으로 나갔다");
  });

  test("🔴 떼어낸 조각은 판정도 자리도 모른다 — 보기 배지가 사는 길이다", () => {
    for (const forbidden of [
      "placeKey",
      "BadgeVisibilityGate",
      "useIsBadgeVisible",
      "isBadgeVisible",
      "badgeKey",
    ]) {
      assert.equal(
        noteCode.includes(forbidden),
        false,
        `떼어낸 조각이 '${forbidden}' 를 안다 — 설정 화면의 보기 배지가 함께 꺼진다`
      );
    }
  });

  test("🔴 글자를 조각이 짓지 않는다 — 받아서 그린다", () => {
    assert.equal(
      noteCode.includes(DUE_DATE_FROM_DOMESTIC_ORDER_LABEL),
      false,
      `글자가 조각에 박혔다("${DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}") — 도메인 상수를 받을 것`
    );
    assert.ok(
      sectionCode.includes("DUE_DATE_FROM_DOMESTIC_ORDER_LABEL"),
      "화면이 도메인 상수를 안 쓴다"
    );
  });
});
