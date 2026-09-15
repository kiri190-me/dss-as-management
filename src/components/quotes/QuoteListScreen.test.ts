import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「견적서」 탭 → 수정 화면 → [취소] 가 그 탭으로 돌아오는가 — 화면이 규칙을 부르는가
 * ============================================================================
 * 주소를 만들고 돌아갈 곳을 정하는 규칙 자체는 도메인 시험이 값으로 본다
 * (lib/domain/quote-new-link.test.ts). 여기서 지키는 것은 **화면이 그 규칙을
 * 제자리에서 부르는가**다:
 *  · 목록의 줄 링크가 **표·카드 두 곳 모두** 같은 규칙으로 만들어진다 — 한쪽만
 *    바뀌면 창 폭에 따라(ResponsiveList 가 재서 고른다) 돌아가는 곳이 달라진다.
 *  · 기본값이면 PO/내자 목록의 줄 링크는 지금까지 그대로다(프롭 기본값 null).
 *  · [미리보기 · PDF] 도 **표·카드 두 곳 모두** 같은 값을 실어 인쇄 화면을 연다
 *    (기본값이면 옛 `/quotes/{id}/print` 그대로). xlsx 링크는 바뀌지 않는다.
 *  · 「견적서」 탭만 그 건의 id 를 넘기고, PO/내자 목록은 넘기지 않는다.
 *  · 수정 화면은 **읽어 온 견적서와 맞춰 본 뒤에** 돌아갈 곳을 정해 폼에 넘긴다.
 *  · 인쇄 화면도 같은 방식으로 「돌아가기」 주소를 정해 미리보기에 넘긴다 — 그래야
 *    탭 → 인쇄 → 돌아가기 → [취소] 가 끝까지 그 건으로 이어진다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * QuoteListScreen 은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**라, 그
 * 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 게다가 카드는 정적 렌더로 그려지지 않는다(표가 먼저
 * 나온다). 그래서 이웃 시험(users/approval-route-section.test.ts)과 같은 방법으로
 * 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 아래 줄바꿈 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 원본에서 **한 갈래만** 잘라낸다 — 파일 전체에 정규식을 걸면 이웃 갈래에 걸린다. */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const listSource = read("src/components/quotes/QuoteListScreen.tsx");
const tabPageSource = read("src/app/(app)/repair-cases/[id]/quotes/page.tsx");
const quotesPageSource = read("src/app/(app)/quotes/page.tsx");
const editPageSource = read("src/app/(app)/quotes/[id]/page.tsx");
const printPageSource = read("src/app/(app)/quotes/[id]/print/page.tsx");

const ROW_LINK = "href={quoteEditHref({ quoteId: row.id, repairCaseId: quoteLinkRepairCaseId })}";

const tableSource = flat(sliceBetween(listSource, "function QuoteTable(", "function QuoteCardList("));
const cardSource = flat(sliceBetween(listSource, "function QuoteCardList(", "function PreviewLink("));

describe("목록의 줄 링크", () => {
  test("🔴 표의 줄 링크는 접수 건 id 를 실을 수 있는 규칙으로 만든다", () => {
    assert.ok(tableSource.includes(ROW_LINK), "표의 줄 링크가 quoteEditHref 를 쓰지 않는다");
    assert.ok(!tableSource.includes("href={`/quotes/${row.id}`}"), "표에 옛 고정 주소가 남아 있다");
  });

  test("🔴 카드의 줄 링크도 같은 규칙이다 — 창 폭에 따라 돌아가는 곳이 달라지지 않게", () => {
    assert.ok(cardSource.includes(ROW_LINK), "카드의 줄 링크가 quoteEditHref 를 쓰지 않는다");
    assert.ok(!cardSource.includes("href={`/quotes/${row.id}`}"), "카드에 옛 고정 주소가 남아 있다");
  });

  test("표와 카드 둘 다 부르는 쪽이 넘긴 값을 받는다", () => {
    const screen = flat(sliceBetween(listSource, "<ResponsiveList", "/>\n      )}"));
    const tableProps = sliceBetween(screen, "<QuoteTable", "/>");
    const cardProps = sliceBetween(screen, "<QuoteCardList", "/>");
    for (const props of [tableProps, cardProps]) {
      assert.ok(
        props.includes("quoteLinkRepairCaseId={quoteLinkRepairCaseId}"),
        `목록에 값이 전달되지 않는다: ${props}`
      );
    }
  });

  test("🔴 기본값은 null 이다 — PO/내자 목록의 줄 링크는 지금까지의 `/quotes/{id}` 그대로", () => {
    // null 일 때 quoteEditHref 가 `/quotes/{id}` 를 그대로 돌려주는 것은 도메인 시험이 값으로 본다.
    const signature = flat(sliceBetween(listSource, "export default function QuoteListScreen(", "}) {"));
    assert.match(signature, /quoteLinkRepairCaseId = null,/);
  });

  test("xlsx 링크는 그대로다", () => {
    assert.ok(listSource.includes("href={`/api/quotes/${row.id}/xlsx`}"), "xlsx 주소가 바뀌었다");
  });
});

describe("[미리보기 · PDF] 링크", () => {
  const PREVIEW_CALL = "<PreviewLink id={row.id} repairCaseId={quoteLinkRepairCaseId} />";
  const previewSource = flat(sliceBetween(listSource, "function PreviewLink(", "function DeleteButton("));

  test("🔴 미리보기 링크는 접수 건 id 를 실을 수 있는 규칙으로 만든다", () => {
    // null 일 때 quotePrintHref 가 `/quotes/{id}/print` 를 그대로 돌려주는 것은 도메인 시험이 값으로 본다.
    assert.ok(
      previewSource.includes("href={quotePrintHref({ quoteId: id, repairCaseId })}"),
      "미리보기 링크가 quotePrintHref 를 쓰지 않는다"
    );
    assert.ok(!listSource.includes("href={`/quotes/${id}/print`}"), "옛 고정 미리보기 주소가 남아 있다");
  });

  test("🔴 표와 카드 두 곳 모두 줄 링크와 같은 값을 넘긴다 — 창 폭에 따라 돌아가는 곳이 달라지지 않게", () => {
    assert.ok(tableSource.includes(PREVIEW_CALL), "표의 미리보기 링크에 건 id 가 넘어가지 않는다");
    assert.ok(cardSource.includes(PREVIEW_CALL), "카드의 미리보기 링크에 건 id 가 넘어가지 않는다");
    // 값을 안 넘기는 부르기가 하나라도 남으면 그쪽만 맥락이 끊긴다.
    assert.ok(!flat(listSource).includes("<PreviewLink id={row.id} />"), "건 id 없이 부르는 곳이 남아 있다");
  });
});

describe("부르는 쪽", () => {
  test("「견적서」 탭은 그 건의 id 를 넘긴다", () => {
    const call = flat(sliceBetween(tabPageSource, "<QuoteListScreen", "/>\n  );"));
    assert.ok(call.includes("quoteLinkRepairCaseId={resolved.id}"), "탭이 건의 id 를 넘기지 않는다");
  });

  test("🔴 PO/내자 목록은 넘기지 않는다 — 기본값 그대로", () => {
    assert.ok(!quotesPageSource.includes("quoteLinkRepairCaseId"), "PO/내자 목록이 건의 id 를 넘긴다");
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

  test("🔴 「견적서」 탭은 휴지통을 넘기지 않는다 — 되살리고 완전 삭제하는 자리는 PO/내자 목록 하나다", () => {
    const call = flat(sliceBetween(tabPageSource, "<QuoteListScreen", "/>\n  );"));
    assert.ok(call.includes("trashRows={[]}"), "탭이 휴지통 줄을 넘긴다");
    assert.ok(call.includes("canDelete={false}"), "탭이 삭제 권한을 넘긴다");
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
 * ============================================================================
 */
describe("휴지통 — 만료 배지 · 완전 삭제", () => {
  const actionSource = read("src/lib/server/actions/quotes.ts");
  const dialogsSource = read("src/components/common/master-data-trash-dialogs.tsx");
  const trashListSource = sliceBetween(listSource, "function QuoteTrashList(", "function formatDeletedAt(");

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
    assert.equal(listSource.includes("자동으로 완전히 삭제되지 않습니다"), false, "사실이 아닌 옛 문장이 남아 있다");
    const deleteDialog = flat(sliceBetween(listSource, "<MasterDataDeleteDialog", "/>"));
    assert.equal(deleteDialog.includes("retentionNote="), false, "보내기 창이 기본 보관 문장(15일)을 덮는다");
    // 기본 문장 자체가 15일 뒤 자동 완전 삭제를 말한다 — 창 원본에서 그대로 확인한다.
    assert.ok(flat(dialogsSource).includes("15일이 지나면 자동으로 완전히 삭제"), "공용 창의 기본 보관 문장이 바뀌었다");
  });

  test("🔴 완전 삭제 창은 완전 삭제 액션으로 이어진다 — 확인 창을 거치고 confirm() 을 쓰지 않는다", () => {
    const dialog = flat(sliceBetween(listSource, "<MasterDataPermanentDeleteDialog", "/>\n    </div>"));
    assert.ok(dialog.includes("onConfirm={() => void confirmPurge()}"), "완전 삭제 창이 confirmPurge 를 부르지 않는다");
    const confirmPurge = flat(sliceBetween(listSource, "async function confirmPurge()", "const filtered = useMemo("));
    assert.ok(confirmPurge.includes("await permanentlyDeleteQuoteAction({"), "confirmPurge 가 완전 삭제 액션을 부르지 않는다");
    assert.equal(/\bconfirm\s*\(/.test(listSource), false, "브라우저 confirm() 을 부른다");
  });

  test("되살리기 창은 견적서에 맞는 문장을 넘기고, 공용 창의 기본 문장은 한 글자도 바뀌지 않았다", () => {
    const restoreDialog = flat(sliceBetween(listSource, "<MasterDataRestoreDialog", "/>\n\n"));
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
 * 본다. 여기서는 목록이 **그 팝업을 제자리에서, 넘겨받은 주소 그대로** 여는가를 본다.
 * 표 · 카드와는 무관하다 — 단추는 머리에 하나뿐이다.
 * ============================================================================
 */
describe("[새 견적서] 팝업", () => {
  const header = flat(
    sliceBetween(listSource, '<h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">견적서</h1>', "{/* 탭 자체가")
  );
  const newQuoteBranch = sliceBetween(header, "{canEdit && (", "</> )}");

  test("🔴 수정 권한이 없으면 단추도 팝업도 없다 — 지금과 같다", () => {
    assert.ok(header.includes("{canEdit && ( <> <button"), header);
    assert.ok(newQuoteBranch.includes("새 견적서 </button>"), newQuoteBranch);
    assert.ok(newQuoteBranch.includes("<NewQuoteDialog "), "팝업이 수정 권한 갈래 밖에 있다");
    // 팝업은 이 한 곳에서만 그린다 — 다른 자리에서 그리면 권한 갈래를 건너뛴다.
    assert.equal(flat(listSource).split("<NewQuoteDialog ").length - 1, 1, "팝업을 그리는 곳이 하나가 아니다");
  });

  test("🔴 단추를 누르면 곧바로 가지 않고 팝업이 뜬다", () => {
    assert.ok(
      newQuoteBranch.includes('<button type="button" onClick={() => setIsNewQuoteDialogOpen(true)} aria-haspopup="dialog"'),
      newQuoteBranch
    );
    assert.ok(
      newQuoteBranch.includes("{isNewQuoteDialogOpen && ( <NewQuoteDialog baseHref={newQuoteHref} onCancel={() => setIsNewQuoteDialogOpen(false)} /> )}"),
      newQuoteBranch
    );
    // 처음에는 닫혀 있다 — 목록을 열자마자 창이 뜨지 않는다.
    assert.ok(flat(listSource).includes("const [isNewQuoteDialogOpen, setIsNewQuoteDialogOpen] = useState(false);"));
    // 옛 「곧바로 가는 링크」가 남아 있으면 팝업을 건너뛰는 입구가 된다.
    assert.ok(!flat(listSource).includes("href={newQuoteHref}"), "곧바로 가는 옛 링크가 남아 있다");
    assert.ok(!flat(listSource).includes("router.push(newQuoteHref"), "팝업을 건너뛰고 가는 길이 있다");
  });

  test("🔴 [만들기]는 newQuoteHref 에 두 값을 덧붙인 주소로 간다 — 목록은 받은 주소를 그대로 넘긴다", () => {
    // 수리 건 탭은 인수번호 · 건 id 를 실은 주소를 넘기고(아래), 팝업은 그 위에 두 값만 덧붙인다.
    const dialogSource = flat(read("src/components/quotes/NewQuoteDialog.tsx"));
    assert.ok(
      dialogSource.includes("href={newQuoteHrefWithStart(baseHref, { kind, excelOnly })}"),
      "[만들기]가 덧붙이는 규칙(newQuoteHrefWithStart)을 쓰지 않는다"
    );
    const tabCall = flat(sliceBetween(tabPageSource, "<QuoteListScreen", "/>\n  );"));
    assert.ok(tabCall.includes("newQuoteHref={newQuoteHrefForRepairCase({"), "탭이 그 건의 주소를 넘기지 않는다");
    // PO/내자 목록은 넘기지 않는다 — 기본값 `/quotes/new` 그대로.
    assert.ok(!quotesPageSource.includes("newQuoteHref"), "PO/내자 목록이 새 견적서 주소를 따로 넘긴다");
    assert.match(flat(sliceBetween(listSource, "export default function QuoteListScreen(", "}) {")), /newQuoteHref = "\/quotes\/new",/);
  });
});
