import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mayEnterDeveloperMode } from "@/lib/auth/developer-mode-gate";
import { canDeleteServiceReports } from "@/lib/auth/service-report-authorization";

/**
 * ============================================================================
 * 보고서 완전 삭제 — **서버가 다시 보는가** (2026-10-28)
 * ============================================================================
 * 휴지통의 [완전 삭제] 는 되돌릴 수 없고, 대상은 **법인 직인이 찍혀 고객사로
 * 나간 문서**다. 그래서 문턱이 둘이다:
 *
 *     ① 접수 건 영역 MANAGE  (`canDeleteServiceReports`)
 *     ② 개발자 모드 관문      (`mayEnterDeveloperMode`)
 *
 * 화면도 ②로 단추를 감추지만 **그것은 경계가 아니다.** 서버 액션은 주소를 가진
 * 창구라, 단추를 감추는 것만으로는 아무것도 막지 못한다. 이 시험이 지키는 것이
 * 바로 그 한 줄이다 — 지우면 **아무 오류도 안 나고**, 화면은 그대로 멀쩡하며,
 * 뚫린 사실은 누군가 주소로 직접 부를 때까지 드러나지 않는다.
 *
 * ── 🔴 왜 값이 아니라 글자로 재나 ───────────────────────────────────────
 * 액션 파일은 `"use server"` 에 세션·DB 사슬을 물고 있어 값으로 부를 수 없다
 * (부르는 순간 세션과 DB 가 필요해진다 — 같은 폴더의
 * `notification-acknowledgements-source.test.ts` 가 같은 까닭으로 같은 방법을
 * 쓴다). 그래서 둘로 나눠 잰다:
 *   · **값으로** — 관문 함수 자체가 개발자 표시가 꺼진 사람에게 `false` 인가.
 *   · **글자로** — 액션이 바로 그 함수를, MANAGE 뒤·mutation 앞에서 부르는가.
 *
 * ── 🔴 주석을 반드시 걷어내고 센다 ──────────────────────────────────────
 * 이 기능의 파일들은 머리말에서 `mayEnterDeveloperMode` 를 **이름으로 여러 번
 * 설명한다**(일부러 그렇게 적었다). 주석을 둔 채 「부르는가」를 세면 관문을
 * 통째로 지워도 **주석만으로 영영 통과한다.** 이 저장소에서 실제로 겪은 실패다.
 * ============================================================================
 */

/** 주석을 걷어낸 **코드만**. 위 머리말의 '주석을 반드시 걷어내고 센다'. */
function codeOnly(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 원본에서 **한 갈래만** 잘라낸다. 🔴 자른 자리가 비어 있지 않은 것을 여기서
 * 확인한다 — 안 하면 이름이 바뀐 날 아무것도 안 보면서 초록으로 통과한다.
 */
function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `'${startMarker}' 뒤에서 '${endMarker}' 를 찾지 못했다`);
  const sliced = source.slice(start, end);
  assert.ok(sliced.trim().length > startMarker.length, `'${startMarker}' 갈래가 비어 있다`);
  return sliced;
}

/** 파일 **끝까지** 자른다 — 마지막 조각에는 뒤에 올 표지가 없다. */
function sliceFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const sliced = source.slice(start);
  assert.ok(sliced.trim().length > startMarker.length, `'${startMarker}' 갈래가 비어 있다`);
  return sliced;
}

const actionSource = codeOnly(read("src/lib/server/actions/service-reports.ts"));
const mutationSource = codeOnly(read("src/lib/db/mutations/service-reports.ts"));
const pageSource = codeOnly(read("src/app/(app)/repair-cases/[id]/report/page.tsx"));
const tabsSource = codeOnly(read("src/components/repair-cases/report/ServiceReportTabs.tsx"));

describe("① 관문 함수 자체 — 값으로", () => {
  const approved = { approvalStatus: "APPROVED" } as const;

  test("🔴 개발자 표시가 꺼진 사람은 관문을 못 넘는다 — MANAGE 를 가졌어도", () => {
    // 🔵 먼저 **무엇을 재는지** 못 박는다: 이 사람은 지우기 문턱(MANAGE)은
    //    이미 넘은 사람이다. 그런데도 완전 삭제는 막혀야 한다.
    assert.equal(canDeleteServiceReports("MANAGE"), true, "MANAGE 가 지우기 문턱을 못 넘는다");

    assert.equal(
      mayEnterDeveloperMode({ role: "ADMIN", isDeveloper: false, ...approved }),
      false,
      "개발자 표시가 꺼진 관리자가 관문을 넘었다"
    );
    assert.equal(
      mayEnterDeveloperMode({ role: "AS_ENGINEER", isDeveloper: false, ...approved }),
      false
    );
  });

  test("개발자 표시가 켜져 있으면 넘는다 — 승인된 계정일 때만", () => {
    assert.equal(
      mayEnterDeveloperMode({ role: "AS_ENGINEER", isDeveloper: true, ...approved }),
      true
    );
    assert.equal(
      mayEnterDeveloperMode({
        role: "AS_ENGINEER",
        isDeveloper: true,
        approvalStatus: "PENDING",
      }),
      false,
      "승인 대기 계정이 개발자 표시만으로 통과했다"
    );
  });
});

describe("② 서버 액션이 그 관문을 다시 지나는가 — 글자로", () => {
  /** 관문 도우미의 몸통. 여기에 두 판정이 **차례로** 들어 있어야 한다. */
  const gate = flat(
    sliceBetween(
      actionSource,
      "async function resolveAuthorizedActor(",
      "export async function createServiceReportAction("
    )
  );

  test("🔴 관문에 개발자 모드 판정이 실제로 있다 — 주석이 아니라 코드에", () => {
    assert.ok(
      gate.includes("mayEnterDeveloperMode(actingUser)"),
      "관문이 개발자 모드 판정을 부르지 않는다"
    );
    assert.ok(
      gate.includes('need === "purge"'),
      "완전 삭제에만 걸리는 판정이 아니다 — 가지를 가르지 않는다"
    );
    // 🔴 판정을 여기 베껴 적지 않았는가. `actor.isDeveloper` 를 직접 읽으면
    //    「이 사람이 개발자냐」의 답이 나오는 자리가 둘이 된다.
    assert.equal(
      /isDeveloper/.test(gate),
      false,
      "관문이 개발자 표시 칸을 직접 읽는다 — 판정이 두 벌이 됐다"
    );
  });

  test("🔴 MANAGE 를 **먼저** 보고, 그다음 개발자 모드다", () => {
    const manageAt = gate.indexOf("canDeleteServiceReports(level)");
    const developerAt = gate.indexOf("mayEnterDeveloperMode(actingUser)");
    assert.ok(manageAt >= 0, "관문이 MANAGE 판정을 부르지 않는다");
    assert.ok(developerAt >= 0, "관문이 개발자 모드 판정을 부르지 않는다");
    assert.ok(
      manageAt < developerAt,
      "개발자 모드를 먼저 본다 — 접수 건 권한이 없는 개발자 계정이 남의 건의 보고서를 지울 수 있다"
    );
  });

  test("🔴 완전 삭제 액션: 관문 → 신원 → 사유 → mutation 차례다", () => {
    const body = flat(
      sliceBetween(
        actionSource,
        "export async function permanentlyDeleteServiceReportAction(",
        "} catch (err) {"
      )
    );
    const gateAt = body.indexOf('resolveAuthorizedActor("purge")');
    const identityAt = body.indexOf("validateReportIdentity(");
    const reasonAt = body.indexOf("readServiceReportPurgeReason(");
    const mutationAt = body.indexOf("await permanentlyDeleteServiceReport({");

    assert.ok(gateAt >= 0, '완전 삭제 액션이 "purge" 관문을 부르지 않는다');
    assert.ok(identityAt > gateAt, "관문보다 신원 검증을 먼저 한다");
    assert.ok(reasonAt > identityAt, "신원 검증보다 사유를 먼저 본다");
    assert.ok(mutationAt > reasonAt, "사유를 거르기 전에 지운다");
  });

  test("되살리기·지우기 액션은 그대로 `delete` 관문이다 — 문턱이 조용히 올라가지 않았다", () => {
    for (const marker of [
      "export async function deleteServiceReportAction(",
      "export async function restoreServiceReportAction(",
    ]) {
      const body = flat(sliceBetween(actionSource, marker, "} catch (err) {"));
      assert.ok(
        body.includes('resolveAuthorizedActor("delete")'),
        `${marker} 의 관문이 바뀌었다`
      );
    }
  });
});

describe("③ mutation — 휴지통에 든 장만 지운다", () => {
  const body = flat(
    sliceBetween(
      mutationSource,
      "export async function permanentlyDeleteServiceReport(",
      "function serializeServiceReportSnapshot"
    )
  );

  test("🔴 고르는 조건에도 지우는 조건에도 `isDeleted = true` 가 있다", () => {
    const selectWhere = body.indexOf("eq(serviceReports.isDeleted, true)");
    assert.ok(selectWhere >= 0, "휴지통으로 좁히지 않고 읽는다 — 살아 있는 장도 잡힌다");
    // 🔴 DELETE 의 where 에도 다시 있어야 한다. 읽을 때만 좁히면 그 사이에 누가
    //    되살린 장을 지우게 된다(잠금을 쥐고 있어도 조건은 다시 적는다).
    const deleteAt = body.indexOf("tx .delete(serviceReports)");
    assert.ok(deleteAt >= 0, "행을 지우는 자리를 찾지 못했다");
    assert.ok(
      body.indexOf("eq(serviceReports.isDeleted, true)", deleteAt) > deleteAt,
      "DELETE 의 조건에 휴지통 조건이 없다"
    );
    assert.ok(
      body.indexOf("eq(serviceReports.version, params.expectedVersion)", deleteAt) > deleteAt,
      "DELETE 의 조건에 version 대조가 없다"
    );
  });

  test("🔴 감사 한 줄을 **같은 트랜잭션**에서 남기고, 내용을 싣는다", () => {
    assert.ok(body.includes("insertAuditLog(tx, {"), "감사를 같은 트랜잭션에 쓰지 않는다");
    assert.ok(body.includes('actionType: "PURGE"'), "PURGE 로 남기지 않는다");
    for (const key of ["columns:", "lines,", "causes:", "purgeReason:"]) {
      assert.ok(body.includes(key), `감사 스냅숏에 '${key}' 가 없다 — 되짚을 곳이 사라진다`);
    }
  });

  test("🔴 본문·원인을 **지우기 전에** 읽는다 — 뒤에 읽으면 빈 목록이 담긴다", () => {
    const linesAt = body.indexOf(".from(serviceReportLines)");
    const causesAt = body.indexOf(".from(serviceReportCauses)");
    const deleteAt = body.indexOf("tx .delete(serviceReports)");
    assert.ok(linesAt >= 0 && causesAt >= 0, "본문·원인을 읽지 않는다");
    assert.ok(linesAt < deleteAt, "본문 줄을 지운 뒤에 읽는다");
    assert.ok(causesAt < deleteAt, "고른 원인을 지운 뒤에 읽는다");
  });
});

describe("④ 화면 — 감추기는 편의일 뿐이지만, 감추기는 한다", () => {
  test("🔴 페이지가 관문으로 정해 넘긴다 — 판정을 화면에 베끼지 않았다", () => {
    assert.ok(
      flat(pageSource).includes("canPermanentlyDelete={mayEnterDeveloperMode(actingUser)}"),
      "페이지가 관문 함수로 단추 여부를 정하지 않는다"
    );
  });

  test("🔴 단추는 그 값이 참일 때만 그려진다", () => {
    const list = flat(sliceFrom(tabsSource, "function ServiceReportTrashList("));
    const guardAt = list.indexOf("{canPermanentlyDelete && (");
    const buttonAt = list.indexOf("완전 삭제 중…");
    assert.ok(guardAt >= 0, "단추를 감싸는 조건이 없다 — 누구에게나 보인다");
    assert.ok(buttonAt > guardAt, "단추가 조건 밖에 있다");
  });

  test("🔴 확인 창을 거친다 — 공용 창을 쓰고 브라우저 confirm() 을 부르지 않는다", () => {
    assert.ok(
      tabsSource.includes("<MasterDataPermanentDeleteDialog"),
      "이 저장소의 표준 완전 삭제 창을 쓰지 않는다"
    );
    assert.equal(/\bconfirm\s*\(/.test(tabsSource), false, "브라우저 confirm() 을 부른다");
  });

  test("🔴 저장 팝업을 쓰지 않는다 — 0.5초 뒤 저절로 닫히는 것은 성공 전용이다", () => {
    assert.equal(/showSavePopup|SavePopup/.test(tabsSource), false, "저장 팝업이 섞였다");
  });

  test("🔴 두 번 누르기를 막는다 — busyId 가 차 있으면 아무 일도 안 한다", () => {
    const confirmPurge = flat(sliceBetween(tabsSource, "async function confirmPurge()", "return ("));
    assert.ok(
      confirmPurge.includes("if (!purgeTarget || busyId || purgeReason.trim() === \"\") return;"),
      "두 번 누르기·빈 사유를 막는 첫 줄이 없다"
    );
    assert.ok(
      confirmPurge.includes("await permanentlyDeleteServiceReportAction({"),
      "확인이 완전 삭제 액션으로 이어지지 않는다"
    );
  });
});
