import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { findPermissionArea } from "./permission-areas";
import { baselineLeafLevel, baselinePermissionLevel } from "./permission-baseline";
import { isSettingsEnforced } from "./permission-features";
import { canManageIntakeMailSettings } from "./intake-mail-authorization";
import { ROLE_CODES } from "@/lib/domain/types";

/**
 * ============================================================================
 * 🔴 「시스템 설정」 영역에 **관리** 수준이 생겼다 (2026-11-13, 조각 2)
 * ============================================================================
 * 그날까지 이 영역은 **읽기가 끝**이었다(`maxMeaningfulLevel: "READ"` ·
 * `case "settings": return "READ"`). 「누가 바꿀 수 있나」를 적을 칸이 아예 없었고,
 * 그래도 됐던 까닭은 그 화면의 카드 하나(고객 안내 상태 목록)가 **제 메뉴의
 * 권한**으로 여닫혔기 때문이다. [배지 표시]가 들어오면서 달라졌다 — 그 설정은 어느
 * 메뉴의 것도 아니고, 고칠 자리가 이 화면 말고는 없다.
 *
 * 🔴 **권한을 건드리는 조각에서 가장 조용히 깨지는 것**이 「닫힌 쪽」이다. 열린 쪽은
 * 금방 드러나지만, 한 칸 내려간 역할의 사람은 아무 말 없이 막히고 아무도 신고하지
 * 않는다. 그래서 이 파일이 재는 첫째가 **읽기가 다섯 역할 전부 그대로인가**다.
 *
 * 🔵 다섯 역할 × 잎 51개의 표(permission-settings-truth.test.ts 의 ⑦·⑧절)도 같은
 * 날 두 줄이 바뀌었다 — `settings` 가 "READ READ READ READ READ" 에서
 * "MANAGE MANAGE READ READ READ" 로. 그 파일은 **표 전체**를 지키고, 이 파일은 이
 * 영역 하나를 **까닭과 함께** 지킨다.
 * ============================================================================
 */

const AREA_KEY = "settings";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

describe("① 영역 자체 — 상한과 설명", () => {
  test("표본이 비어 있지 않다 — 영역이 실제로 있고 이름이 그대로다", () => {
    const area = findPermissionArea(AREA_KEY);
    assert.ok(area, "`settings` 영역이 사라졌다 — 운영 DB 의 그 행이 가리킬 곳을 잃는다");
    assert.equal(area.label, "시스템 설정");
  });

  test("🔴 상한이 관리다 — 「누가 바꿀 수 있나」를 적을 칸이 생겼다", () => {
    assert.equal(findPermissionArea(AREA_KEY)?.maxMeaningfulLevel, "MANAGE");
  });

  test("🔴 설명이 **무엇이 열리는지** 말한다 — 「시스템 전반 설정」이 아니다", () => {
    const description = findPermissionArea(AREA_KEY)?.description ?? "";
    // 예전 글은 한 글자도 말해 주지 않았다. 켜고 끄는 사람이 가진 정보의 전부가
    // 이 한 줄이라(RolePermissionSettings 가 그대로 그린다), 짐작하게 두면 안 된다.
    assert.notEqual(description, "시스템 전반 설정");
    assert.match(description, /배지 표시/, "관리로 열리는 것이 무엇인지 적혀 있지 않다");
    assert.match(
      description,
      /고객 안내/,
      "같은 화면의 다른 카드가 이 권한으로 열리지 않는다는 사실이 빠졌다 — 올린 사람은 설정이 고장 난 것으로 읽는다"
    );
  });

  test("🔴 설정이 최종 판정인 영역 그대로다 — 넓히면 실제로 열린다", () => {
    // 이 영역의 관문은 페이지 가드와 저장 액션뿐이고 둘 다 설정만 본다. 목록에서
    // 빠지면 권한 화면이 「넓혀도 안 열릴 수 있다」는 거짓 경고를 띄운다.
    assert.equal(isSettingsEnforced(AREA_KEY), true);
  });
});

describe("② 기본 정책 — 읽기는 그대로, 관리는 관리자 이상", () => {
  test("표본이 비어 있지 않다 — 역할 다섯을 전부 훑는다", () => {
    assert.equal(ROLE_CODES.length, 5);
  });

  test("🔴 다섯 역할 **전부** 읽기 이상이다 — 아무도 화면에서 튕기지 않는다", () => {
    for (const role of ROLE_CODES) {
      assert.notEqual(
        baselinePermissionLevel(AREA_KEY, role),
        "NONE",
        `${role}: 시스템 설정 화면이 닫혔다 — 배포 즉시 지금 쓰던 사람이 막힌다`
      );
    }
  });

  test("🔴 관리는 **메일 설정이 관리를 주는 역할 집합과 같다**", () => {
    // 지시된 기본값이다(2026-11-13). 두 영역이 같은 선을 쓰는지를 역할마다 맞대어
    // 본다 — 한쪽이 움직이는 날 여기서 멈춘다.
    const withManage = ROLE_CODES.filter(
      (role) => baselinePermissionLevel(AREA_KEY, role) === "MANAGE"
    );
    const mailManage = ROLE_CODES.filter((role) => canManageIntakeMailSettings(role));
    assert.ok(withManage.length > 0, "아무도 관리를 못 가지면 배지 표시를 고칠 사람이 없다");
    assert.ok(
      mailManage.length < ROLE_CODES.length,
      "표본이 비었다 — 메일 설정이 전원에게 관리를 주면 이 비교가 아무것도 안 잰다"
    );
    assert.deepEqual(withManage, mailManage);
  });

  test("🔴 관리가 **아닌** 역할은 읽기에서 멈춘다 — 열린 쪽도 함께 잰다", () => {
    const withoutManage = ROLE_CODES.filter((role) => !canManageIntakeMailSettings(role));
    assert.ok(withoutManage.length > 0, "표본이 비었다 — 막히는 역할이 하나도 없다");
    for (const role of withoutManage) {
      assert.equal(baselinePermissionLevel(AREA_KEY, role), "READ", `${role}`);
    }
  });

  test("잎 경로로 물어도 같은 답이다 — 이 메뉴에는 하위 기능이 없다", () => {
    // 하위 기능이 없는 메뉴는 메뉴 자체가 잎이다(permission-baseline.ts 의
    // baselineLeafLevel). 두 경로의 답이 갈리면 화면과 서버가 다른 수준을 본다.
    for (const role of ROLE_CODES) {
      assert.equal(baselineLeafLevel(AREA_KEY, role), baselinePermissionLevel(AREA_KEY, role));
    }
  });
});

describe("③ 저장을 막는 자리 — 세 곳이 같은 열쇠를 본다", () => {
  /**
   * 🔴 화면에서 단추를 감추는 것은 막은 것이 아니다. 서버 액션은 주소를 몰라도 부를
   * 수 있고, mutation 은 액션을 거치지 않고 불릴 수 있다. 셋이 **같은 함수**를 쓰는지
   * 글자로 확인한다 — 그려 볼 수 없는 자리(서버 액션·server-only)라 원본을 읽는다.
   */
  const AUTHORIZATION = "src/lib/auth/badge-visibility-authorization.ts";

  test("인가 모듈이 `settings` 의 **관리**를 묻는다", () => {
    const source = read(AUTHORIZATION);
    assert.match(source, /BADGE_VISIBILITY_AREA_KEY = "settings"/);
    assert.match(source, /hasPermission\(actor, BADGE_VISIBILITY_AREA_KEY, "MANAGE"\)/);
    // 🔴 세션이 없으면 닫히는 쪽으로 답한다 — 열리는 쪽으로 실패하면 아무도 모른다.
    assert.match(source, /if \(!actor\) return false;/);
  });

  test("🔴 서버 액션 · mutation · 서버 페이지가 **그 함수를** 부른다", () => {
    for (const file of [
      "src/lib/server/actions/badge-visibility-settings.ts",
      "src/lib/db/mutations/badge-visibility-settings.ts",
      "src/app/(app)/settings/page.tsx",
    ]) {
      const source = read(file);
      assert.match(
        source,
        /mayManageBadgeVisibility/,
        `${file}: 배지 표시 권한을 묻지 않는다 — 여기서 빠지면 그 자리가 통째로 열린다`
      );
      assert.match(
        source,
        /from "@\/lib\/auth\/badge-visibility-authorization"/,
        `${file}: 판정을 제 손으로 한 벌 더 적고 있다`
      );
    }
  });

  test("🔴 mutation 은 **트랜잭션 안에서** 묻는다 — 세션 뒤에 역할이 내려갔을 수 있다", () => {
    const source = read("src/lib/db/mutations/badge-visibility-settings.ts");
    const transactionAt = source.indexOf("db.transaction");
    const permissionAt = source.indexOf("mayManageBadgeVisibility(actor)");
    assert.ok(transactionAt >= 0 && permissionAt > transactionAt);
  });
});
