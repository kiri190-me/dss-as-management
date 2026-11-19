import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { users, repairCases, repairCaseFlowcharts } from "../schema";
import {
  listDeletedRepairCaseFlowchartsForManagement,
  listRepairCaseFlowchartsForManagement,
  listUsedRepairCaseFaultTags,
} from "./repair-case-flowcharts";

/**
 * 진단 Flowchart 의 **고장 개소 태그 목록 조회**(2026-11-19) —
 * listUsedRepairCaseFaultTags. 편집기 태그 칸의 드롭다운이 이것으로 선다.
 *
 * 🔴 **태그 전용 표를 만들지 않기로 했다**(같은 날 결정). 그래서 목록은 지금까지
 * 어느 Flowchart 에든 달린 값을 jsonb 배열째로 펼쳐 센 것이다 — 여기서 겨냥하는
 * 결함 셋은 전부 「오류 없이 조용한」 것들이다:
 *  ① **휴지통(is_deleted)의 태그가 섞인다** — 지운 Flowchart 의 개소를 계속
 *    권하면 지운 것이 목록에서 되살아난 것처럼 보인다.
 *  ② **차례가 뜻을 잃는다** — 많이 쓰인 것이 위에 서지 않으면 드롭다운은 그냥
 *    긴 글자 더미가 된다.
 *  ③ **같은 태그가 여러 줄로 선다** — 둘이 같은 글자인데 고른 쪽이 다른 것처럼
 *    읽힌다.
 *
 * 🔵 이 조회는 **접수 건을 가리지 않는다**(모든 Flowchart 를 본다). 그래서 다른
 * 시험이 남긴 태그가 같은 시험 DB 에 섞여 있다 — 표본은 이 파일만 쓰는 접두사로
 * 만들고, 차례를 재는 단언도 **내 접두사로 걸러낸 뒤**에 한다. 거르지 않고 재면
 * 남이 태그를 하나 넣는 날 까닭 없이 깨진다.
 *
 * 접수 건은 새로 만들지 않는다 — 이미 있는 건 하나에 Flowchart 만 직접 꽂았다
 * 가 지운다(인수번호는 달마다 99개뿐이라, 조회 하나를 재자고 번호를 쓰지 않는다).
 */

/** 이 파일만 쓰는 접두사 — 남의 태그와 섞이지 않게. */
const TAG_PREFIX = `FAULTTAG-TEST-${randomUUID().slice(0, 8)}-`;
const TAG_GA = `${TAG_PREFIX}가`;
const TAG_NA = `${TAG_PREFIX}나`;
const TAG_DA = `${TAG_PREFIX}다`;
const TAG_TRASH = `${TAG_PREFIX}휴지통`;

let actorId: string;
let repairCaseId: string;
const createdFlowchartIds: string[] = [];

/**
 * 아래 「관리 목록이 태그를 싣는가」 묶음이 집어 볼 줄들 — 조회가 저장소의 모든
 * Flowchart 를 돌려주므로 **id 로 내 줄을 집는다**(제목으로 집으면 남이 같은 제목을
 * 쓰는 날 엉뚱한 줄을 잰다).
 */
let activeWithTagsId: string;
let activeWithoutTagsId: string;
let trashedWithTagsId: string;

async function insertFlowchart(params: { title: string; faultTags: string[] | null; isDeleted?: boolean }) {
  const [row] = await db
    .insert(repairCaseFlowcharts)
    .values({
      repairCaseId,
      title: params.title,
      description: null,
      faultTags: params.faultTags,
      createdBy: actorId,
      updatedBy: actorId,
      isDeleted: params.isDeleted ?? false,
      deletedAt: params.isDeleted ? new Date() : null,
    })
    .returning({ id: repairCaseFlowcharts.id });
  createdFlowchartIds.push(row.id);
  return row.id;
}

before(async () => {
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false), eq(users.isActive, true)))
    .limit(1);
  assert.ok(actor, "expected an approved SUPER_ADMIN in the test DB");
  actorId = actor.id;

  const [repairCase] = await db.select({ id: repairCases.id }).from(repairCases).where(eq(repairCases.isDeleted, false)).limit(1);
  assert.ok(repairCase, "expected at least one non-deleted repair case in the test DB");
  repairCaseId = repairCase.id;

  // 🔵 세는 모양: 다 ×3 · 가 ×2 · 나 ×2. 가나다순으로는 가 < 나 < 다 이므로,
  // **다가 맨 앞에 서는 것은 오직 많이 쓰였기 때문**이다 — 차례 규칙 둘(횟수
  // 먼저, 같으면 이름)을 한 목록으로 가를 수 있다.
  activeWithTagsId = await insertFlowchart({ title: "태그 조회 표본 1", faultTags: [TAG_DA, TAG_GA] });
  await insertFlowchart({ title: "태그 조회 표본 2", faultTags: [TAG_DA, TAG_NA] });
  await insertFlowchart({ title: "태그 조회 표본 3", faultTags: [TAG_DA, TAG_GA, TAG_NA] });
  // 🔴 휴지통 — 이 태그는 목록에 **절대** 나오면 안 된다.
  trashedWithTagsId = await insertFlowchart({ title: "태그 조회 표본 4(휴지통)", faultTags: [TAG_TRASH], isDeleted: true });
  // 칸이 생기기 전의 줄 — NULL 이다. 조회가 여기서 터지면 드롭다운이 통째로 죽는다.
  activeWithoutTagsId = await insertFlowchart({ title: "태그 조회 표본 5(태그 없음)", faultTags: null });
});

after(async () => {
  if (createdFlowchartIds.length > 0) {
    await db.delete(repairCaseFlowcharts).where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("listUsedRepairCaseFaultTags", () => {
  test("🔵 먼저 표본 확인 — 넣어 둔 태그 셋이 실제로 목록에 있다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    assert.ok(rows.length > 0, "목록이 통째로 비면 아래 검사가 전부 공짜로 통과한다");
    const mine = rows.filter((row) => row.tag.startsWith(TAG_PREFIX));
    assert.deepEqual(
      [...mine.map((row) => row.tag)].sort(),
      [TAG_GA, TAG_NA, TAG_DA].sort(),
      "넣은 태그가 목록에 안 나온다"
    );
  });

  test("🔴 휴지통의 태그는 안 섞인다 — 지운 Flowchart 의 개소를 계속 권하지 않는다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    assert.equal(
      rows.some((row) => row.tag === TAG_TRASH),
      false,
      "휴지통에 넣은 Flowchart 의 태그가 목록에 남아 있다"
    );
  });

  test("🔴 많이 쓰인 순이고, 같으면 가나다순이다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    const mine = rows.filter((row) => row.tag.startsWith(TAG_PREFIX));
    assert.deepEqual(mine, [
      { tag: TAG_DA, useCount: 3 },
      { tag: TAG_GA, useCount: 2 },
      { tag: TAG_NA, useCount: 2 },
    ]);
  });

  test("🔴 같은 태그는 **한 줄**로 합쳐진다 — 쓴 횟수는 그 줄의 수로 센다", async () => {
    const rows = await listUsedRepairCaseFaultTags();
    const da = rows.filter((row) => row.tag === TAG_DA);
    assert.equal(da.length, 1, "같은 태그가 여러 줄로 섰다");
    assert.equal(da[0].useCount, 3);
    // 횟수는 **글자가 아니라 수**다 — count(*) 는 bigint 라 ::int 를 빼면 문자열로 온다.
    assert.equal(typeof da[0].useCount, "number");
  });

  test("태그가 NULL 인 Flowchart 가 있어도 조회가 서지 않는다 — 칸이 생기기 전의 줄이다", async () => {
    // before() 에서 NULL 짜리를 하나 꽂아 두었다. 위 시험들이 도는 것 자체가
    // 그 증거지만, 「그 줄이 정말 NULL 인가」를 여기서 값으로 확인한다 —
    // 빈 배열로 들어갔다면 이 묶음은 NULL 을 한 번도 안 재고 있는 것이다.
    const rows = await db
      .select({ id: repairCaseFlowcharts.id, faultTags: repairCaseFlowcharts.faultTags })
      .from(repairCaseFlowcharts)
      .where(inArray(repairCaseFlowcharts.id, createdFlowchartIds));
    assert.ok(
      rows.some((row) => row.faultTags === null),
      "NULL 인 줄이 없다 — 이 시험이 아무것도 안 재고 있다"
    );
    const tags = await listUsedRepairCaseFaultTags();
    assert.ok(tags.length > 0);
  });
});

/**
 * [진단 Flowchart 관리] 화면이 **태그로 찾을 수 있으려면**(2026-11-19 사용자 요청)
 * 조회가 태그를 실어 와야 한다. 🔴 여기서 겨냥하는 결함은 **오류 없이 조용한**
 * 것들이다:
 *  ① 행 타입에만 더하고 `.select({...})` 에 안 더했다 — 타입 검사는 통과하고 화면도
 *    서지만 값이 `undefined` 라 태그로는 한 줄도 안 나오고 알약도 안 선다.
 *  ② **한쪽 조회만 고쳤다** — 「목록에선 찾아지는데 휴지통에선 안 되는」 반쪽이 된다.
 *    탭을 바꿔 가며 같은 글자를 쳐 보기 전에는 안 보인다.
 *  ③ NULL 을 []로 안 맞췄다 — 칸이 생기기 전에 만들어진 줄에서 화면이 터진다.
 *
 * 🔵 「많이 쓰인 태그 목록」(listUsedRepairCaseFaultTags)과는 **다른 일**이다. 그쪽은
 * 고를 거리를 권하는 자리라 휴지통을 빼지만, 이쪽은 **이미 달린 값을 보여 주고 찾는**
 * 자리라 휴지통도 실어야 한다(복원할 것을 찾는 자리다).
 */
describe("관리 목록·휴지통이 고장 개소 태그를 싣는다", () => {
  test("🔵 먼저 표본 확인 — 내가 넣은 줄 셋이 두 조회에 실제로 들어 있다", async () => {
    const [active, trashed] = await Promise.all([
      listRepairCaseFlowchartsForManagement(),
      listDeletedRepairCaseFlowchartsForManagement(),
    ]);
    assert.ok(
      active.some((row) => row.id === activeWithTagsId),
      "태그 단 줄이 사용중 목록에 없다 — 아래 검사가 전부 공짜로 통과한다"
    );
    assert.ok(
      active.some((row) => row.id === activeWithoutTagsId),
      "태그 없는 줄이 사용중 목록에 없다"
    );
    assert.ok(
      trashed.some((row) => row.id === trashedWithTagsId),
      "휴지통에 넣은 줄이 휴지통 목록에 없다"
    );
  });

  test("🔴 사용중 목록이 태그를 **저장된 차례 그대로** 싣는다", async () => {
    const rows = await listRepairCaseFlowchartsForManagement();
    const mine = rows.find((row) => row.id === activeWithTagsId);
    assert.ok(mine);
    // 차례까지 본다 — 알약이 이 차례로 서고, 편집기도 적은 차례를 지킨다
    // (faultTagsEqual). 집합으로 재면 차례가 뒤집혀도 통과한다.
    assert.deepEqual(mine.faultTags, [TAG_DA, TAG_GA]);
  });

  test("🔴 **휴지통 목록도** 태그를 싣는다 — 한쪽만 고치면 반쪽이 된다", async () => {
    const rows = await listDeletedRepairCaseFlowchartsForManagement();
    const mine = rows.find((row) => row.id === trashedWithTagsId);
    assert.ok(mine);
    assert.deepEqual(mine.faultTags, [TAG_TRASH]);
  });

  test("🔴 태그가 NULL 인 줄은 **빈 배열**로 온다 — 화면마다 `?? []` 를 적지 않아도 되게", async () => {
    const rows = await listRepairCaseFlowchartsForManagement();
    const mine = rows.find((row) => row.id === activeWithoutTagsId);
    assert.ok(mine);
    assert.deepEqual(mine.faultTags, []);
    // null 이 아니라 **배열**이어야 한다 — null 이면 화면의 `row.faultTags.some(...)`
    // 과 `tags.length` 가 그 줄에서 터진다.
    assert.ok(Array.isArray(mine.faultTags));
  });
});
