import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES,
  deriveApprovalRouteDelegationDisplayStatus,
  type ApprovalRouteDelegationDisplayStatus,
} from "@/lib/domain/approval-route-delegation";

/**
 * ============================================================================
 * [결재권 위임] 앞의 두 묶음 — **끝난 위임을 접어 둔다** (2026-11-17)
 * ============================================================================
 * 사용자가 말한 자리: 「내가 대신하고 있는 것」에 **이미 만료된 위임이 쌓여** 있어
 * 지금 누가 내 결재를 대신하고 있는지가 그 사이에 묻혔다. 줄을 지우는 길이 없고
 * (표 머리말) 끝난 줄에는 할 수 있는 일도 없다 — 되돌리기는 서버가
 * `DELEGATION_EXPIRED` 로 거절한다.
 *
 * 🔴 **빼지 않고 접는다.** 아예 안 그리면 「분명히 맡겼는데 아무 데도 없다」가 되고
 * 그때 찾을 곳이 감사 로그밖에 없다. 접힌 머리에 건수를 적어 두면 **있다는 사실은
 * 남고** 자리는 한 줄로 줄어든다.
 *
 * 여기서 지키는 것:
 *
 *   ㉠ 🔴 **살아 있는 줄은 접기 밖에 그대로** 있고, 끝난 줄만 접기 안에 있다.
 *   ㉡ 🔴 **두 묶음의 접기가 서로 따로 기억된다** — 한쪽을 펴면 다른 쪽도 펴지면
 *      안 된다. 두 묶음은 서로 다른 때 들여다보는 것이고, 네 접기가 **같은 글자**를
 *      쓰므로 한 상태로 묶이면 더 헷갈린다.
 *   ㉢ 🔵 **끝난 것이 0건이면 접기 자체를 안 그린다** — 눌러도 빈 목록만 나오는
 *      단추를 남기지 않는다.
 *   ㉣ 🔴 **상한에 잘렸으면 말해 준다**, 그리고 그 숫자를 화면이 글자로 박지 않는다.
 *      🔴 상한은 **방향마다** 걸린다(한쪽이 다른 쪽을 밀어내면 안 된다).
 *   ㉤ 🔴 **전 사용자에게 열린다** — 접기는 권한으로 가르지 않는다. 「모두의」 묶음의
 *      [끝난 위임 보기]가 관리 권한 뒤에 있는 것과 다른 자리다.
 *   ㉥ 🔴 **뒤의 두 묶음(「모두의」·통합 승인함)은 안 바뀌었다.**
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * `ApprovalRouteDelegationSection` 은 **서버 액션을 직접 가져오는 클라이언트
 * 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는
 * `test:components` 에서는 import 자체가 던진다(이웃 둘의 머리말에 같은 경위가
 * 있다 — approval-route-delegation-section.test.ts ·
 * portal-approval-delegation-section.test.ts).
 *
 * 🔵 그래서 **값으로 재야 하는 것**(어느 딱지가 접기 안으로 가는가)은 떼어 둔 도메인
 * 함수로 실제로 돌려 보고, **자리**(접기 밖/안 · 상태가 둘인가)는 원본의 차례로 잰다.
 * 「실제로 갈려 나오는가」는 실제 DB 로 도는
 * `db/mutations/approval-route-delegations.integration.test.ts` 가 가진다 — 거기서
 * 상한(50)을 넘겨 보고 **방향마다** 잘리는 것까지 센다.
 * ============================================================================
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/**
 * 주석은 경위를 적는 자리다 — 지키는 것은 **코드**뿐이다. 이 파일의 단언 여럿이
 * 「…가 없다」 꼴이고, 거꾸로 「있어야 한다」 쪽은 **주석만으로 영영 통과**한다.
 * 이 묶음의 머리말이 바로 그 낱말들(「끝난 위임」·「접기」)을 길게 적어 두어서 더 그렇다.
 *
 * 🔴 앞이 `:` 인 `//` 는 건드리지 않는다(`http://…`) — 이웃 두 시험과 같은 규칙이다.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
}

const SECTION = "src/components/users/ApprovalRouteDelegationSection.tsx";
const QUERIES = "src/lib/db/queries/approval-route-delegations.ts";

const sectionCode = withoutComments(read(SECTION));
const queriesCode = withoutComments(read(QUERIES));

/**
 * 네 묶음을 끊는다. 🔴 끊는 자리가 틀리면 아래 단언이 엉뚱한 데를 잰다.
 *
 * 🔴 세 번째 묶음은 **머리글이 아니라 자료 울타리에서** 시작한다 — 머리글
 * (「모두의 결재권 위임」)보다 `{allRouteDelegations && (` 가 **앞**에 있어서,
 * 머리글로 끊으면 그 울타리가 앞 묶음 조각에 딸려 들어온다. 그러면 「앞의 두 묶음은
 * 권한을 안 본다」가 거짓으로 걸린다(실제로 한 번 걸렸다).
 */
const ALL_GROUP_OPENER = "{allRouteDelegations && (";
const givenBlock = sliceBetween(sectionCode, "내가 맡긴 것", "내가 대신하고 있는 것");
const receivedBlock = sliceBetween(sectionCode, "내가 대신하고 있는 것", ALL_GROUP_OPENER);
const allBlock = sliceBetween(
  sectionCode,
  ALL_GROUP_OPENER,
  "통합 승인함에서 맡긴 결재권 위임"
);
const portalBlock = sectionCode.slice(sectionCode.indexOf("통합 승인함에서 맡긴 결재권 위임"));

/** 한 묶음의 접기를 재는 데 필요한 글자들 — 묶음마다 이름만 다르다. */
type FoldSpec = {
  label: string;
  block: string;
  /** 자료 꼭지(`routeDelegations.given` 등). */
  source: string;
  /** 접기 상태 이름. */
  state: string;
};

const GIVEN_FOLD: FoldSpec = {
  label: "내가 맡긴 것",
  block: givenBlock,
  source: "routeDelegations.given",
  state: "showGivenFinished",
};
const RECEIVED_FOLD: FoldSpec = {
  label: "내가 대신하고 있는 것",
  block: receivedBlock,
  source: "routeDelegations.received",
  state: "showReceivedFinished",
};
const FOLDS = [GIVEN_FOLD, RECEIVED_FOLD] as const;

/* ------------------------------------------------------------------ */
/* 0. 자르는 자리가 실제로 맞다 — 빈 조각에 단언을 걸지 않는다          */
/* ------------------------------------------------------------------ */

describe("0. 재려는 조각이 실제로 거기 있다", () => {
  test("🔴 네 묶음이 **차례대로** 잘리고, 조각마다 제 목록이 들어 있다", () => {
    // 조각이 비었거나 서로 삼켜 버리면 아래의 「…가 없다」 단언들이 전부 공짜로
    // 통과한다. 먼저 조각마다 **있어야 할 글자**로 자리를 확인한다.
    assert.ok(givenBlock.includes('listId="approval-route-delegations-given"'));
    assert.ok(receivedBlock.includes('listId="approval-route-delegations-received"'));
    assert.ok(allBlock.includes('listId="approval-route-delegations-all"'));
    assert.ok(portalBlock.includes('listId="portal-approval-delegations-given"'));
    // 🔴 앞 조각이 뒤 묶음을 삼키지 않았다 — 삼켰다면 「안 바뀌었다」(㉥)가 거짓으로
    //    통과하고, 두 묶음의 접기를 가르는 단언도 뜻을 잃는다.
    assert.ok(!givenBlock.includes("내가 대신하고 있는 것"));
    assert.ok(!receivedBlock.includes("모두의 결재권 위임"));
    assert.ok(!receivedBlock.includes(ALL_GROUP_OPENER));
    assert.ok(allBlock.includes("모두의 결재권 위임"), "세 번째 묶음 조각이 머리글 앞에서 끊겼다");
    assert.ok(!allBlock.includes("통합 승인함에서 맡긴 결재권 위임"));
  });

  test("🔴 접기가 두 묶음에 **각각** 있다 — 하나만 만들고 넘어가지 않았다", () => {
    for (const fold of FOLDS) {
      assert.ok(
        fold.block.includes(`setShow`),
        `「${fold.label}」 묶음에 접기 단추가 없다`
      );
      assert.ok(
        fold.block.includes(`${fold.source}.finished`),
        `「${fold.label}」 묶음이 끝난 줄을 쓰지 않는다`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* ㉠ 살아 있는 줄은 접기 밖, 끝난 줄은 접기 안                          */
/* ------------------------------------------------------------------ */

describe("㉠ 접기 밖과 안", () => {
  test("🔴 살아 있는 줄은 접기 **밖**에 그대로 있다", () => {
    for (const fold of FOLDS) {
      const foldAt = fold.block.indexOf(`{${fold.state} && (`);
      assert.ok(foldAt > 0, `「${fold.label}」 묶음에서 접기가 여는 자리를 못 찾았다`);

      // 🔴 살아 있는 줄을 도는 자리(표·카드 둘)가 **전부** 접기보다 앞이어야 한다.
      //    하나라도 뒤로 가면 그 줄은 펴야만 보인다 — 지금 누가 대신하고 있는지가
      //    접힌 채로 사라지는 것이 바로 이 조각이 고치려는 일이다.
      const liveAt = [...fold.block.matchAll(new RegExp(`${fold.source}\\.live\\.map\\(`, "g"))].map(
        (match) => match.index ?? -1
      );
      assert.equal(liveAt.length, 2, `「${fold.label}」: 살아 있는 줄을 도는 자리가 표·카드 둘이 아니다`);
      for (const at of liveAt) {
        assert.ok(at < foldAt, `「${fold.label}」: 살아 있는 줄이 접기 안으로 들어갔다`);
      }
    }
  });

  test("🔴 끝난 줄은 접기 **안**에 있다 — 펴야 보인다", () => {
    for (const fold of FOLDS) {
      const foldAt = fold.block.indexOf(`{${fold.state} && (`);
      const finishedAt = [
        ...fold.block.matchAll(new RegExp(`${fold.source}\\.finished\\.map\\(`, "g")),
      ].map((match) => match.index ?? -1);
      assert.equal(
        finishedAt.length,
        2,
        `「${fold.label}」: 끝난 줄을 도는 자리가 표·카드 둘이 아니다`
      );
      for (const at of finishedAt) {
        assert.ok(at > foldAt, `「${fold.label}」: 끝난 줄이 접기 밖에 그려진다`);
      }
    }
  });

  test("🔴 접힌 머리에 **건수**가 적힌다 — 접혀 있어도 있다는 사실은 남는다", () => {
    for (const fold of FOLDS) {
      assert.match(
        flat(fold.block),
        new RegExp(`끝난 위임 보기 \\(\\$\\{${fold.source}\\.finished\\.length\\}건`),
        `「${fold.label}」: 접힌 머리에 건수가 없다 — 끝난 줄이 통째로 사라진 것처럼 보인다`
      );
      assert.ok(
        fold.block.includes("끝난 위임 접기"),
        `「${fold.label}」: 다시 접는 글자가 없다`
      );
    }
  });

  test("🔴 접기 안에서 줄을 **다시 거르지** 않는다 — 가르는 자리는 조회 하나다", () => {
    // 화면이 한 번 더 거르면 같은 뜻의 판정이 두 벌이 되고, 한쪽만 고쳐지는 날
    // 「조회는 내줬는데 화면에 없다」가 된다. 그 어긋남은 오류를 내지 않는다.
    for (const fold of FOLDS) {
      assert.ok(
        !new RegExp(`${fold.source}\\.(live|finished)\\.(filter|slice)\\(`).test(fold.block),
        `「${fold.label}」: 화면이 받은 목록을 다시 거르거나 자른다`
      );
    }
    assert.ok(
      !/deriveApprovalRouteDelegationDisplayStatus\(delegation\) ===/.test(sectionCode),
      "화면이 딱지로 접기를 가른다 — 조회의 조건과 갈리는 날이 온다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉠-값 접기 안에 들어가는 딱지는 **만료·철회됨** 둘뿐이다              */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-11-17T12:00:00.000Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

const STATUS_SAMPLES: ReadonlyArray<
  [ApprovalRouteDelegationDisplayStatus, { startsAt: Date; endsAt: Date; revokedAt: Date | null }]
> = [
  ["ACTIVE", { startsAt: hours(-1), endsAt: hours(1), revokedAt: null }],
  ["SCHEDULED", { startsAt: hours(1), endsAt: hours(2), revokedAt: null }],
  ["EXPIRED", { startsAt: hours(-2), endsAt: hours(-1), revokedAt: null }],
  // 🔴 기간은 **아직 남아 있다.** 되돌림만으로 접기 안에 가는지 보려는 것이다 —
  //    기간까지 끝난 줄로 재면 두 조건 가운데 어느 쪽이 일했는지 알 수 없다.
  ["REVOKED", { startsAt: hours(-1), endsAt: hours(1), revokedAt: hours(-0.5) }],
];

/**
 * 조회가 SQL 로 거르는 규칙을 **그대로 옮긴 잣대**(`revoked_at IS NOT NULL OR
 * ends_at <= now`). 🔵 베껴 적은 값이라 「조회가 정말 이렇게 거르는가」는 못 잰다 —
 * 그쪽은 실제 DB 로 도는 시험과 아래 ㉣ 의 글자 맞대기가 지킨다. 여기서 재는 것은
 * **그 규칙과 네 딱지의 짝**이다: 접기 안에 들어갈 줄이 곧 「만료」와 「철회됨」인가.
 */
const isFinishedByQueryRule = (row: { endsAt: Date; revokedAt: Date | null }) =>
  row.revokedAt !== null || row.endsAt.getTime() <= NOW.getTime();

describe("㉠-값 어느 줄이 접히는가", () => {
  test("🔴 재려는 것이 비어 있지 않다 — 표본이 네 상태를 전부 만든다", () => {
    assert.equal(STATUS_SAMPLES.length, 4);
    assert.deepEqual(
      STATUS_SAMPLES.map(([status]) => status),
      [...APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES],
      "도메인이 아는 상태와 이 시험의 표본이 어긋났다"
    );
    for (const [expected, row] of STATUS_SAMPLES) {
      assert.equal(
        deriveApprovalRouteDelegationDisplayStatus(row, NOW),
        expected,
        `${expected}: 표본이 다른 상태로 풀린다`
      );
    }
  });

  test("🔴 접히는 줄 = 「만료」·「철회됨」, 펴진 줄 = 「활성」·「예정」", () => {
    const folded: ApprovalRouteDelegationDisplayStatus[] = [];
    const open: ApprovalRouteDelegationDisplayStatus[] = [];
    for (const [status, row] of STATUS_SAMPLES) {
      (isFinishedByQueryRule(row) ? folded : open).push(status);
    }
    assert.deepEqual(folded.sort(), ["EXPIRED", "REVOKED"], "접히는 줄의 집합이 달라졌다");
    assert.deepEqual(
      open.sort(),
      ["ACTIVE", "SCHEDULED"],
      "아직 시작 안 한 위임(예정)이 접혔다 — 앞으로 쓸 위임이 접기 안으로 사라진다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉡ 두 접기가 서로 따로 기억된다                                       */
/* ------------------------------------------------------------------ */

describe("㉡ 접기 상태", () => {
  test("🔴 네 묶음이 **각자의** 상태를 갖는다 — 이름도 차례도 못 박는다", () => {
    const states = [...sectionCode.matchAll(/const \[(show\w+), setShow\w+\] = useState\(false\);/g)].map(
      ([, name]) => name
    );
    assert.deepEqual(
      states,
      ["showGivenFinished", "showReceivedFinished", "showFinished", "showPortalFinished"],
      "접기 상태가 넷이 아니거나 이름이 달라졌다"
    );
    assert.equal(new Set(states).size, 4, "두 묶음이 같은 상태를 나눠 쓴다");
  });

  test("🔴 한 묶음이 **제 상태만** 만진다 — 한쪽을 펴면 다른 쪽도 펴지면 안 된다", () => {
    for (const fold of FOLDS) {
      const others = ["showGivenFinished", "showReceivedFinished", "showFinished", "showPortalFinished"].filter(
        (name) => name !== fold.state
      );
      assert.ok(fold.block.includes(fold.state), `「${fold.label}」: 제 상태를 안 쓴다`);
      for (const other of others) {
        assert.ok(
          !fold.block.includes(other),
          `「${fold.label}」 묶음이 남의 접기 상태(${other})를 만진다`
        );
      }
    }
  });

  test("접는 단추가 제 상태를 **뒤집는다** — 켜기만 하고 못 접는 단추가 아니다", () => {
    for (const fold of FOLDS) {
      assert.match(
        flat(fold.block),
        new RegExp(`setShow\\w+\\(\\(previous\\) => !previous\\)`),
        `「${fold.label}」: 단추가 상태를 뒤집지 않는다`
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* ㉢ 끝난 것이 0건이면 접기 자체가 없다                                 */
/* ------------------------------------------------------------------ */

describe("㉢ 0건일 때", () => {
  test("🔴 접기를 `finished.length > 0` 로 여닫는다", () => {
    for (const fold of FOLDS) {
      assert.match(
        flat(fold.block),
        new RegExp(`\\{${fold.source}\\.finished\\.length > 0 && \\(`),
        `「${fold.label}」: 끝난 것이 0건이어도 접기가 그려진다 — 눌러도 빈 목록만 나온다`
      );
      // 🔴 그 울타리가 **단추보다 앞**이어야 한다. 뒤에 있으면 단추는 늘 그려진다.
      const guardAt = fold.block.indexOf(`{${fold.source}.finished.length > 0 && (`);
      const buttonAt = fold.block.indexOf("끝난 위임 접기");
      assert.ok(guardAt > 0 && buttonAt > guardAt, `「${fold.label}」: 단추가 울타리 밖에 있다`);
    }
  });

  test("🔴 빈 목록 글자를 접기 안에 두지 않는다 — 접기 자체가 없으므로 쓸 자리가 없다", () => {
    for (const fold of FOLDS) {
      assert.ok(
        !fold.block.includes("끝나거나 되돌린 결재권 위임이 없습니다"),
        `「${fold.label}」: 0건일 때 쓰는 글자가 남아 있다 — 울타리와 어느 쪽이 참인지 갈린다`
      );
    }
  });

  test("🔵 살아 있는 쪽의 빈 글자는 **「지금」 이야기**로 적는다", () => {
    // 끝난 줄이 접혀 있는 사람에게 「아직 맡긴 결재권이 없습니다」는 거짓말이 된다 —
    // 맡긴 적이 있고, 바로 아래에 그 N건이 적혀 있다.
    assert.ok(givenBlock.includes("지금 맡기고 있는 결재권이 없습니다."));
    assert.ok(receivedBlock.includes("지금 대신하고 있는 결재권이 없습니다."));
    assert.ok(
      !/아직 맡긴 결재권이 없습니다/.test(sectionCode),
      "옛 글자가 남아 있다 — 끝난 줄이 있는 사람에게 거짓이 된다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉣ 상한 — 잘렸으면 말해 주고, 방향마다 따로 건다                      */
/* ------------------------------------------------------------------ */

/** 조회 파일에서 함수 몸통 하나만 잘라낸다. 이웃 조회에 단언이 걸리지 않게 끊는다. */
const userFn = sliceBetween(
  queriesCode,
  "export async function listApprovalRouteDelegationsForUser",
  "export type ApprovalRouteDelegateCandidate"
);
const listAllFn = queriesCode.slice(
  queriesCode.indexOf("export async function listAllApprovalRouteDelegations")
);

/** 같은 이름의 조건절을 꺼내 글자로 맞댄다(이웃 시험이 두 파일 사이에서 하는 일). */
function conditionText(code: string, name: string): string {
  const matched = flat(code).match(new RegExp(`const ${name} = (?:and|or)\\([^;]*\\);`));
  assert.ok(matched, `${name} 조건을 찾지 못했다`);
  return matched[0];
}

describe("㉣ 상한과 「끝났다」의 자", () => {
  test("🔴 재려는 조각이 실제로 조회 둘이다 — 한쪽을 통째로 삼키지 않았다", () => {
    assert.ok(userFn.includes("delegationRowsBase()"), "사용자 조회를 잘못 잘랐다");
    assert.ok(!userFn.includes("hasPermission("), "사용자 조회 조각이 「모두의」 조회를 삼켰다");
    assert.ok(listAllFn.includes("hasPermission("), "「모두의」 조회를 잘못 잘랐다");
  });

  test("🔴 「끝났다」의 자가 「모두의」 조회와 **글자 그대로** 같다", () => {
    // 같은 화면에 네 묶음이 나란히 서는데 자가 갈리면, 같은 날짜의 줄이 한 묶음에서는
    // 접히고 다른 묶음에서는 펴진다 — 사람은 그것을 결함으로 읽는다. 🔵 옆 시험
    // (portal-…)이 포털 조회와 이 파일을 맞대고, 여기서는 **이 파일 안의 두 벌**을
    // 맞댄다. 한 파일 안에 두 벌이 있는 것은 각 조회가 제 질의를 쥐기 때문이다.
    for (const name of ["isLive", "isFinished"]) {
      const mine = conditionText(userFn, name);
      assert.ok(mine.includes("revokedAt") && mine.includes("endsAt"), `${name} 을 잘못 꺼냈다`);
      assert.equal(
        mine,
        conditionText(listAllFn, name),
        `두 조회의 ${name} 이 갈렸다 — 같은 줄이 묶음마다 다른 쪽에 선다`
      );
    }
  });

  test("🔴 상한을 **방향마다** 건다 — 한쪽이 다른 쪽을 밀어내면 안 된다", () => {
    assert.equal(
      [...userFn.matchAll(/\.limit\(FINISHED_DELEGATION_LIMIT \+ 1\)/g)].length,
      2,
      "끝난 줄에 거는 상한이 둘이 아니다 — 두 방향이 한 상한을 나눠 쓰면 한쪽이 통째로 안 보인다"
    );
    // 🔴 살아 있는 줄에는 상한이 없다. 밀려나면 **되돌려야 할 줄**이 안 보인다.
    const liveQuery = sliceBetween(userFn, ".where(and(or(isGiven, isReceived), isLive))", "delegationRowsBase()");
    assert.ok(!liveQuery.includes(".limit("), "살아 있는 줄에 상한이 걸렸다");
    // 숫자는 한 곳에서만 온다 — 네 묶음의 「최근 N건」이 갈리면 결함으로 읽힌다.
    assert.match(flat(queriesCode), /export const FINISHED_DELEGATION_LIMIT = \d+;/);
    assert.match(flat(userFn), /finishedLimit: FINISHED_DELEGATION_LIMIT,/);
  });

  test("🔴 잘렸으면 화면이 말해 주고, 그 숫자를 글자로 박지 않는다", () => {
    for (const fold of FOLDS) {
      assert.match(
        flat(fold.block),
        new RegExp(`\\{${fold.source}\\.finishedTruncated && \\(`),
        `「${fold.label}」: 잘렸다는 것을 말해 주지 않는다 — 「이게 전부」로 읽힌다`
      );
      assert.match(
        flat(fold.block),
        /최근 \{routeDelegations\.finishedLimit\}건만 보여 줍니다/,
        `「${fold.label}」: 상한을 조회에서 받아 적지 않는다`
      );
      // 🔵 접힌 머리의 건수 뒤에도 「+」로 더 있다는 것을 비친다 — 펴기 전에도 보인다.
      assert.match(
        flat(fold.block),
        new RegExp(`\\$\\{${fold.source}\\.finishedTruncated \\? "\\+" : ""\\}`),
        `「${fold.label}」: 접힌 머리에서 「더 있다」가 안 보인다`
      );
    }
    assert.ok(
      !/최근 50건|50건만/.test(sectionCode),
      "상한을 화면에 글자로 박았다 — 조회에서 바꾸면 화면이 거짓말을 한다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉤ 전 사용자에게 열린다 · 접기 안에 단추를 그리지 않는다               */
/* ------------------------------------------------------------------ */

describe("㉤ 누구에게 열리는가", () => {
  test("🔴 접기를 권한으로 가르지 않는다 — 「모두의」 묶음과 다른 자리다", () => {
    for (const fold of FOLDS) {
      for (const forbidden of ["canManageRepresentatives", "allRouteDelegations", "hasPermission("]) {
        assert.ok(
          !fold.block.includes(forbidden),
          `「${fold.label}」 묶음이 ${forbidden} 를 본다 — 접기가 권한 뒤로 숨는다`
        );
      }
    }
    // 🔵 탐지기 확인: 같은 낱말이 「모두의」 묶음에서는 실제로 잡힌다. 안 그러면
    //    위 단언은 무엇을 바꿔도 공짜로 통과한다.
    assert.ok(allBlock.includes("allRouteDelegations"), "탐지기가 더 이상 맞지 않는다");
  });

  test("🔴 접기 안에 [되돌리기]를 그리지 않는다 — 눌러도 거절당하는 단추가 된다", () => {
    // 끝난 줄은 서버가 DELEGATION_EXPIRED 로 거절한다. 🔵 「내가 맡긴 것」의 **살아
    // 있는** 목록에는 그대로 붙어 있어야 하므로, 묶음 통째로가 아니라 **접기 안**만
    // 본다 — 안 그러면 이 단언이 멀쩡한 단추를 걸고 넘어진다.
    for (const fold of FOLDS) {
      const inside = fold.block.slice(fold.block.indexOf(`{${fold.state} && (`));
      for (const marker of ["renderRevokeAction", "handleRevoke", "되돌리기 ", "actions="]) {
        assert.ok(
          !inside.includes(marker),
          `「${fold.label}」 접기 안에 ${marker} 가 들어갔다`
        );
      }
    }
    // 탐지기 확인 — 「내가 맡긴 것」의 살아 있는 줄에는 표·카드 둘 다 붙어 있다.
    assert.equal(
      [...givenBlock.matchAll(/renderRevokeAction\(delegation\)/g)].length,
      2,
      "살아 있는 줄의 되돌리기까지 사라졌다"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉥ 뒤의 두 묶음은 안 바뀌었다                                         */
/* ------------------------------------------------------------------ */

describe("㉥ 「모두의」와 통합 승인함 묶음", () => {
  test("🔴 「모두의」 묶음의 접기가 그대로다 — 0건이어도 단추를 그린다", () => {
    assert.match(
      flat(allBlock),
      /\{showFinished \? "끝난 위임 접기" : `끝난 위임 보기 \(\$\{allRouteDelegations\.finished\.length\}건/,
      "「모두의」 묶음의 접기 글자가 달라졌다"
    );
    assert.ok(
      !allBlock.includes("allRouteDelegations.finished.length > 0"),
      "「모두의」 묶음에도 0건 울타리를 둘렀다 — 이 조각이 건드리지 않기로 한 자리다"
    );
    // 0건일 때 쓰는 글자가 그대로 있다는 것이 그 울타리가 없다는 증거다.
    assert.ok(allBlock.includes("끝나거나 되돌린 결재권 위임이 없습니다."));
  });

  test("🔴 통합 승인함 묶음의 접기가 그대로다 — 0건이어도 단추를 그린다", () => {
    assert.match(
      flat(portalBlock),
      /\{showPortalFinished \? "끝난 위임 접기" : `끝난 위임 보기 \(\$\{portalDelegations\.finished\.length\}건/,
      "통합 승인함 묶음의 접기 글자가 달라졌다"
    );
    assert.ok(
      !portalBlock.includes("portalDelegations.finished.length > 0"),
      "통합 승인함 묶음에도 0건 울타리를 둘렀다 — 이 조각이 건드리지 않기로 한 자리다"
    );
    assert.ok(portalBlock.includes("끝나거나 거둔 위임이 없습니다."));
  });

  test("🔴 네 접기가 **같은 글자**를 쓴다 — 같은 화면에서 생김새가 갈리면 결함으로 읽힌다", () => {
    assert.equal(
      [...sectionCode.matchAll(/끝난 위임 접기/g)].length,
      4,
      "접는 글자를 쓰는 묶음이 넷이 아니다"
    );
    assert.equal(
      [...sectionCode.matchAll(/끝난 위임 보기 \(/g)].length,
      4,
      "펴는 글자를 쓰는 묶음이 넷이 아니다"
    );
  });

  test("🔴 「모두의」 묶음은 여전히 자료(null)로 여닫힌다 — 권한 자리를 안 건드렸다", () => {
    assert.match(flat(sectionCode), /\{allRouteDelegations && \( <>/, "묶음을 여는 열쇠가 달라졌다");
    assert.match(
      flat(sectionCode),
      /allRouteDelegations: AllApprovalRouteDelegationsView \| null;/,
      "모두의 목록 prop 이 달라졌다"
    );
  });
});
