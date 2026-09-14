import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  arrangeImprovementRequestList,
  IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE,
  IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT,
  canChangeImprovementRequestScreenshots,
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  hasImprovementRequestScreenshotRoom,
  countImprovementRequestBodyChars,
  filterImprovementRequestsByMenu,
  groupImprovementRequestMenuOptions,
  IMPROVEMENT_REQUEST_ALL_MENUS_LABEL,
  IMPROVEMENT_REQUEST_LIST_STATUS_ORDER,
  IMPROVEMENT_REQUEST_MENU_FILTER_ALL,
  IMPROVEMENT_REQUEST_MENU_FILTER_NONE,
  IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN,
  IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
  IMPROVEMENT_REQUEST_STATUS_LABELS,
  IMPROVEMENT_REQUEST_STATUSES,
  improvementRequestCopyText,
  improvementRequestMenuFilterValue,
  improvementRequestMenuLabel,
  includeImprovementRequestMenuOption,
  isImprovementRequestMenuKey,
  isImprovementRequestStatus,
  listImprovementRequestMenuFilterOptions,
  listImprovementRequestMenuOptions,
  listSidebarImprovementRequestMenuOptions,
  planImprovementRequestStatusChange,
  type ImprovementRequestProgressFields,
  type ImprovementRequestStatus,
} from "./improvement-request";
import { DEVELOPER_MODE_NAV_KEY } from "@/lib/auth/developer-mode-gate";
import { improvementRequests, improvementRequestStatusEnum } from "@/lib/db/schema/improvement-requests";
import { childNavItems, navGroups, navItems } from "@/lib/navigation";

/**
 * 이 파일이 지키는 것은 다섯이다(넷째·다섯째는 2026-09-13 메뉴 칸).
 *
 *  1. **도메인 목록과 표의 enum 이 같다** — 스키마는 도메인을 가져오지 않으므로
 *     두 벌이고, 갈라지면 여기서 걸린다.
 *  2. **상태 옮기기 결과가 언제나 DB CHECK 를 지킨다** — 세 상태 × 세 상태 아홉
 *     가지 전부. 아래 satisfiesCheck 는 스키마의 `improvement_requests_*_pair` ·
 *     `improvement_requests_status_columns` 를 그대로 옮긴 것이다.
 *  3. **작성자는 접수 상태인 자기 글만 고치고 지운다** — 관리 권한은 지우기만 넓힌다.
 *  4. **고를 수 있는 메뉴는 사이드바 그대로다** — 차례도 이름도 navigation.ts 에서
 *     오고, 모든 항목이 한 번씩, 기타가 맨 끝이다.
 *  5. **사람마다 내놓는 메뉴 · 메뉴로 거르기** — 선택칸은 그 사람의 사이드바
 *     (filterNavItemsForAccess)와 같은 것만 내놓고, 고치는 글의 메뉴는 그대로 둘 수
 *     있다. 거르기 칸의 건수는 그 칸을 고르면 보이는 줄 수와 같다.
 */

const ACTOR = randomUUID();
const EARLIER_ACTOR = randomUUID();
const NOW = new Date("2026-09-13T05:00:00.000Z");
const EARLIER = new Date("2026-09-10T01:00:00.000Z");

/** 스키마 CHECK 의 JS 사본. 쌍은 함께 있고, 상태와 칸이 맞는다. */
function satisfiesCheck(status: ImprovementRequestStatus, f: ImprovementRequestProgressFields): boolean {
  const inProgressPair = (f.inProgressBy === null) === (f.inProgressAt === null);
  const resolvedPair = (f.resolvedBy === null) === (f.resolvedAt === null);
  if (!inProgressPair || !resolvedPair) return false;
  switch (status) {
    case "OPEN":
      return f.inProgressBy === null && f.resolvedBy === null;
    case "IN_PROGRESS":
      return f.inProgressBy !== null && f.resolvedBy === null;
    case "RESOLVED":
      return f.resolvedBy !== null;
  }
}

/**
 * 그 상태로 DB 에 있을 수 있는 네 칸. 해결은 두 모양이 다 있을 수 있다 —
 * 진행중을 거쳐 왔거나(in_progress 쌍 있음) 접수에서 곧바로 왔거나(없음).
 */
function storedShapes(status: ImprovementRequestStatus): ImprovementRequestProgressFields[] {
  const empty = { inProgressBy: null, inProgressAt: null, resolvedBy: null, resolvedAt: null };
  switch (status) {
    case "OPEN":
      return [empty];
    case "IN_PROGRESS":
      return [{ ...empty, inProgressBy: EARLIER_ACTOR, inProgressAt: EARLIER }];
    case "RESOLVED":
      return [
        { inProgressBy: EARLIER_ACTOR, inProgressAt: EARLIER, resolvedBy: EARLIER_ACTOR, resolvedAt: EARLIER },
        { ...empty, resolvedBy: EARLIER_ACTOR, resolvedAt: EARLIER },
      ];
  }
}

describe("상태 목록", () => {
  test("도메인 목록과 improvement_request_status 가 글자 그대로 같다", () => {
    assert.deepEqual([...improvementRequestStatusEnum.enumValues], [...IMPROVEMENT_REQUEST_STATUSES]);
  });

  test("한글 이름표는 접수 · 진행중 · 해결이다", () => {
    assert.deepEqual(
      IMPROVEMENT_REQUEST_STATUSES.map((s) => IMPROVEMENT_REQUEST_STATUS_LABELS[s]),
      ["접수", "진행중", "해결"]
    );
  });

  test("상태 값 판별", () => {
    for (const s of IMPROVEMENT_REQUEST_STATUSES) assert.equal(isImprovementRequestStatus(s), true);
    for (const bad of ["open", "DONE", "", null, undefined, 1]) {
      assert.equal(isImprovementRequestStatus(bad), false, String(bad));
    }
  });

  test("시험이 쓰는 저장 모양이 스스로 CHECK 를 지킨다", () => {
    for (const s of IMPROVEMENT_REQUEST_STATUSES) {
      for (const shape of storedShapes(s)) assert.equal(satisfiesCheck(s, shape), true, s);
    }
  });
});

describe("상태 옮기기 — 세 상태 × 세 상태", () => {
  const cases: Array<[ImprovementRequestStatus, ImprovementRequestStatus]> = [];
  for (const from of IMPROVEMENT_REQUEST_STATUSES) {
    for (const to of IMPROVEMENT_REQUEST_STATUSES) cases.push([from, to]);
  }

  test("아홉 가지를 모두 다룬다", () => {
    assert.equal(cases.length, 9);
  });

  for (const [from, to] of cases) {
    test(`${from} → ${to}`, () => {
      for (const current of storedShapes(from)) {
        const plan = planImprovementRequestStatusChange({ from, to, current, actorUserId: ACTOR, now: NOW });

        if (from === to) {
          assert.deepEqual(plan, { kind: "unchanged" }, "같은 상태로는 바뀐 것이 없다");
          continue;
        }

        assert.equal(plan.kind, "changed");
        if (plan.kind !== "changed") return;
        assert.equal(plan.status, to);
        assert.equal(satisfiesCheck(to, plan.fields), true, "결과가 DB CHECK 를 어긴다");

        switch (to) {
          case "OPEN":
            assert.deepEqual(plan.fields, {
              inProgressBy: null,
              inProgressAt: null,
              resolvedBy: null,
              resolvedAt: null,
            });
            break;
          case "IN_PROGRESS":
            assert.deepEqual(plan.fields, {
              inProgressBy: ACTOR,
              inProgressAt: NOW,
              resolvedBy: null,
              resolvedAt: null,
            });
            break;
          case "RESOLVED":
            // in_progress 쌍은 그대로 둔다 — 거쳐 왔으면 남고, 곧바로 왔으면 비어 있다.
            assert.deepEqual(plan.fields, {
              inProgressBy: current.inProgressBy,
              inProgressAt: current.inProgressAt,
              resolvedBy: ACTOR,
              resolvedAt: NOW,
            });
            break;
        }
      }
    });
  }

  test("접수에서 곧바로 해결로 가면 in_progress 쌍은 비어 있다", () => {
    const [open] = storedShapes("OPEN");
    const plan = planImprovementRequestStatusChange({
      from: "OPEN",
      to: "RESOLVED",
      current: open,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, null);
    assert.equal(plan.fields.inProgressAt, null);
  });

  test("진행중을 거쳐 해결되면 맡았던 사람이 남는다", () => {
    const [inProgress] = storedShapes("IN_PROGRESS");
    const plan = planImprovementRequestStatusChange({
      from: "IN_PROGRESS",
      to: "RESOLVED",
      current: inProgress,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, EARLIER_ACTOR);
    assert.equal(plan.fields.inProgressAt, EARLIER);
  });

  test("해결에서 진행중으로 되돌리면 지금 옮긴 사람이 새로 맡는다", () => {
    const [resolved] = storedShapes("RESOLVED");
    const plan = planImprovementRequestStatusChange({
      from: "RESOLVED",
      to: "IN_PROGRESS",
      current: resolved,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, ACTOR);
    assert.equal(plan.fields.inProgressAt, NOW);
  });
});

describe("누가 무엇을", () => {
  const AUTHOR = randomUUID();
  const OTHER = randomUUID();

  test("내용 고치기 — 접수 상태인 자기 글만", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      assert.equal(
        canEditImprovementRequestBody({ status, createdBy: AUTHOR, actorUserId: AUTHOR }),
        status === "OPEN",
        `작성자 · ${status}`
      );
      assert.equal(
        canEditImprovementRequestBody({ status, createdBy: AUTHOR, actorUserId: OTHER }),
        false,
        `남 · ${status}`
      );
    }
  });

  test("지우기 — 관리 권한이 있으면 어느 글이든", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      for (const actorUserId of [AUTHOR, OTHER]) {
        assert.equal(
          canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId, canManage: true }),
          true,
          status
        );
      }
    }
  });

  test("지우기 — 관리 권한이 없으면 접수 상태인 자기 글만", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      assert.equal(
        canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId: AUTHOR, canManage: false }),
        status === "OPEN",
        `작성자 · ${status}`
      );
      assert.equal(
        canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId: OTHER, canManage: false }),
        false,
        `남 · ${status}`
      );
    }
  });
});

describe("스크린샷 — 누가 붙이고 떼는가 · 몇 장까지 (2026-09-13)", () => {
  const AUTHOR = randomUUID();
  const OTHER = randomUUID();

  test("관리 권한이 있으면 어느 글 · 어느 상태든 붙이고 뗀다", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      for (const actorUserId of [AUTHOR, OTHER]) {
        assert.equal(
          canChangeImprovementRequestScreenshots({ status, createdBy: AUTHOR, actorUserId, canManage: true }),
          true,
          status
        );
      }
    }
  });

  test("관리 권한이 없으면 접수 상태인 자기 글만 — 진행중 · 해결된 자기 글, 남의 글은 안 된다", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      assert.equal(
        canChangeImprovementRequestScreenshots({ status, createdBy: AUTHOR, actorUserId: AUTHOR, canManage: false }),
        status === "OPEN",
        `작성자 · ${status}`
      );
      assert.equal(
        canChangeImprovementRequestScreenshots({ status, createdBy: AUTHOR, actorUserId: OTHER, canManage: false }),
        false,
        `남 · ${status}`
      );
    }
  });

  test("한 글에 5장 — 네 장이면 한 장 더, 다섯 장이면 더 없다", () => {
    assert.equal(IMPROVEMENT_REQUEST_SCREENSHOT_MAX_COUNT, 5);
    assert.equal(hasImprovementRequestScreenshotRoom(0), true);
    assert.equal(hasImprovementRequestScreenshotRoom(4), true);
    assert.equal(hasImprovementRequestScreenshotRoom(5), false);
    assert.equal(hasImprovementRequestScreenshotRoom(6), false, "넘친 상태에서도 자리가 없다고 답한다");
  });

  test("상한 문구는 사람이 읽는 한국어이고 수가 상수에서 온다", () => {
    assert.equal(IMPROVEMENT_REQUEST_SCREENSHOT_LIMIT_MESSAGE, "스크린샷은 한 글에 5장까지 붙일 수 있습니다.");
  });
});

describe("글자 수", () => {
  test("코드 포인트로 센다 — DB 의 char_length 와 같다", () => {
    assert.equal(countImprovementRequestBodyChars("가나다"), 3);
    assert.equal(countImprovementRequestBodyChars("😀"), 1, "이모지 하나는 한 글자다");
    assert.equal(countImprovementRequestBodyChars(""), 0);
  });
});

describe("목록 차례", () => {
  type Row = { id: string; status: ImprovementRequestStatus; createdAt: string };
  const row = (id: string, status: ImprovementRequestStatus, createdAt: string): Row => ({ id, status, createdAt });

  // 조회가 돌려주는 차례(최근 글부터)와 일부러 다르게 섞어 둔다.
  const ITEMS: Row[] = [
    row("a", "RESOLVED", "2026-09-12T00:00:00.000Z"),
    row("b", "OPEN", "2026-09-10T00:00:00.000Z"),
    row("c", "IN_PROGRESS", "2026-09-01T00:00:00.000Z"),
    row("d", "OPEN", "2026-09-11T00:00:00.000Z"),
    row("e", "IN_PROGRESS", "2026-09-05T00:00:00.000Z"),
    row("f", "RESOLVED", "2026-08-30T00:00:00.000Z"),
  ];

  test("차례 목록은 세 상태를 한 번씩 담는다", () => {
    assert.deepEqual([...IMPROVEMENT_REQUEST_LIST_STATUS_ORDER].sort(), [...IMPROVEMENT_REQUEST_STATUSES].sort());
    assert.deepEqual(IMPROVEMENT_REQUEST_LIST_STATUS_ORDER, ["IN_PROGRESS", "OPEN", "RESOLVED"]);
  });

  test("진행중 → 접수 → 해결, 같은 상태 안에서는 최신순", () => {
    const { rows } = arrangeImprovementRequestList(ITEMS, { showResolved: true });
    assert.deepEqual(
      rows.map((r) => r.id),
      ["e", "c", "d", "b", "a", "f"]
    );
  });

  test("해결된 것은 기본으로 감추고, 감춘 수를 알린다", () => {
    const hidden = arrangeImprovementRequestList(ITEMS, { showResolved: false });
    assert.deepEqual(
      hidden.rows.map((r) => r.id),
      ["e", "c", "d", "b"]
    );
    assert.equal(hidden.resolvedCount, 2);
    assert.equal(hidden.hiddenResolvedCount, 2);

    const shown = arrangeImprovementRequestList(ITEMS, { showResolved: true });
    assert.equal(shown.resolvedCount, 2);
    assert.equal(shown.hiddenResolvedCount, 0, "켜 두면 감춘 것이 없다");
  });

  test("같은 시각이면 id 내림차순 — 조회의 동점 규칙과 같다", () => {
    const at = "2026-09-13T05:00:00.000Z";
    const { rows } = arrangeImprovementRequestList(
      [row("11", "OPEN", at), row("33", "OPEN", at), row("22", "OPEN", at)],
      { showResolved: false }
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["33", "22", "11"]
    );
  });

  test("받은 배열을 건드리지 않는다 — 서버가 넘긴 props 다", () => {
    const before = ITEMS.map((r) => r.id);
    arrangeImprovementRequestList(ITEMS, { showResolved: false });
    assert.deepEqual(
      ITEMS.map((r) => r.id),
      before
    );
  });

  test("빈 목록", () => {
    assert.deepEqual(arrangeImprovementRequestList([], { showResolved: false }), {
      rows: [],
      resolvedCount: 0,
      hiddenResolvedCount: 0,
    });
  });
});

describe("어느 메뉴의 일인가", () => {
  const options = listImprovementRequestMenuOptions();
  const keys = options.map((o) => o.key);
  const navLabel = (key: string) => {
    const item = navItems.find((i) => i.key === key);
    assert.ok(item, `navItems 에 ${key} 가 없다`);
    return item.label;
  };

  test("기타 열쇠는 어떤 메뉴 열쇠와도 겹치지 않는다", () => {
    assert.equal(
      navItems.some((i) => i.key === IMPROVEMENT_REQUEST_OTHER_MENU_KEY),
      false
    );
  });

  test("차례가 사이드바와 같다 — 대시보드 → 그 하위메뉴 → 구획 차례대로 → 기타", () => {
    // Sidebar.tsx 가 그리는 차례를 그대로 적은 것이다 — 대시보드 단독, 그 아래
    // 하위메뉴, 그다음 navGroups 차례대로 각 구획의 itemKeys 차례.
    const expected = [
      { key: "dashboard", label: navLabel("dashboard"), groupLabel: null },
      ...childNavItems(navItems, "dashboard").map((i) => ({ key: i.key, label: i.label, groupLabel: null })),
      ...navGroups.flatMap((g) => g.itemKeys.map((key) => ({ key, label: navLabel(key), groupLabel: g.label }))),
      { key: IMPROVEMENT_REQUEST_OTHER_MENU_KEY, label: "기타 · 메뉴 밖", groupLabel: null },
    ];
    assert.deepEqual(options, expected);
  });

  test("지금 사이드바로 몇 자리를 못 박는다", () => {
    assert.deepEqual(keys.slice(0, 3), ["dashboard", "weeklyReport", "repairCases"]);
    assert.deepEqual(
      options.slice(0, 3).map((o) => o.groupLabel),
      [null, null, "A/S 업무"],
      "대시보드 · 주간보고는 구획이 없다"
    );
    // 구획 차례이지 navItems 차례가 아니다 — 사용자 관리는 navItems 에서 고객사
    // 관리보다 앞이지만, 사이드바에서는 「관리」 구획 뒤의 「설정」 구획에 있다.
    assert.ok(keys.indexOf("users") > keys.indexOf("productModels"));
    assert.deepEqual(keys.slice(-3), ["improvementRequests", "developerMode", IMPROVEMENT_REQUEST_OTHER_MENU_KEY]);
  });

  test("모든 navItems 가 정확히 한 번 들어 있다", () => {
    for (const item of navItems) {
      assert.equal(keys.filter((k) => k === item.key).length, 1, item.key);
    }
    assert.equal(options.length, navItems.length + 1, "navItems 전부 + 기타 하나");
  });

  test("이름은 사이드바 이름표 그대로다 — 따로 적지 않는다", () => {
    for (const option of options.slice(0, -1)) assert.equal(option.label, navLabel(option.key), option.key);
  });

  test("기타가 맨 끝이고 구획이 없다", () => {
    assert.deepEqual(options.at(-1), {
      key: IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
      label: "기타 · 메뉴 밖",
      groupLabel: null,
    });
    assert.equal(keys.indexOf(IMPROVEMENT_REQUEST_OTHER_MENU_KEY), keys.length - 1);
  });

  test("열쇠 → 이름 — NULL · 기타 · 모르는 열쇠", () => {
    assert.equal(improvementRequestMenuLabel(null), "메뉴 지정 안 함");
    assert.equal(improvementRequestMenuLabel(IMPROVEMENT_REQUEST_OTHER_MENU_KEY), "기타 · 메뉴 밖");
    assert.equal(improvementRequestMenuLabel("noSuchMenu"), "(없어진 메뉴)");
    assert.equal(improvementRequestMenuLabel(""), "(없어진 메뉴)");
    for (const item of navItems) assert.equal(improvementRequestMenuLabel(item.key), item.label, item.key);
  });

  test("고를 수 있는 열쇠 판정", () => {
    for (const key of keys) assert.equal(isImprovementRequestMenuKey(key), true, key);
    // 이름표 · 주소 · 구획 열쇠 · 대소문자 · 공백은 열쇠가 아니다.
    for (const bad of ["대시보드", "/dashboard", "asOperations", "Dashboard", " dashboard", "", null, undefined, 1, {}]) {
      assert.equal(isImprovementRequestMenuKey(bad), false, String(bad));
    }
  });

  test("menu_key 칸은 NULL 을 허용하고 기본값이 없다 — NULL = 메뉴 지정 안 함", () => {
    assert.equal(improvementRequests.menuKey.name, "menu_key");
    assert.equal(improvementRequests.menuKey.notNull, false);
    assert.equal(improvementRequests.menuKey.hasDefault, false);
  });

  test("복사 글은 「[개선요청 메뉴 : 메뉴 이름] 본문」이다", () => {
    // 메뉴 있음 — 사용자가 든 예(2026-09-13) 그대로.
    assert.equal(
      improvementRequestCopyText({ menuKey: "domesticOrders", body: "표가 느려요" }),
      `[개선요청 메뉴 : ${navLabel("domesticOrders")}] 표가 느려요`
    );
    assert.equal(
      improvementRequestCopyText({ menuKey: "repairCases", body: "본문" }),
      `[개선요청 메뉴 : ${navLabel("repairCases")}] 본문`
    );
    // 메뉴 지정 안 함(NULL) — 메뉴 칸이 생기기 전의 옛 글.
    assert.equal(improvementRequestCopyText({ menuKey: null, body: "본문" }), "[개선요청 메뉴 : 메뉴 지정 안 함] 본문");
    // 기타.
    assert.equal(
      improvementRequestCopyText({ menuKey: IMPROVEMENT_REQUEST_OTHER_MENU_KEY, body: "본문" }),
      "[개선요청 메뉴 : 기타 · 메뉴 밖] 본문"
    );
    // 없어진 메뉴 — 모르는 열쇠, 빈 열쇠.
    assert.equal(improvementRequestCopyText({ menuKey: "noSuchMenu", body: "본문" }), "[개선요청 메뉴 : (없어진 메뉴)] 본문");
    assert.equal(improvementRequestCopyText({ menuKey: "", body: "본문" }), "[개선요청 메뉴 : (없어진 메뉴)] 본문");
    // 고를 수 있는 모든 메뉴가 같은 모양이다 — 이름은 목록의 이름표 그대로.
    for (const option of listImprovementRequestMenuOptions()) {
      assert.equal(
        improvementRequestCopyText({ menuKey: option.key, body: "본문" }),
        `[개선요청 메뉴 : ${option.label}] 본문`,
        option.key
      );
    }
    // 본문은 줄바꿈까지 그대로다(빈 줄 · 끝 줄바꿈 포함).
    assert.equal(
      improvementRequestCopyText({ menuKey: "quotes", body: "첫 줄\n둘째 줄" }),
      `[개선요청 메뉴 : ${navLabel("quotes")}] 첫 줄\n둘째 줄`,
      "본문은 줄바꿈까지 그대로다"
    );
    assert.equal(
      improvementRequestCopyText({ menuKey: null, body: "첫 줄\n\n셋째 줄\n" }),
      "[개선요청 메뉴 : 메뉴 지정 안 함] 첫 줄\n\n셋째 줄\n"
    );
  });
});

describe("이 사람이 고를 수 있는 메뉴 — 사이드바와 같은 것만", () => {
  /** 개발자 모드를 뺀 모든 메뉴 열쇠 — 모든 영역에 접근할 수 있는 사람. */
  const ALL_AREA_KEYS = navItems.map((i) => i.key).filter((k) => k !== DEVELOPER_MODE_NAV_KEY);
  const keysOf = (input: { accessibleAreaKeys: readonly string[]; canEnterDeveloperMode: boolean }) =>
    listSidebarImprovementRequestMenuOptions(input).map((o) => o.key);

  test("모든 영역을 보는 개발자는 전체 목록 그대로다", () => {
    assert.deepEqual(
      listSidebarImprovementRequestMenuOptions({ accessibleAreaKeys: ALL_AREA_KEYS, canEnterDeveloperMode: true }),
      listImprovementRequestMenuOptions()
    );
  });

  test("개발자가 아니면 「개발자 모드」가 빠진다 — 나머지는 그대로", () => {
    assert.deepEqual(
      keysOf({ accessibleAreaKeys: ALL_AREA_KEYS, canEnterDeveloperMode: false }),
      listImprovementRequestMenuOptions()
        .map((o) => o.key)
        .filter((k) => k !== DEVELOPER_MODE_NAV_KEY)
    );
    // 영역 목록에 열쇠를 넣어도 열리지 않는다 — filterNavItemsForAccess 의 예외 그대로다.
    assert.ok(
      !keysOf({ accessibleAreaKeys: [...ALL_AREA_KEYS, DEVELOPER_MODE_NAV_KEY], canEnterDeveloperMode: false }).includes(
        DEVELOPER_MODE_NAV_KEY
      )
    );
  });

  test("보는 메뉴만, 사이드바 차례대로, 구획 이름과 함께 — 기타는 늘 맨 끝", () => {
    const options = listSidebarImprovementRequestMenuOptions({
      // 받은 차례는 뒤섞어 둔다 — 차례는 사이드바 것이다.
      accessibleAreaKeys: ["improvementRequests", "quotes", "repairCases"],
      canEnterDeveloperMode: false,
    });
    assert.deepEqual(
      options.map((o) => [o.key, o.groupLabel]),
      [
        ["repairCases", "A/S 업무"],
        ["quotes", "PO / 내자"],
        ["improvementRequests", "설정"],
        [IMPROVEMENT_REQUEST_OTHER_MENU_KEY, null],
      ]
    );
  });

  test("보는 메뉴가 하나도 없어도 기타는 있다", () => {
    assert.deepEqual(keysOf({ accessibleAreaKeys: [], canEnterDeveloperMode: false }), [
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
    assert.deepEqual(keysOf({ accessibleAreaKeys: [], canEnterDeveloperMode: true }), [
      DEVELOPER_MODE_NAV_KEY,
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
  });

  test("하위메뉴는 부모가 보일 때만 — 사이드바가 부모 없는 하위메뉴를 그리지 않는다", () => {
    assert.deepEqual(keysOf({ accessibleAreaKeys: ["weeklyReport"], canEnterDeveloperMode: false }), [
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
    assert.deepEqual(keysOf({ accessibleAreaKeys: ["dashboard"], canEnterDeveloperMode: false }), [
      "dashboard",
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
    assert.deepEqual(keysOf({ accessibleAreaKeys: ["weeklyReport", "dashboard"], canEnterDeveloperMode: false }), [
      "dashboard",
      "weeklyReport",
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
  });

  test("모르는 영역 열쇠는 아무것도 더하지 않는다", () => {
    assert.deepEqual(keysOf({ accessibleAreaKeys: ["noSuchArea", "inventory.parts"], canEnterDeveloperMode: false }), [
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
  });

  test("추린 목록 밖의 열쇠도 검증은 받는다 — 판정은 전체 목록이다", () => {
    const narrow = keysOf({ accessibleAreaKeys: ["repairCases"], canEnterDeveloperMode: false });
    assert.ok(!narrow.includes("quotes"));
    assert.ok(!narrow.includes(DEVELOPER_MODE_NAV_KEY));
    assert.equal(isImprovementRequestMenuKey("quotes"), true);
    assert.equal(isImprovementRequestMenuKey(DEVELOPER_MODE_NAV_KEY), true);
  });
});

describe("고치는 글의 지금 메뉴를 선택지에 둔다", () => {
  const narrow = listSidebarImprovementRequestMenuOptions({
    accessibleAreaKeys: ["repairCases"],
    canEnterDeveloperMode: false,
  });
  const keysOf = (options: readonly { key: string }[]) => options.map((o) => o.key);

  test("목록에 없는 올바른 열쇠는 사이드바 차례 자리에 더한다", () => {
    assert.deepEqual(keysOf(narrow), ["repairCases", IMPROVEMENT_REQUEST_OTHER_MENU_KEY]);
    assert.deepEqual(keysOf(includeImprovementRequestMenuOption(narrow, "quotes")), [
      "repairCases",
      "quotes",
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
    assert.deepEqual(keysOf(includeImprovementRequestMenuOption(narrow, "dashboard")), [
      "dashboard",
      "repairCases",
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
    assert.deepEqual(keysOf(includeImprovementRequestMenuOption(narrow, DEVELOPER_MODE_NAV_KEY)), [
      "repairCases",
      DEVELOPER_MODE_NAV_KEY,
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY,
    ]);
  });

  test("더한 항목은 전체 목록의 것 그대로다(이름 · 구획)", () => {
    const added = includeImprovementRequestMenuOption(narrow, "quotes").find((o) => o.key === "quotes");
    assert.deepEqual(
      added,
      listImprovementRequestMenuOptions().find((o) => o.key === "quotes")
    );
  });

  test("이미 있거나 · 메뉴 없음(NULL) · 없어진 메뉴면 그대로다", () => {
    for (const menuKey of ["repairCases", IMPROVEMENT_REQUEST_OTHER_MENU_KEY, null, "noSuchMenu", ""]) {
      assert.deepEqual(includeImprovementRequestMenuOption(narrow, menuKey), narrow, String(menuKey));
    }
  });

  test("받은 배열을 건드리지 않는다 — 페이지가 넘긴 props 다", () => {
    const before = keysOf(narrow);
    const result = includeImprovementRequestMenuOption(narrow, "quotes");
    assert.notEqual(result, narrow);
    assert.deepEqual(keysOf(narrow), before);
    assert.notEqual(includeImprovementRequestMenuOption(narrow, null), narrow, "그대로여도 새 배열이다");
  });
});

describe("선택칸 묶음", () => {
  test("전체 목록 — 맨 위 묶음 없이 대시보드 · 주간보고, 구획마다 한 묶음, 맨 끝 묶음 없이 기타", () => {
    const options = listImprovementRequestMenuOptions();
    const sections = groupImprovementRequestMenuOptions(options);
    assert.deepEqual(
      sections.map((s) => s.groupLabel),
      [null, ...navGroups.map((g) => g.label), null]
    );
    assert.deepEqual(
      sections[0].options.map((o) => o.key),
      ["dashboard", ...childNavItems(navItems, "dashboard").map((i) => i.key)]
    );
    assert.deepEqual(
      sections.at(-1)?.options.map((o) => o.key),
      [IMPROVEMENT_REQUEST_OTHER_MENU_KEY]
    );
    assert.deepEqual(
      sections.flatMap((s) => s.options),
      options,
      "묶어도 차례와 항목은 그대로다"
    );
  });

  test("대시보드를 못 보는 사람은 첫 묶음이 구획이다", () => {
    const sections = groupImprovementRequestMenuOptions(
      listSidebarImprovementRequestMenuOptions({
        accessibleAreaKeys: ["repairCases", "myActiveWork", "quotes"],
        canEnterDeveloperMode: false,
      })
    );
    assert.deepEqual(
      sections.map((s) => [s.groupLabel, s.options.map((o) => o.key)]),
      [
        ["A/S 업무", ["repairCases", "myActiveWork"]],
        ["PO / 내자", ["quotes"]],
        [null, [IMPROVEMENT_REQUEST_OTHER_MENU_KEY]],
      ]
    );
  });

  test("빈 목록은 빈 묶음", () => {
    assert.deepEqual(groupImprovementRequestMenuOptions([]), []);
  });
});

describe("메뉴로 거르기", () => {
  type Row = { id: string; menuKey: string | null; status: ImprovementRequestStatus; createdAt: string };
  let seq = 0;
  const row = (menuKey: string | null, status: ImprovementRequestStatus): Row => {
    seq += 1;
    return { id: `r${seq}`, menuKey, status, createdAt: `2026-09-${String(seq).padStart(2, "0")}T00:00:00.000Z` };
  };

  // 조회 차례와 상관없이 섞어 둔다. 없어진 열쇠는 둘이다 — 한 칸으로 모여야 한다.
  const ITEMS: Row[] = [
    row("quotes", "OPEN"),
    row("repairCases", "IN_PROGRESS"),
    row(null, "OPEN"),
    row("repairCases", "RESOLVED"),
    row("noSuchMenu", "OPEN"),
    row(IMPROVEMENT_REQUEST_OTHER_MENU_KEY, "OPEN"),
    row("dashboard", "RESOLVED"),
    row("repairCases", "OPEN"),
    row("goneMenu", "RESOLVED"),
    row(null, "RESOLVED"),
  ];

  test("거르기 값 셋은 어떤 메뉴 열쇠와도, 서로와도 겹치지 않는다", () => {
    const sentinels = [
      IMPROVEMENT_REQUEST_MENU_FILTER_ALL,
      IMPROVEMENT_REQUEST_MENU_FILTER_NONE,
      IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN,
    ];
    assert.equal(new Set(sentinels).size, 3);
    for (const value of sentinels) {
      assert.equal(isImprovementRequestMenuKey(value), false, value);
      assert.equal(
        listImprovementRequestMenuOptions().some((o) => o.key === value),
        false,
        value
      );
    }
  });

  test("글 하나가 들어가는 칸 — 메뉴 열쇠 그대로 · NULL · 모르는 열쇠", () => {
    assert.equal(improvementRequestMenuFilterValue("repairCases"), "repairCases");
    assert.equal(
      improvementRequestMenuFilterValue(IMPROVEMENT_REQUEST_OTHER_MENU_KEY),
      IMPROVEMENT_REQUEST_OTHER_MENU_KEY
    );
    assert.equal(improvementRequestMenuFilterValue(null), IMPROVEMENT_REQUEST_MENU_FILTER_NONE);
    for (const unknown of ["noSuchMenu", "", "대시보드", IMPROVEMENT_REQUEST_MENU_FILTER_ALL]) {
      assert.equal(improvementRequestMenuFilterValue(unknown), IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN, unknown);
    }
  });

  test("고른 칸의 글만 남긴다 — 차례는 그대로, 없어진 열쇠들은 한 칸", () => {
    const ids = (rows: readonly Row[]) => rows.map((r) => r.id);
    assert.deepEqual(ids(filterImprovementRequestsByMenu(ITEMS, IMPROVEMENT_REQUEST_MENU_FILTER_ALL)), ids(ITEMS));
    assert.deepEqual(ids(filterImprovementRequestsByMenu(ITEMS, "repairCases")), ["r2", "r4", "r8"]);
    assert.deepEqual(ids(filterImprovementRequestsByMenu(ITEMS, IMPROVEMENT_REQUEST_MENU_FILTER_NONE)), ["r3", "r10"]);
    assert.deepEqual(ids(filterImprovementRequestsByMenu(ITEMS, IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN)), ["r5", "r9"]);
    assert.deepEqual(ids(filterImprovementRequestsByMenu(ITEMS, IMPROVEMENT_REQUEST_OTHER_MENU_KEY)), ["r6"]);
    assert.deepEqual(filterImprovementRequestsByMenu(ITEMS, "inventory"), [], "글이 없는 메뉴");
  });

  test("받은 배열을 건드리지 않는다 — 「전체 메뉴」여도 새 배열이다", () => {
    const before = ITEMS.map((r) => r.id);
    const all = filterImprovementRequestsByMenu(ITEMS, IMPROVEMENT_REQUEST_MENU_FILTER_ALL);
    assert.notEqual(all, ITEMS);
    filterImprovementRequestsByMenu(ITEMS, "repairCases");
    assert.deepEqual(
      ITEMS.map((r) => r.id),
      before
    );
  });

  test("해결된 것도 볼 때 — 전체 메뉴 + 글이 있는 메뉴만 사이드바 차례로, 끝에 메뉴 지정 안 함 · 없어진 메뉴", () => {
    const options = listImprovementRequestMenuFilterOptions(ITEMS, {
      showResolved: true,
      selected: IMPROVEMENT_REQUEST_MENU_FILTER_ALL,
    });
    assert.deepEqual(options, [
      { value: IMPROVEMENT_REQUEST_MENU_FILTER_ALL, label: IMPROVEMENT_REQUEST_ALL_MENUS_LABEL, count: 10 },
      { value: "dashboard", label: navLabelOf("dashboard"), count: 1 },
      { value: "repairCases", label: navLabelOf("repairCases"), count: 3 },
      { value: "quotes", label: navLabelOf("quotes"), count: 1 },
      { value: IMPROVEMENT_REQUEST_OTHER_MENU_KEY, label: "기타 · 메뉴 밖", count: 1 },
      { value: IMPROVEMENT_REQUEST_MENU_FILTER_NONE, label: "메뉴 지정 안 함", count: 2 },
      { value: IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN, label: "(없어진 메뉴)", count: 2 },
    ]);
  });

  test("해결된 것을 감출 때 — 해결된 글은 세지 않고, 해결된 글만 있는 메뉴는 빠진다", () => {
    const options = listImprovementRequestMenuFilterOptions(ITEMS, {
      showResolved: false,
      selected: IMPROVEMENT_REQUEST_MENU_FILTER_ALL,
    });
    assert.deepEqual(
      options.map((o) => [o.value, o.count]),
      [
        [IMPROVEMENT_REQUEST_MENU_FILTER_ALL, 6],
        ["repairCases", 2],
        ["quotes", 1],
        [IMPROVEMENT_REQUEST_OTHER_MENU_KEY, 1],
        [IMPROVEMENT_REQUEST_MENU_FILTER_NONE, 1],
        [IMPROVEMENT_REQUEST_MENU_FILTER_UNKNOWN, 1],
      ]
    );
  });

  test("지금 고른 칸은 0건이어도 제자리에 남는다", () => {
    const options = listImprovementRequestMenuFilterOptions(ITEMS, { showResolved: false, selected: "dashboard" });
    assert.deepEqual(
      options.slice(0, 3).map((o) => [o.value, o.count]),
      [
        [IMPROVEMENT_REQUEST_MENU_FILTER_ALL, 6],
        ["dashboard", 0],
        ["repairCases", 2],
      ]
    );
    // 글이 한 번도 없던 메뉴를 골라 둔 채여도(마지막 글을 지운 뒤) 남는다.
    assert.ok(
      listImprovementRequestMenuFilterOptions([], { showResolved: true, selected: "inventory" }).some(
        (o) => o.value === "inventory" && o.count === 0
      )
    );
    // 모르는 값을 골라 둔 채면 더하지 않는다 — 메뉴 칸도 거르기 칸도 아니다.
    assert.deepEqual(
      listImprovementRequestMenuFilterOptions([], { showResolved: true, selected: "noSuchMenu" }).map((o) => o.value),
      [IMPROVEMENT_REQUEST_MENU_FILTER_ALL]
    );
  });

  test("글이 없으면 「전체 메뉴」(0) 하나다", () => {
    assert.deepEqual(
      listImprovementRequestMenuFilterOptions([], { showResolved: false, selected: IMPROVEMENT_REQUEST_MENU_FILTER_ALL }),
      [{ value: IMPROVEMENT_REQUEST_MENU_FILTER_ALL, label: IMPROVEMENT_REQUEST_ALL_MENUS_LABEL, count: 0 }]
    );
  });

  test("칸 옆 건수 = 그 칸을 고르면 보이는 줄 수 — 해결된 것 보기 둘 다", () => {
    for (const showResolved of [false, true]) {
      const options = listImprovementRequestMenuFilterOptions(ITEMS, {
        showResolved,
        selected: IMPROVEMENT_REQUEST_MENU_FILTER_ALL,
      });
      for (const option of options) {
        const { rows } = arrangeImprovementRequestList(filterImprovementRequestsByMenu(ITEMS, option.value), {
          showResolved,
        });
        assert.equal(option.count, rows.length, `${option.value} · showResolved=${showResolved}`);
      }
    }
  });

  function navLabelOf(key: string): string {
    const item = navItems.find((i) => i.key === key);
    assert.ok(item, `navItems 에 ${key} 가 없다`);
    return item.label;
  }
});
