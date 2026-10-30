import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isRepairCaseShipmentFinished } from "./shipment-finished";

/**
 * ============================================================================
 * 끊어 놓은 고리(circular import)가 되살아나지 않는가 — **글자로 잰다**
 * ============================================================================
 * 2026-10-30 까지 domain/notifications.ts 와 domain/due-date-inversion.ts 는
 * **서로를 보고 있었다.** 역전 판정이 저쪽의 isRepairCaseShipmentFinished 를, 종
 * 알림 한 줄이 이쪽의 DUE_DATE_INVERSION_NOTE 를 가져다 썼다.
 *
 * 🔴 **그 고리는 규율 하나로만 버티고 있었다** — 「저 상수를 모듈 최상위에서 읽지
 * 마라」. 실제로 한 줄만 함수 밖으로 올리면 due-date-inversion.test.ts 가 통째로
 * `ReferenceError: Cannot access 'DUE_DATE_INVERSION_NOTE' before initialization`
 * 로 죽었다. 사람의 기억 말고는 아무것도 그것을 막지 않았고, 「상수 하나만 위로」는
 * 누구나 좋은 뜻으로 저지를 수 있는 변경이다.
 *
 * 출하 판정을 domain/shipment-finished.ts 로 내보내 사슬을 한 방향으로 폈다:
 *
 *     notifications ──▶ due-date-inversion ──▶ shipment-finished
 *             └──────────────────────────────────────▶
 *
 * 이 파일이 하는 일은 **그 화살표가 한 방향으로 남아 있는가**를 재는 것 하나다.
 * 시험이 없으면 다음 사람이 「상수 하나만 가져오자」로 똑같은 고리를 다시 만들고,
 * 그때는 아무 오류 없이 — 모듈이 어느 차례로 실행되느냐가 바뀔 때까지 — 멀쩡해
 * 보인다.
 *
 * ── 🔴 주석을 반드시 걷어내고 센다 ────────────────────────────────────────
 * due-date-inversion.ts 의 주석은 `notifications.ts` 를 **이름으로 여러 번**
 * 가리킨다(「납기 임박과 어떻게 다른가」를 설명하는 자리이고, 2026-10-30 에는
 * 「저기서 가져오지 마라」라는 경고까지 붙었다). 날것으로 「저 파일을 보는가」를
 * 세면 이 시험은 **영영 깨져 있다** — 그러면 사람이 시험을 약하게 고치고, 그날
 * 고리를 막는 것은 다시 아무것도 없게 된다.
 * ============================================================================
 */

const read = (fileName: string) =>
  readFileSync(new URL(fileName, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 걷어낸 **코드만**. 위 머리말의 「주석을 반드시 걷어내고 센다」.
 * `(^|[^:])//` 로 받는 것은 `https://` 같은 주소를 주석으로 잘라 먹지 않기
 * 위해서다(이웃 due-date-near-badge.test.tsx 가 쓰는 그 식 그대로).
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * 그 코드가 들여오는 이웃 전부. `export … from` 도 함께 잡는다 — 되내보내기도
 * 의존 화살표이고, 고리를 되살리는 가장 조용한 길이 바로 그것이다.
 */
function importedModules(code: string): string[] {
  return [...code.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]);
}

const RAW_INVERSION = read("./due-date-inversion.ts");
const RAW_NOTIFICATIONS = read("./notifications.ts");
const RAW_SHIPMENT_FINISHED = read("./shipment-finished.ts");

const INVERSION_IMPORTS = importedModules(codeOnly(RAW_INVERSION));
const NOTIFICATIONS_IMPORTS = importedModules(codeOnly(RAW_NOTIFICATIONS));
const SHIPMENT_FINISHED_IMPORTS = importedModules(codeOnly(RAW_SHIPMENT_FINISHED));

describe("🔴 고리가 끊어져 있다 — 사슬은 한 방향이다", () => {
  test("🔵 표본 확인 — 세 파일을 실제로 읽었고, 주석을 걷어낸 뒤에도 코드가 남아 있다", () => {
    // 경로가 틀려 빈 글자를 읽어도 아래의 「없다」 단언들은 전부 초록색으로 남는다.
    assert.ok(
      RAW_SHIPMENT_FINISHED.includes("export function isRepairCaseShipmentFinished"),
      "출하 판정이 shipment-finished.ts 에 없다 — 옮기기 전 상태이거나 경로가 틀렸다"
    );
    assert.ok(
      RAW_INVERSION.includes("export function isRepairCaseDueDateInverted"),
      "역전 판정 파일을 읽지 못했다"
    );
    assert.ok(
      RAW_NOTIFICATIONS.includes("export const NOTIFICATION_KINDS"),
      "종 알림 파일을 읽지 못했다"
    );
    // import 를 하나도 못 뽑았다면 정규식이나 주석 걷기가 망가진 것이다.
    assert.ok(INVERSION_IMPORTS.length >= 3, `역전 파일의 import 를 못 뽑았다: ${INVERSION_IMPORTS}`);
    assert.ok(NOTIFICATIONS_IMPORTS.length >= 3, `종 알림 파일의 import 를 못 뽑았다: ${NOTIFICATIONS_IMPORTS}`);
  });

  test("🔴 주석을 걷어내는 일이 **실제로 일한다** — 날것으로 재면 이 시험은 영영 깨져 있다", () => {
    // 머리말의 그 함정이다. 이 두 줄이 없으면 누군가 codeOnly 를 떼어도 아무도 모른다.
    assert.match(
      RAW_INVERSION,
      /notifications/,
      "역전 파일의 주석이 종 알림 파일을 이름으로 가리키지 않는다 — 그 경고가 사라졌다"
    );
    assert.ok(
      !codeOnly(RAW_INVERSION).includes("notifications"),
      "주석을 걷어냈는데도 그 낱말이 남아 있다 — 코드가 저 파일을 보고 있다"
    );
  });

  test("🔴 due-date-inversion.ts 는 ./notifications 를 보지 않는다", () => {
    // 🔵 먼저 **옮긴 함수를 새 자리에서 가져오는가** — 이 줄이 없으면 「아무 데서도
    //    안 가져온다」(함수를 통째로 지운 판)도 아래 단언을 통과한다.
    assert.ok(
      INVERSION_IMPORTS.includes("./shipment-finished"),
      `출하 판정을 shipment-finished 에서 가져오지 않는다: ${INVERSION_IMPORTS}`
    );
    assert.equal(
      INVERSION_IMPORTS.includes("./notifications"),
      false,
      `고리가 되살아났다 — 역전 판정이 종 알림 파일을 본다: ${INVERSION_IMPORTS}`
    );
  });

  test("🔴 남은 화살표는 한 방향뿐이다 — notifications → due-date-inversion", () => {
    // 🔵 그 한 방향이 **살아 있어야** 위 시험이 뜻을 갖는다. 둘이 서로를 아예 모르면
    //    「고리가 없다」는 공짜로 참이고, 그때는 같은 경보가 화면과 종에서 다른 글자로
    //    뜨는 것을 아무도 막지 않는다(DUE_DATE_INVERSION_NOTE 를 같이 쓰는 까닭).
    assert.ok(
      NOTIFICATIONS_IMPORTS.includes("./due-date-inversion"),
      `종 알림이 역전 메모의 글자 상수를 가져오지 않는다: ${NOTIFICATIONS_IMPORTS}`
    );
    assert.ok(
      NOTIFICATIONS_IMPORTS.includes("./shipment-finished"),
      `종 알림이 출하 판정을 새 자리에서 가져오지 않는다: ${NOTIFICATIONS_IMPORTS}`
    );
    // 두 파일이 **서로를** 보는 일이 없다 — 위 둘을 한 문장으로 다시 못 박는다.
    assert.equal(
      NOTIFICATIONS_IMPORTS.includes("./due-date-inversion") &&
        INVERSION_IMPORTS.includes("./notifications"),
      false,
      "두 파일이 서로를 본다 — 고리다"
    );
  });

  test("🔴 notifications.ts 가 그 함수를 **되내보내지도** 않는다", () => {
    // 되내보내면 `./notifications` 에서 다시 가져올 길이 생기고, 그날 고리는 아무
    // 오류 없이 돌아온다 — 가장 조용한 되돌림이라 일부러 따로 잰다.
    const code = codeOnly(RAW_NOTIFICATIONS);
    assert.equal(
      code.includes("export function isRepairCaseShipmentFinished"),
      false,
      "출하 판정이 종 알림 파일에 다시 생겼다"
    );
    assert.equal(
      /export\s*\{[^}]*isRepairCaseShipmentFinished/.test(code),
      false,
      "종 알림 파일이 출하 판정을 되내보낸다 — 고리로 가는 뒷문이다"
    );
  });

  test("🔴 shipment-finished.ts 는 사슬의 끝이다 — 타입 하나 말고는 아무것도 안 들여온다", () => {
    // 여기에 import 가 하나라도 늘면 고리가 **다른 모양으로** 돌아올 수 있다.
    // 늘려야 할 까닭이 생겼다면 그 이웃이 이 파일을 되보지 않는지부터 재라.
    assert.deepEqual(
      SHIPMENT_FINISHED_IMPORTS,
      ["./types"],
      "사슬 끝 파일이 이웃을 더 들여왔다"
    );
  });
});

/**
 * 🔵 **값은 여기서 못 박지 않는다 — 아래는 「옮기면서 본문이 상하지 않았는가」만
 * 본다.** 네 갈래 전부와 경계(공백만 적힌 출하일 등)는 옮기기 전부터 두 곳이
 * 재고 있고, 그 둘이 이 함수의 **쓰이는 자리**에서 재는 것이라 권위도 그쪽에 있다:
 * notifications.test.ts(「납기 임박」이 끝난 건을 빼는가) ·
 * due-date-inversion.test.ts(「납기 역전」이 같은 잣대로 빼는가).
 */
test("🔵 옮겨 온 본문이 그대로다 — 상태로도, 출하일로도 「나갔다」가 된다", () => {
  assert.equal(
    isRepairCaseShipmentFinished({ status: "SHIPMENT_COMPLETED", actualShipmentDate: null }),
    true
  );
  assert.equal(
    isRepairCaseShipmentFinished({ status: "WAITING_SHIPMENT", actualShipmentDate: "2026-10-18" }),
    true,
    "출하일이 찍힌 건은 단계가 뒤처져 있어도 이미 나간 것이다"
  );
  assert.equal(isRepairCaseShipmentFinished({ status: "IN_REPAIR", actualShipmentDate: null }), false);
  // 평탄화 상태가 비어 있는 단계가 아직 있다(workflow_steps.repair_status 는 nullable).
  assert.equal(isRepairCaseShipmentFinished({ status: null, actualShipmentDate: null }), false);
});
