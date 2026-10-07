import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ============================================================================
 * 견적서 목록 — 🔴 **한 벌인가**, 그리고 A/S 에만 있던 열한 가지가 살아 있는가
 * ============================================================================
 * 2026-10-07(설계서 G절 조각 4)에 이 저장소의 868줄짜리 목록 화면을 지우고 **공용
 * 묶음의 한 벌**(`@dss/core/ui/quotes/QuoteListScreen` — vendor/dss-core 서브모듈)로
 * 갈아탔다. PO/내자 사이트가 2026-09-21 부터 쓰던 바로 그 화면이다.
 *
 * 이 시험이 지키는 것은 셋이다.
 *
 *  1. 🔴 **화면이 한 벌이다.** 이 저장소에 복사본이 다시 생기면 「금액 · 요약 줄이
 *     갈라지는 날」이 오고, 그날 사람은 같은 견적서의 **다른 금액**을 두 화면에서
 *     보게 된다(설계서 F절 5번). 아래 첫 묶음이 그 복사본이 없는지 본다 —
 *     🔴 **되돌아감을 막는 유일한 울타리다.**
 *
 *  2. 🔴 **A/S 에만 있던 열한 가지가 하나도 사라지지 않았다.** 전부 화면이 비워 둔
 *     **슬롯**으로 옮겨 갔을 뿐이다. 두 번째 묶음이 그 열하나를 하나씩 짚는다.
 *
 *  3. 옛 시험(QuoteListScreen.test.ts)이 재던 약속 — 줄 링크 · 미리보기 · 휴지통 ·
 *     [새 견적서] 팝업 · [Excel 보기] — 을 **그대로** 잰다. 자리만 옮겨 적었다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 목록은 **서버 액션을 프롭으로 받는 클라이언트 컴포넌트**이고 page.tsx 는 그 사슬
 * 끝에 `server-only` 를 단다 — react-server 조건 없이 도는 이 러너에서는 import
 * 자체가 던진다. 게다가 카드는 정적 렌더로 그려지지 않는다(표가 먼저 나온다).
 * 그래서 이웃 시험(users/approval-route-section.test.ts)과 같은 방법으로 원본을
 * 글자로 읽는다.
 *
 * ⚠️ **서브모듈 원본도 읽는다.** 이 저장소에서 실제로 도는 코드가 그것이라, 슬롯이
 * 표와 카드 두 곳에 같이 걸리는지는 거기서만 볼 수 있다. 🔴 읽기만 한다 — 그 파일을
 * 고치는 것은 이 저장소의 일이 아니다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 아래 줄바꿈 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 주석을 뺀 코드. 🔴 「없어졌는가」를 재는 단언에 필요하다 — 이 저장소의 머리말들은
 * **없앤 것을 일부러 설명한다**(「받기 링크는 2026-10-06 에 없앴다 — GET …/xlsx」).
 * 원본을 그대로 훑으면 그 설명이 금지 낱말로 걸린다.
 */
const codeOf = (source: string) =>
  flat(source.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " "));

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

/** 🔴 공용 묶음의 목록 화면 — 이 저장소에서 **실제로 도는** 그 화면이다. */
const SCREEN_PATH = "vendor/dss-core/src/ui/quotes/QuoteListScreen.tsx";
const screenSource = read(SCREEN_PATH);
/** 함수 슬롯을 거는 얇은 클라이언트 조각 — A/S 에만 있는 것은 전부 여기로 왔다. */
const slotsSource = read("src/components/quotes/QuoteListSlots.tsx");
const excelButtonSource = read("src/components/quotes/QuoteArchiveExcelOpenButton.tsx");
const tabPageSource = read("src/app/(app)/repair-cases/[id]/quotes/page.tsx");
const quotesPageSource = read("src/app/(app)/quotes/page.tsx");
const editPageSource = read("src/app/(app)/quotes/[id]/page.tsx");
const printPageSource = read("src/app/(app)/quotes/[id]/print/page.tsx");

/** 두 페이지가 화면에 넘기는 것 — 함수 슬롯이 섞여 있으면 화면이 통째로 죽는다. */
const quotesPageCall = flat(sliceBetween(quotesPageSource, "<QuoteListSlots", "/>\n  );"));
const tabPageCall = flat(sliceBetween(tabPageSource, "<QuoteListSlots", "/>\n\n"));

/** 화면이 슬롯을 거는 두 자리 — 표와 카드. 한쪽만 걸리면 창 폭에 따라 달라진다. */
const tableSource = flat(sliceBetween(screenSource, "function QuoteTable(", "function QuoteCardList("));
const cardSource = flat(sliceBetween(screenSource, "function QuoteCardList(", "function SummaryLine("));

describe("🔴 화면은 한 벌이다 — 이 저장소에 복사본을 두지 않는다", () => {
  test("🔴 이 저장소에 같은 화면의 복사본이 없다", () => {
    // 복사본이 생기는 날, 두 화면은 조용히 갈라지기 시작한다 — 그리고 그 차이는
    // 「같은 견적서의 다른 금액」으로 한참 뒤에 드러난다(설계서 F절 5번).
    assert.equal(
      existsSync(fileURLToPath(new URL("src/components/quotes/QuoteListScreen.tsx", repoUrl))),
      false,
      "src/components/quotes/QuoteListScreen.tsx — 서브모듈로 옮긴 화면의 복사본이 돌아왔다"
    );

    // 🔴 이름만 바꿔 다른 자리에 두는 것도 막는다 — src 전체에서 같은 이름을 찾는다.
    const found: string[] = [];
    const walk = (dir: URL, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        if (entry.isDirectory()) {
          walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        } else if (entry.name === "QuoteListScreen.tsx") {
          found.push(`${prefix}${entry.name}`);
        }
      }
    };
    walk(new URL("src/", repoUrl), "src/");
    assert.deepEqual(found, [], `목록 화면의 복사본이 남아 있다: ${found.join(", ")}`);
  });

  test("목록 화면은 서브모듈(vendor/dss-core)에서 들여온다 — 두 부르는 쪽 모두", () => {
    assert.ok(
      slotsSource.includes('from "@dss/core/ui/quotes/QuoteListScreen"'),
      "QuoteListSlots 가 서브모듈의 목록 화면을 쓰지 않는다"
    );
    for (const [name, source] of [
      ["견적서 목록", quotesPageSource],
      ["수리 건 「견적서」 탭", tabPageSource],
    ] as const) {
      assert.ok(
        source.includes('from "@/components/quotes/QuoteListSlots"'),
        `${name} 이 함수 슬롯을 거는 클라이언트 조각을 쓰지 않는다`
      );
    }
    // 그 화면이 실제로 거기 있어야 한다 — 서브모듈이 비어 있으면 여기서 깨진다.
    assert.equal(existsSync(fileURLToPath(new URL(SCREEN_PATH, repoUrl))), true, "서브모듈의 화면이 없다");
  });

  test("🔴 서브모듈의 화면은 사이트 별칭(@/…)을 쓰지 않는다", () => {
    // 별칭은 가져다 쓰는 사이트마다 다르게 설정돼 있다. 한 줄이라도 섞이면 두 사이트
    // 가운데 한쪽에서만 깨진다.
    assert.equal(/from "@\//.test(screenSource), false, "서브모듈 화면에 @/ 별칭 import 가 있다");
  });
});

/**
 * ============================================================================
 * 🔴 함수 슬롯은 **서버 컴포넌트에서 못 건넨다** (PO 가 2026-09-21 눈 확인에서 잡았다)
 * ============================================================================
 * `page.tsx` 에서 `rowHref` 를 곧바로 넘겼더니 화면이 통째로 죽었다 — "Functions
 * cannot be passed directly to Client Components…". page.tsx 는 서버 컴포넌트이고
 * 목록 화면은 `"use client"` 라, 그 경계를 넘는 값은 직렬화되어야 한다. 휴지통 액션은
 * **서버 액션**이라 넘어간다(같은 「함수」가 아니다).
 *
 * 🔴 **tsc 도 lint 도 이것을 잡지 못한다.** 그래서 여기서 글자로 본다.
 * ============================================================================
 */
describe("🔴 함수 슬롯은 클라이언트 조각(QuoteListSlots)이 건다", () => {
  test('QuoteListSlots 가 "use client" 다 — 아니면 함수를 걸 수 없다', () => {
    assert.ok(slotsSource.startsWith('"use client";'), '첫 줄이 "use client" 가 아니다');
  });

  test("🔴 두 페이지 모두 함수 슬롯 넷을 하나도 넘기지 않는다 — 넘기면 화면이 죽는다", () => {
    for (const [name, call] of [
      ["견적서 목록", quotesPageCall],
      ["수리 건 「견적서」 탭", tabPageCall],
    ] as const) {
      for (const slot of ["rowHref=", "intakeHref=", "renderFileBadges=", "renderRowActions="]) {
        assert.equal(
          call.includes(slot),
          false,
          `${name} — ${slot} 를 서버 컴포넌트에서 넘기고 있다. QuoteListSlots 에 걸 것`
        );
      }
    }
  });

  test("🔴 타입이 그것을 막는다 — PassThroughProps 가 함수 슬롯 넷을 뺀다", () => {
    assert.ok(
      flat(slotsSource).includes(
        'type PassThroughProps = Omit< ComponentProps<typeof QuoteListScreen>, "rowHref" | "intakeHref" | "renderFileBadges" | "renderRowActions" >;'
      ),
      "함수 슬롯 넷을 타입에서 빼지 않는다 — page.tsx 가 그것을 넘길 수 있게 된다"
    );
  });

  test("🔴 슬롯은 표와 카드 **두 곳 모두**에 걸린다 — 창 폭에 따라 달라지지 않게", () => {
    for (const [name, source] of [["표", tableSource], ["카드", cardSource]] as const) {
      assert.ok(source.includes("{renderRowActions?.(row)}"), `${name} 에 줄 단추 슬롯이 없다`);
      assert.ok(source.includes("{renderFileBadges?.(row)}"), `${name} 에 파일 딱지 슬롯이 없다`);
      assert.ok(source.includes("rowHref={rowHref}"), `${name} 에 줄 링크 슬롯이 없다`);
      assert.ok(source.includes("intakeHref={intakeHref}"), `${name} 에 인수번호 슬롯이 없다`);
    }
    // 화면이 두 조각에 같은 값을 넘긴다 — 한쪽만 넘기면 폭에 따라 보이는 것이 달라진다.
    const screen = flat(sliceBetween(screenSource, "<ResponsiveList", "/>\n      )}"));
    const tableProps = sliceBetween(screen, "<QuoteTable", "/>");
    const cardProps = sliceBetween(screen, "<QuoteCardList", "/>");
    for (const props of [tableProps, cardProps]) {
      for (const slot of ["rowHref={rowHref}", "intakeHref={intakeHref}", "renderFileBadges={renderFileBadges}", "renderRowActions={renderRowActions}"]) {
        assert.ok(props.includes(slot), `목록에 ${slot} 가 전달되지 않는다: ${props}`);
      }
    }
  });
});

/**
 * ============================================================================
 * 🔴 **A/S 에만 있던 열한 가지** — 하나도 사라지지 않았다 (2026-10-07)
 * ============================================================================
 * 868줄을 지운 조각이라, 「그래서 무엇이 없어졌나」를 여기서 못 박는다. 답은
 * **아무것도 없어지지 않았다** 이고, 전부 슬롯으로 자리를 옮겼을 뿐이다.
 * ============================================================================
 */
describe("🔴 A/S 에만 있던 열한 가지가 전부 살아 있다", () => {
  const slots = flat(slotsSource);

  test("① 휴지통 세 조작 — 서버 액션을 page.tsx 가 넘긴다(화면은 DB 를 모른다)", () => {
    assert.ok(quotesPageCall.includes("deleteQuote: deleteQuoteAction"), "휴지통 보내기 액션이 넘어가지 않는다");
    assert.ok(quotesPageCall.includes("restoreQuote: restoreQuoteAction"), "되살리기 액션이 넘어가지 않는다");
    assert.ok(
      quotesPageCall.includes("permanentlyDeleteQuote: permanentlyDeleteQuoteAction"),
      "완전 삭제 액션이 넘어가지 않는다"
    );
    assert.ok(
      flat(quotesPageSource).includes(
        'import { deleteQuoteAction, permanentlyDeleteQuoteAction, restoreQuoteAction, } from "@/lib/server/actions/quotes";'
      ),
      "page.tsx 가 서버 액션을 들여오지 않는다"
    );
  });

  test("② [새 견적서] 단추와 팝업 — newQuoteControl 슬롯으로", () => {
    assert.ok(slots.includes("export function NewQuoteControl({ baseHref }: { baseHref: string }) {"), slots);
    assert.ok(slots.includes('import NewQuoteDialog from "./NewQuoteDialog";'), "팝업을 들여오지 않는다");
    assert.ok(quotesPageCall.includes("newQuoteControl="), "목록의 [새 견적서] 자리가 비어 있다");
    assert.ok(tabPageCall.includes("newQuoteControl="), "탭의 [새 견적서] 자리가 비어 있다");
    // 🔴 권한 갈래는 화면이 든다 — `{canEdit && newQuoteControl}`.
    assert.ok(flat(screenSource).includes("{canEdit && newQuoteControl}"), "화면이 수정 권한으로 가르지 않는다");
  });

  test("③ 새 견적서 주소 — 슬롯 안쪽이 그 주소를 안다(기본은 `/quotes/new`)", () => {
    assert.ok(
      quotesPageCall.includes('newQuoteControl={<NewQuoteControl key="new-quote" baseHref="/quotes/new" />}'),
      "견적서 목록이 기본 주소를 넘기지 않는다(key 가 빠졌을 수도 있다)"
    );
    assert.ok(
      tabPageCall.includes('<NewQuoteControl key="new-quote" baseHref={newQuoteHrefForRepairCase({'),
      "탭이 그 건의 주소를 넘기지 않는다(key 가 빠졌을 수도 있다)"
    );
    assert.ok(
      flat(slotsSource).includes("<NewQuoteDialog baseHref={baseHref} onCancel={() => setIsNewQuoteDialogOpen(false)} />"),
      "팝업이 받은 주소를 그대로 쓰지 않는다"
    );
  });

  test("④ 접수 건 id 를 실은 수정 · 인쇄 주소 — rowHref · renderRowActions 로", () => {
    assert.ok(
      slots.includes("rowHref={(row) => quoteEditHref({ quoteId: row.id, repairCaseId: quoteLinkRepairCaseId })}"),
      "줄 링크가 quoteEditHref 를 쓰지 않는다"
    );
    assert.ok(
      slots.includes('import { quoteEditHref, quotePrintHref } from "@/lib/domain/quote-new-link";'),
      "주소 짓는 규칙을 공용 함수에서 가져오지 않는다"
    );
    assert.ok(slots.includes("<PreviewLink row={row} repairCaseId={quoteLinkRepairCaseId} />"), slots);
  });

  test("⑤ 파일 딱지(QuoteFileBadges) — renderFileBadges 슬롯으로", () => {
    assert.ok(slots.includes("renderFileBadges={(row) => <QuoteFileBadges row={row} />}"), slots);
    assert.ok(slots.includes('import { QuoteFileBadges } from "./QuoteAttachmentParts";'), "딱지 조각을 들여오지 않는다");
  });

  test("⑥ [미리보기 · PDF](PreviewLink) — renderRowActions 슬롯으로", () => {
    const preview = flat(sliceBetween(slotsSource, "function PreviewLink(", "\n}\n"));
    assert.ok(preview.includes("href={quotePrintHref({ quoteId: row.id, repairCaseId })}"), preview);
    assert.ok(preview.includes("미리보기 · PDF"), preview);
    assert.ok(preview.includes("if (!canRenderQuoteDocument(row)) return null;"), preview);
    assert.ok(
      preview.includes(
        'className="inline-block rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"'
      ),
      "미리보기 단추의 상자 모양이 바뀌었다"
    );
    assert.equal(flat(slotsSource).split("<PreviewLink ").length - 1, 1, "미리보기를 부르는 곳이 하나가 아니다");
  });

  test("⑦ [Excel 보기] — 제 파일로 나왔고 renderRowActions 슬롯에 선다", () => {
    assert.equal(
      existsSync(fileURLToPath(new URL("src/components/quotes/QuoteArchiveExcelOpenButton.tsx", repoUrl))),
      true,
      "[Excel 보기] 조각이 없다"
    );
    assert.ok(
      slots.includes('import QuoteArchiveExcelOpenButton from "./QuoteArchiveExcelOpenButton";'),
      "[Excel 보기] 조각을 제 파일에서 가져오지 않는다"
    );
    assert.ok(slots.includes("<QuoteArchiveExcelOpenButton row={row} />"), slots);
  });

  test("⑧ 그 단추가 쓰던 도우미 넷도 함께 옮겨 갔다", () => {
    const button = flat(excelButtonSource);
    for (const moved of [
      "const subscribeToNothing = () => () => {};",
      "const isWindowsDesktopNow = () =>",
      "const hiddenOnServer = () => false;",
      "const EXCEL_NOTICE_TONE_CLASS: Record<QuoteIssueNoticeTone, string>",
      "function ExcelNoticeLines({ lines }: { lines: readonly QuoteIssueNoticeLine[] }) {",
    ]) {
      assert.ok(button.includes(moved), `[Excel 보기]가 쓰던 조각이 사라졌다: ${moved}`);
    }
  });

  test("⑨ 앱 양식 없는 종류의 곁말(DocumentUnsupportedNote) — renderRowActions 슬롯으로", () => {
    const note = codeOf(sliceBetween(slotsSource, "function DocumentUnsupportedNote(", "\n}\n"));
    assert.ok(note.includes("if (canRenderQuoteDocument(row)) return null;"), note);
    assert.ok(note.includes("title={QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE}"), note);
    assert.equal(note.includes("canEdit"), false, "권한 갈래가 생겼다");
    assert.equal(note.includes("disabled"), false, "곁말이 꺼진 단추가 되었다");
    assert.ok(slots.includes("<DocumentUnsupportedNote row={row} />"), slots);
  });

  test("⑩ 인수번호 링크 — 🔴 같은 사이트라 **상대 주소**다(PO 처럼 절대 주소를 짓지 않는다)", () => {
    assert.ok(slots.includes("intakeHref={(row) => `/repair-cases/${row.repairCaseId}`}"), slots);
    // 🔴 저쪽(PO)은 설정으로 받은 기준 주소로 절대 주소를 짓는다 — 베껴 오면 이 사이트의
    //    같은 탭으로 가는 링크가 바깥 주소가 된다.
    const slotsCode = codeOf(slotsSource);
    assert.equal(slotsCode.includes("asAppBaseUrl"), false, "이 사이트가 제 주소를 설정으로 받고 있다");
    assert.equal(slotsCode.includes("buildRepairCaseUrl"), false, "PO 의 절대 주소 규칙을 베껴 왔다");
  });

  test("⑪ 요약 줄은 **언제나 링크**다 — rowHref 가 null 을 돌려주지 않는다", () => {
    // 🔴 공용 화면은 rowHref 가 null 이면 같은 자리에 글자만 그린다(SummaryLine).
    //    PO 는 `canEdit` 으로 가르지만 이 저장소는 가르지 않았고, 그 동작을 지킨다.
    const rowHref = codeOf(sliceBetween(slotsSource, "rowHref={(row) =>", "intakeHref="));
    assert.equal(rowHref.includes("null"), false, "줄 링크가 조건에 따라 글자가 된다 — 지금까지와 달라진다");
    assert.equal(rowHref.includes("canEdit"), false, "줄 링크가 수정 권한으로 갈린다 — PO 쪽 동작이다");
    for (const [name, source] of [["표", tableSource], ["카드", cardSource]] as const) {
      assert.ok(source.includes("<SummaryLine row={row} rowHref={rowHref}"), `${name} 의 요약 줄이 슬롯을 안 쓴다`);
    }
  });
});

describe("목록의 줄 링크", () => {
  test("🔴 옛 고정 주소가 되살아나지 않았다", () => {
    for (const [name, source] of [
      ["슬롯", flat(slotsSource)],
      ["화면", flat(screenSource)],
    ] as const) {
      assert.equal(source.includes("href={`/quotes/${row.id}`}"), false, `${name} 에 옛 고정 주소가 남아 있다`);
      assert.equal(source.includes("href={`/quotes/${row.id}/print`}"), false, `${name} 에 옛 고정 미리보기 주소가 남아 있다`);
    }
  });

  test("🔴 기본값은 null 이다 — 견적서 목록의 줄 링크는 지금까지의 `/quotes/{id}` 그대로", () => {
    // null 일 때 quoteEditHref 가 `/quotes/{id}` 를 그대로 돌려주는 것은 도메인 시험이 값으로 본다.
    assert.ok(
      flat(slotsSource).includes("export default function QuoteListSlots({ quoteLinkRepairCaseId = null, ...props }: QuoteListSlotsProps) {"),
      "접수 건 id 의 기본값이 null 이 아니다"
    );
    assert.ok(
      flat(slotsSource).includes("type QuoteListSlotsProps = PassThroughProps & { quoteLinkRepairCaseId?: string | null };"),
      "접수 건 id 를 받는 타입이 없거나 null 을 받지 않는다"
    );
  });

  test("🔴 xlsx 받기 링크는 없다 — 2026-10-06 에 걷어냈다", () => {
    for (const [name, source] of [
      ["슬롯", codeOf(slotsSource)],
      ["[Excel 보기]", codeOf(excelButtonSource)],
      ["화면", codeOf(screenSource)],
    ] as const) {
      assert.equal(source.includes("/xlsx"), false, `${name} 에 받기 링크가 되살아났다`);
      assert.equal(source.includes("견적서 받기"), false, `${name} 에 [견적서 받기] 가 되살아났다`);
    }
  });
});

describe("부르는 쪽", () => {
  test("「견적서」 탭은 그 건의 id 를 넘긴다", () => {
    assert.ok(tabPageCall.includes("quoteLinkRepairCaseId={resolved.id}"), "탭이 건의 id 를 넘기지 않는다");
  });

  test("🔴 견적서 목록은 넘기지 않는다 — 기본값 그대로", () => {
    assert.ok(!quotesPageSource.includes("quoteLinkRepairCaseId"), "견적서 목록이 건의 id 를 넘긴다");
  });

  test("🔴 수정 화면은 읽어 온 견적서와 맞춰 본 뒤 돌아갈 곳을 폼에 넘긴다", () => {
    const body = flat(editPageSource);
    assert.match(
      body,
      /const returnHref = returnHrefForEditQuote\(searchParams \? await searchParams : undefined, quote\);/
    );
    assert.ok(body.includes("returnHref={returnHref}"), "폼에 돌아갈 곳이 넘어가지 않는다");
    // 견적서를 읽고(없으면 404) 난 **뒤에** 정한다 — 그 견적서의 건과 맞춰 봐야 하므로.
    const loaded = body.indexOf("if (!quote) notFound();");
    const decided = body.indexOf("const returnHref = returnHrefForEditQuote(");
    assert.ok(loaded >= 0 && decided > loaded, "돌아갈 곳을 견적서를 읽기 전에 정한다");
  });

  test("수정 화면의 권한 검사·redirect·notFound 순서는 그대로다", () => {
    const body = flat(editPageSource);
    const order = [
      'await requireAreaAccessForCurrentUser("quotes");',
      "if (!isValidQuoteId(id)) notFound();",
      'if (!canEdit) redirect("/quotes");',
      "const quote = await getQuoteForEdit(id);",
      "if (!quote) notFound();",
    ].map((marker) => {
      const at = body.indexOf(marker);
      assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
      return at;
    });
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] > order[i - 1], "권한 검사·조회 순서가 바뀌었다");
    }
  });

  test("🔴 인쇄 화면도 읽어 온 견적서와 맞춰 본 뒤 돌아가기 주소를 미리보기에 넘긴다", () => {
    const body = flat(printPageSource);
    assert.match(
      body,
      /const backHref = returnHrefForQuotePrint\(searchParams \? await searchParams : undefined, quote\);/
    );
    assert.ok(body.includes("backHref={backHref}"), "미리보기에 돌아가기 주소가 넘어가지 않는다");
    const loaded = body.indexOf("if (!quote) notFound();");
    const decided = body.indexOf("const backHref = returnHrefForQuotePrint(");
    assert.ok(loaded >= 0 && decided > loaded, "돌아가기 주소를 견적서를 읽기 전에 정한다");
  });

  test("🔴 「견적서」 탭은 휴지통을 넘기지 않는다 — 되살리고 완전 삭제하는 자리는 견적서 목록 하나다", () => {
    assert.ok(tabPageCall.includes("trashRows={[]}"), "탭이 휴지통 줄을 넘긴다");
    assert.ok(tabPageCall.includes("canDelete={false}"), "탭이 삭제 권한을 넘긴다");
  });

  test("인쇄 화면의 권한 검사·notFound 순서는 그대로다", () => {
    const body = flat(printPageSource);
    const order = [
      'await requireAreaAccessForCurrentUser("quotes");',
      "if (!isValidQuoteId(id)) notFound();",
      "const quote = await getQuoteForEdit(id);",
      "if (!quote) notFound();",
    ].map((marker) => {
      const at = body.indexOf(marker);
      assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
      return at;
    });
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] > order[i - 1], "권한 검사·조회 순서가 바뀌었다");
    }
  });
});

/**
 * ============================================================================
 * 휴지통 — 다른 휴지통과 같은 루틴 (2026-09-11 사용자 결정)
 * ============================================================================
 * 처음에는 보내기·되살리기만 있었고 "견적서는 자동으로 완전히 삭제되지 않습니다"가
 * 창에 적혀 있었다. 이제 15일 보관 → 관리자 완전 삭제 → 기한이 지나면 정리
 * 스크립트가 지운다(mutations/quote-trash.ts). 자료의 규칙은 통합 시험이 실제 DB 로
 * 본다(mutations/quote-trash.integration.test.ts). 여기서 지키는 것은 화면 쪽 약속이다.
 *
 * 🔴 화면이 서브모듈로 옮겨 가면서 **읽는 파일이 바뀌었다** — 재는 것은 그대로다.
 * 확인 창도 그 화면이 쓰는 것(서브모듈의 공용 창)을 읽는다. 이 저장소의 같은 이름
 * 파일은 **다른 화면 열 곳이 아직 쓰고 있어** 그대로 남아 있다(조각 4 의 일이 아니다).
 * ============================================================================
 */
describe("휴지통 — 만료 배지 · 완전 삭제", () => {
  const actionSource = read("src/lib/server/actions/quotes.ts");
  const dialogsSource = read("vendor/dss-core/src/ui/common/master-data-trash-dialogs.tsx");
  const trashListSource = sliceBetween(screenSource, "function QuoteTrashList(", "function formatDeletedAt(");

  test("🔴 휴지통의 줄마다 만료 배지와 [완전 삭제] 가 선다", () => {
    const body = flat(trashListSource);
    assert.ok(
      body.includes("{row.deletedAt !== null && <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />}"),
      "휴지통 줄에 만료 배지가 없다"
    );
    assert.ok(body.includes("onClick={() => onPermanentDelete(row)}"), "휴지통 줄에 [완전 삭제] 가 없다");
    assert.ok(body.includes("onClick={() => onRestore(row)}"), "휴지통 줄에서 [되살리기] 가 사라졌다");
  });

  test("휴지통 안내는 보관 일수를 판정 모듈에서 가져온다 — 숫자를 따로 적지 않는다", () => {
    assert.ok(
      flat(trashListSource).includes("삭제한 지 {MASTER_DATA_TRASH_RETENTION_DAYS}일이 지나면 자동으로 완전히 삭제됩니다."),
      "휴지통 안내가 보관 일수를 말하지 않는다"
    );
  });

  test("🔴 옛 문장(자동 완전 삭제 없음)이 남아 있지 않고, 보내기 창은 기본 보관 문장을 쓴다", () => {
    assert.equal(screenSource.includes("자동으로 완전히 삭제되지 않습니다"), false, "사실이 아닌 옛 문장이 남아 있다");
    const deleteDialog = flat(sliceBetween(screenSource, "<MasterDataDeleteDialog", "/>"));
    assert.equal(deleteDialog.includes("retentionNote="), false, "보내기 창이 기본 보관 문장(15일)을 덮는다");
    // 기본 문장 자체가 15일 뒤 자동 완전 삭제를 말한다 — 창 원본에서 그대로 확인한다.
    assert.ok(flat(dialogsSource).includes("15일이 지나면 자동으로 완전히 삭제"), "공용 창의 기본 보관 문장이 바뀌었다");
  });

  test("🔴 완전 삭제 창은 완전 삭제 액션으로 이어진다 — 확인 창을 거치고 confirm() 을 쓰지 않는다", () => {
    const dialog = flat(sliceBetween(screenSource, "<MasterDataPermanentDeleteDialog", "/>\n    </div>"));
    assert.ok(dialog.includes("onConfirm={() => void confirmPurge()}"), "완전 삭제 창이 confirmPurge 를 부르지 않는다");
    const confirmPurge = flat(sliceBetween(screenSource, "async function confirmPurge()", "const filtered = useMemo("));
    assert.ok(
      confirmPurge.includes("await trashActions.permanentlyDeleteQuote({"),
      "confirmPurge 가 부르는 쪽이 넘긴 완전 삭제 액션을 부르지 않는다"
    );
    assert.equal(/\bconfirm\s*\(/.test(screenSource), false, "브라우저 confirm() 을 부른다");
  });

  test("되살리기 창은 견적서에 맞는 문장을 넘기고, 공용 창의 기본 문장은 한 글자도 바뀌지 않았다", () => {
    const restoreDialog = flat(sliceBetween(screenSource, "<MasterDataRestoreDialog", "/>\n\n"));
    assert.ok(restoreDialog.includes("restoreNote="), "되살리기 창이 견적서 문장을 넘기지 않는다");
    assert.ok(
      dialogsSource.includes(
        "{restoreNote ?? <>복원하면 목록에 다시 나타나고, 접수·편집 화면에서도 다시 고를 수 있게 됩니다.</>}"
      ),
      "공용 되살리기 창의 기본 문장이 바뀌었다 — 고객사·제품 모델·부품 화면의 문구가 달라진다"
    );
  });

  test("🔴 완전 삭제 액션은 휴지통 관문(quotes MANAGE)을 먼저 지나고, 빈 사유를 막는다", () => {
    const gate = flat(sliceBetween(actionSource, "async function resolveDeletingUser()", "export async function deleteQuoteAction("));
    assert.ok(gate.includes('hasPermission(actingUser, "quotes", "MANAGE")'), "휴지통 관문이 MANAGE 가 아니다");

    const body = flat(sliceBetween(actionSource, "export async function permanentlyDeleteQuoteAction(", "} catch (err) {"));
    const gateAt = body.indexOf("await resolveDeletingUser()");
    const validateAt = body.indexOf("isValidQuoteId(");
    const reasonAt = body.indexOf('if (reason === "")');
    const mutationAt = body.indexOf("await permanentlyDeleteQuote({");
    assert.ok(gateAt >= 0, "완전 삭제 액션이 관문을 부르지 않는다");
    assert.ok(validateAt > gateAt, "완전 삭제 액션이 관문보다 검증을 먼저 한다");
    assert.ok(reasonAt > gateAt && mutationAt > reasonAt, "빈 사유를 거르기 전에 지운다");
  });

  test("휴지통의 줄은 지울 수 있는 세션에만 실어 보낸다(page.tsx)", () => {
    const page = flat(quotesPageSource);
    assert.ok(page.includes('hasPermission(actingUser, "quotes", "MANAGE")'), "page.tsx 의 canDelete 가 MANAGE 판정이 아니다");
    assert.ok(page.includes("canDelete ? listDeletedQuotes() : Promise.resolve([])"), "휴지통 조회가 canDelete 로 감싸여 있지 않다");
  });
});

/**
 * ============================================================================
 * [새 견적서] 팝업 (견적서 ⑤) — 머리의 단추 한 곳
 * ============================================================================
 * 단추는 곧바로 작성 화면으로 가지 않고 팝업을 연다. 팝업이 무엇을 그리고 [만들기]가 어느
 * 주소로 가는지는 NewQuoteDialog.test.tsx 가, 덧붙이는 규칙은 quote-new-link.test.ts 가 값으로
 * 본다. 여기서는 **그 팝업을 제자리에서, 넘겨받은 주소 그대로** 여는가를 본다.
 *
 * 🔴 조각이 화면 **안**에서 `newQuoteControl` **슬롯**으로 옮겨 갔다(2026-10-07) — 창을
 * 여닫는 상태는 서버 컴포넌트가 들 수 없어 클라이언트 조각이 들고, 슬롯 자체는 ReactNode 라
 * 서버 경계를 넘는다. 재는 것은 그대로다.
 * ============================================================================
 */
describe("[새 견적서] 팝업", () => {
  const control = flat(sliceBetween(slotsSource, "export function NewQuoteControl(", "\n}\n"));

  test("🔴 수정 권한이 없으면 단추도 팝업도 없다 — 지금과 같다", () => {
    // 갈래는 화면이 든다 — 슬롯을 그릴지 말지가 그 한 줄이다.
    assert.ok(flat(screenSource).includes("{canEdit && newQuoteControl}"), "화면이 수정 권한으로 가르지 않는다");
    assert.ok(control.includes("새 견적서 </button>"), control);
    assert.ok(control.includes("<NewQuoteDialog "), "팝업이 조각 밖에 있다");
    // 팝업은 이 한 곳에서만 그린다 — 다른 자리에서 그리면 권한 갈래를 건너뛴다.
    assert.equal(flat(slotsSource).split("<NewQuoteDialog ").length - 1, 1, "팝업을 그리는 곳이 하나가 아니다");
  });

  test("🔴 단추를 누르면 곧바로 가지 않고 팝업이 뜬다", () => {
    assert.ok(
      control.includes('<button type="button" onClick={() => setIsNewQuoteDialogOpen(true)} aria-haspopup="dialog"'),
      control
    );
    assert.ok(
      control.includes("{isNewQuoteDialogOpen && ( <NewQuoteDialog baseHref={baseHref} onCancel={() => setIsNewQuoteDialogOpen(false)} /> )}"),
      control
    );
    // 처음에는 닫혀 있다 — 목록을 열자마자 창이 뜨지 않는다.
    assert.ok(flat(slotsSource).includes("const [isNewQuoteDialogOpen, setIsNewQuoteDialogOpen] = useState(false);"));
    // 옛 「곧바로 가는 링크」가 남아 있으면 팝업을 건너뛰는 입구가 된다.
    assert.ok(!flat(slotsSource).includes("href={baseHref}"), "곧바로 가는 옛 링크가 남아 있다");
    assert.ok(!flat(slotsSource).includes("router.push(baseHref"), "팝업을 건너뛰고 가는 길이 있다");
  });

  test("🔴 [만들기]는 받은 주소에 두 값을 덧붙인 주소로 간다 — 조각은 받은 주소를 그대로 넘긴다", () => {
    // 수리 건 탭은 인수번호 · 건 id 를 실은 주소를 넘기고(아래), 팝업은 그 위에 두 값만 덧붙인다.
    const dialogSource = flat(read("src/components/quotes/NewQuoteDialog.tsx"));
    assert.ok(
      dialogSource.includes("href={newQuoteHrefWithStart(baseHref, { kind, excelOnly })}"),
      "[만들기]가 덧붙이는 규칙(newQuoteHrefWithStart)을 쓰지 않는다"
    );
    assert.ok(tabPageCall.includes("baseHref={newQuoteHrefForRepairCase({"), "탭이 그 건의 주소를 넘기지 않는다");
    // 견적서 목록은 기본 주소 `/quotes/new` 그대로다.
    assert.ok(quotesPageCall.includes('baseHref="/quotes/new"'), "견적서 목록이 작성 화면 주소를 넘기지 않는다");
    // 🔴 그 주소에 실제로 화면이 있어야 한다.
    assert.equal(
      existsSync(fileURLToPath(new URL("src/app/(app)/quotes/new/page.tsx", repoUrl))),
      true,
      "[새 견적서] 가 가리키는 작성 화면이 없다"
    );
  });
});

/**
 * ============================================================================
 * 줄마다의 [Excel 보기] — 공유폴더에 저장된 그 견적서의 엑셀을 연다 (2026-10-06 사용자 지시)
 * ============================================================================
 * 「견적서 목록에서 [미리보기 PDF] 옆에 [EXEL 보기]를 만들어서 폴더에 있는 해당 견적서를
 * 바로 열 수 있도록 해줘.」
 *
 * 누른 뒤의 흐름(어느 파일을 고르는가 · 무엇이라고 알리는가)은 값으로 도는 이웃 시험이
 * 본다(quote-archive-excel-open.test.ts). 여기서 지키는 것은 **화면 쪽 약속**이다:
 *  · 자리 = [미리보기 · PDF] 바로 오른쪽, **표와 카드 두 곳 모두**(한 슬롯이 두 곳에 걸린다)
 *  · 🔴 **누를 때 찾는다** — 목록을 그릴 때 공유폴더를 미리 읽지 않는다(줄 수만큼 NAS 를 때린다)
 *  · 🔴 **두 번 눌러도 두 번 열리지 않는다** — 찾는 동안 잠그고 눌린 것이 보인다
 *  · 🔴 [설치 명령 복사]를 끄지 않는다 · Windows 가 아니면 그리지 않는다
 *  · 🔴 [미리보기 · PDF]는 한 글자도 건드리지 않았다
 *
 * 🔴 2026-10-07 에 조각이 **제 파일로 나왔다**(QuoteArchiveExcelOpenButton.tsx) — 글자는
 * 그대로다. 읽는 파일만 바뀌었다.
 * ============================================================================
 */
describe("줄마다의 [Excel 보기]", () => {
  const EXCEL_CALL = "<QuoteArchiveExcelOpenButton row={row} />";
  const PREVIEW_CALL = "<PreviewLink row={row} repairCaseId={quoteLinkRepairCaseId} />";
  const buttonSource = flat(excelButtonSource);
  const rowActions = codeOf(sliceBetween(slotsSource, "renderRowActions={(row) =>", "renderFileBadges="));

  test("🔴 자리는 [미리보기 · PDF] 바로 오른쪽 — 한 슬롯이 표와 카드 두 곳에 걸린다", () => {
    assert.ok(
      flat(slotsSource).includes(
        `renderRowActions={(row) => ( <> ${PREVIEW_CALL} ${EXCEL_CALL} <DocumentUnsupportedNote row={row} /> </> )}`
      ),
      "줄 단추 슬롯이 채워지지 않았거나 모양이 다르다"
    );
    // 🔴 **차례도 잰다** — 사용자가 화면을 보고 지시한 것이라 뒤집히면 지시와 다른 것이 된다.
    assert.ok(
      rowActions.indexOf("<PreviewLink") < rowActions.indexOf("<QuoteArchiveExcelOpenButton"),
      "차례가 뒤집혔다 — [미리보기 · PDF] → [Excel 보기] 여야 한다"
    );
    assert.ok(
      rowActions.indexOf("<QuoteArchiveExcelOpenButton") < rowActions.indexOf("<DocumentUnsupportedNote"),
      "곁말이 [Excel 보기]보다 앞이다"
    );
    assert.equal(flat(slotsSource).split(EXCEL_CALL).length - 1, 1, "부르는 곳이 하나가 아니다");
    // 그 한 자리를 화면이 표와 카드 두 곳에 건다 — [삭제]는 그 다음 줄이다.
    assert.equal(flat(screenSource).split("{renderRowActions?.(row)}").length - 1, 2, "화면이 줄 단추 슬롯을 두 곳에 걸지 않는다");
    for (const [name, source] of [["표", tableSource], ["카드", cardSource]] as const) {
      assert.ok(
        source.includes("{renderRowActions?.(row)} {canDelete && <DeleteButton row={row}"),
        `${name} 에서 [삭제] 가 줄 단추 다음이 아니다: ${source}`
      );
    }
  });

  test("🔴 [미리보기 · PDF]는 그대로다 — 앱 양식이 없는 종류에는 여전히 안 내민다", () => {
    const previewSource = flat(sliceBetween(slotsSource, "function PreviewLink(", "\n}\n"));
    assert.ok(previewSource.includes("if (!canRenderQuoteDocument(row)) return null;"), previewSource);
    assert.ok(previewSource.includes("미리보기 · PDF"), previewSource);
    // [Excel 보기]는 그 판정을 **쓰지 않는다** — 사람이 손으로 넣어 둔 엑셀이 폴더에 있을 수
    // 있고, 공유폴더 사정은 눌러 보기 전에 알 수 없다. 눌렀을 때 사실대로 말한다.
    for (const branching of ["canRenderQuoteDocument", "isExcelOnly", "hasExcel", "canEdit"]) {
      assert.ok(!buttonSource.includes(branching), `[Excel 보기]가 줄의 값으로 갈린다: ${branching}`);
    }
  });

  test("🔴 목록을 그릴 때 공유폴더를 미리 읽지 않는다 — 누를 때 한 번 부른다", () => {
    for (const [name, source] of [
      ["[Excel 보기]", buttonSource],
      ["슬롯", flat(slotsSource)],
      ["화면", flat(screenSource)],
    ] as const) {
      assert.ok(!source.includes("useEffect"), `${name} 에 그릴 때 공유폴더를 읽는 효과가 생겼다`);
      assert.ok(!source.includes("loadQuoteArchiveFolderEntries"), `${name} 이 목록 통로를 직접 부른다`);
    }
    assert.equal(buttonSource.split("runQuoteArchiveExcelOpen(").length - 1, 1, "흐름을 부르는 곳이 하나가 아니다");
    assert.ok(
      buttonSource.includes("setOutcome(await runQuoteArchiveExcelOpen({ quoteId: row.id, quoteNumber: row.quoteNumber }));"),
      buttonSource
    );
  });

  test("🔴 두 번 눌러도 두 번 열리지 않는다 — 잠그고, 눌린 것이 보인다", () => {
    assert.ok(buttonSource.includes("async function handleOpen() {"), buttonSource);
    assert.ok(buttonSource.includes("if (busy) return; setBusy(true); setOutcome(null);"), buttonSource);
    assert.ok(buttonSource.includes("disabled={busy}"), buttonSource);
    assert.ok(buttonSource.includes("aria-busy={busy}"), buttonSource);
    assert.ok(buttonSource.includes('{busy ? "여는 중…" : "Excel 보기"}'), buttonSource);
    // 끝나면 반드시 풀린다 — 실패해도 단추가 영영 잠기지 않는다.
    assert.ok(buttonSource.includes("} finally { setBusy(false); }"), buttonSource);
  });

  test("🔴 결과는 그 줄 옆에 적는다 — 화면 위 띠(trashError)를 쓰지 않는다", () => {
    assert.ok(buttonSource.includes('<span role="status"'), buttonSource);
    assert.ok(!buttonSource.includes("setTrashError"), "줄마다의 결과를 화면 위 띠에 적는다");
    // 🔴 화면의 `notice` 슬롯도 쓰지 않는다 — 그것도 한 자리뿐인 알림이다.
    assert.equal(flat(slotsSource).includes("notice="), false, "줄마다의 결과를 화면 한 자리의 알림에 적는다");
  });

  test("🔴 [설치 명령 복사]를 끄지 않는다 — 여는 장치가 내는 값을 그대로 따른다", () => {
    assert.ok(buttonSource.includes("{outcome.offerHelperInstall && ("), buttonSource);
    assert.ok(buttonSource.includes("setCopyLines(await runQuoteFolderHelperInstallCommandCopy());"), buttonSource);
    assert.ok(buttonSource.includes("설치 명령 복사"), buttonSource);
  });

  test("🔴 Windows 가 아니면 그리지 않고, 인쇄에도 안 찍힌다 — 첫 렌더는 감춘다", () => {
    assert.ok(excelButtonSource.includes("const hiddenOnServer = () => false;"), "서버 렌더용 스냅샷이 없다");
    assert.ok(
      buttonSource.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)"),
      buttonSource
    );
    assert.ok(buttonSource.includes("if (!isWindows) return null;"), buttonSource);
    assert.ok(buttonSource.includes("print:hidden"), buttonSource);
  });

  test("🔴 화면이 파일을 만들거나 지우지 않는다 — 읽고 여는 것뿐이다", () => {
    for (const forbidden of ['method: "POST"', 'method: "DELETE"', "saveBlobAsDownload", ".blob(", "download="]) {
      assert.ok(!buttonSource.includes(forbidden), `[Excel 보기]가 '${forbidden}' 를 쓴다`);
    }
  });

  test("🔴 조각 자체는 서버 사슬을 부르지 않는다 — 목록 줄 타입도 들여오지 않는다", () => {
    assert.ok(!excelButtonSource.includes("@/lib/server/"), "[Excel 보기]가 서버 액션을 부른다");
    assert.ok(!excelButtonSource.includes('"server-only"'), "[Excel 보기]가 server-only 를 부른다");
    assert.ok(
      excelButtonSource.includes("export type QuoteArchiveExcelOpenRow = { id: string; quoteNumber: string };"),
      "쓰는 칸 둘만 받지 않는다 — 누르기 전에 아는 척하는 갈래가 생긴다"
    );
  });
});
