import "./load-env";

import { eq, sql } from "drizzle-orm";

import {
  PART_FIELD_LABELS,
  PART_FIELD_ORDER,
  partFieldEntries,
  type PartFieldKey,
} from "@dss/core/ui/inventory/part-picker-rows";

import { db, pgClient } from "../src/lib/db/connection";
import { repairCaseUsedParts, repairCases, statusChangeHistories } from "../src/lib/db/schema";
import { inventoryUnreachableMessage, toPartPickerRows } from "../src/lib/domain/inventory-gateway";
import { fetchInventoryParts } from "../src/lib/server/inventory-gateway";
import { KYOSAN_REPORT_SOURCE, readKyosanTraceMetadata } from "./lib/kyosan-import-revert-plan";
import {
  cannotMeasureLine,
  formatOverlapTable,
  formatUnmatchedSamples,
  tallyNames,
  type NameBucket,
  type TableBlock,
} from "./lib/part-name-overlap";

/**
 * ============================================================================
 * 사용 부품 이름과 재고 관리 부품명이 **얼마나 겹치는가** (조각 C0, 2026-10-28)
 * ============================================================================
 *
 *   npm run check:part-name-overlap
 *
 * ── 🔴 왜 이것부터인가 ──────────────────────────────────────────────────
 * 다음 조각은 「고장 부품」 그래프에 **연락서에서 읽은 부품**과 **재고 관리에 요청한
 * 부품**을 한 줄로 묶어 보이게 하는 일이다. 그런데 그 둘을 이을 열쇠가 지금은
 * **이름 글자뿐**이다 — `repair_case_used_parts.part_id` 는 연락서 이식이 언제나
 * `null` 로 넣고(`server/services/kyosan-report-import.ts` 의 `replaceUsedParts`),
 * 재고 관리가 바깥에 내주는 열쇠에는 A/S 의 UUID 가 아예 없다(저쪽 API.md 2절).
 *
 * 🔴 **그 겹침이 몇 할인지 아는 길이 코드에 하나도 없었다.** 단위 시험으로는 영영
 *    안 잡힌다 — 두 시스템의 **실제 자료**를 맞대어 봐야만 나오는 수이기 때문이다.
 *    수치가 낮으면 묶는 방식 자체를 다시 정해야 한다(다른 열쇠를 쓰거나 맞춤표를 두거나).
 *
 * ── 🔴 읽기만 한다. **쓰는 모드가 없다** ────────────────────────────────
 * `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고, 재고 관리에는 **읽기 통로 하나**(
 * `GET /api/v1/parts`)만 두드린다. 이웃 도구들이 가진 `--apply` 같은 깃발을 **일부러
 * 두지 않았다** — 재는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을 넓힌다.
 *
 * ── 🔴 파일로 남기지 않는다 ─────────────────────────────────────────────
 * 부품 이름은 화면에만 찍는다. `--out` 같은 깃발이 없는 것도 일부러다 — 실제 부품명이
 * 저장소에 커밋되는 파일로 흘러 들어갈 길을 아예 만들지 않는다.
 *
 * ── 🔴 개발 DB 로는 아무것도 못 잰다 ────────────────────────────────────
 * 개발 DB 에는 과거 건이 거의 없다(연락서 469장이 개발에서는 3장이었다). **운영에서**
 * 돌려야 뜻이 있는 수가 나온다. NAS 에서는 도구 컨테이너가 그 자리를 맡는다:
 *
 *   docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm tools-as npm run check:part-name-overlap
 *
 * 🔴 `tools-as` 는 앱과 **같은 `env/as.env`** 를 읽으므로, 앱이 재고 관리를 부를 수
 *    있으면 이 도구도 부를 수 있다(`INVENTORY_API_BASE_URL` · `INVENTORY_API_TOKEN`).
 *    둘 중 하나라도 없으면 아래 「못 물어봤다」로 **분명히** 찍히고 종료 코드가 1 이다.
 *
 * ── 🔴 이 수는 **낮게 나오는 쪽으로** 틀린다 (저쪽 통로가 거르는 것) ────
 * `GET /api/v1/parts` 는 **숨긴(삭제) 부품을 빼고** 준다(저쪽 `src/app/api/v1/parts/route.ts`
 * 의 `eq(parts.isDeleted, false)`, 그리고 항목 표와 `innerJoin` 이라 항목이 없는 부품도
 * 빠진다). 사용 부품 칸에 적힌 이름이 **그 사이에 지워진 부품**을 가리키면 여기서는 「안
 * 겹침」으로 센다. 🔵 그래서 **겹침이 높게 나오면 그 수는 믿어도 된다** — 틀린다면 낮게
 * 틀린다. 반대로 낮게 나왔을 때는 이것부터 의심하라(지워진 부품이 얼마나 되는지는 재고
 * 관리 쪽에서 봐야 한다 — 이 도구는 그 수를 모른다).
 *
 * ── 🔴 「겹침 0」과 「못 물어봤다」를 가른다 ─────────────────────────────
 * 재고 관리가 멈춰 있거나 토큰이 없을 때 0% 로 찍으면 사람이 **「이름으로는 못 묶는다」**로
 * 읽고 설계를 뒤집는다. 그래서 `fetchInventoryParts` 가 돌려주는 「모른다」를 접지 않고
 * 그대로 들어, **표를 아예 그리지 않고** 못 물어봤다고 말한 뒤 1 로 끝낸다. 이 갈림은
 * 재고 통로 전체의 규약이다(`src/lib/domain/inventory-gateway.ts` 머리말).
 * ============================================================================
 */

/** 본보기를 몇 개까지 찍나. 🔵 늘리려면 이 수를 고친다 — 깃발을 두지 않았다(머리말). */
const SAMPLE_LIMIT = 20;

/** 🔴 못 잰 것. ✓ 도 ✗ 도 아니다 — 끝에서 종료 코드를 1 로 만든다. */
let unmeasured = 0;

function cannotMeasure(label: string, why: string) {
  unmeasured += 1;
  console.log(cannotMeasureLine(label, why));
}

/** 표 한 덩이를 찍고, 못 잰 것을 **함께** 센다. 🔴 세는 길이 둘이 되면 한쪽만 고쳐진다. */
function emit(block: TableBlock) {
  for (const line of block.lines) console.log(line);
  unmeasured += block.unmeasured;
}

// ---------------------------------------------------------------------------
// A/S 쪽 — `repair_case_used_parts.part_name_text`
// ---------------------------------------------------------------------------

type UsedPartRow = { id: string; text: string; caseDeleted: boolean | null };

/**
 * 사용 부품 줄을 **전부** 읽는다. 🔴 `SELECT` 하나뿐이다.
 *
 * 🔵 `repair_cases` 를 왼쪽으로 붙이는 까닭은 **휴지통 건의 줄이 몇 개인지만** 알려고다.
 *    빼지는 않는다 — 그래프가 휴지통을 어떻게 다룰지는 아직 정해진 바가 없고, 여기서
 *    미리 빼면 사람이 **빠진 줄 수를 모른 채** 비율을 읽는다.
 */
async function readUsedPartRows(): Promise<UsedPartRow[]> {
  return db
    .select({
      id: repairCaseUsedParts.id,
      text: repairCaseUsedParts.partNameText,
      caseDeleted: repairCases.isDeleted,
    })
    .from(repairCaseUsedParts)
    .leftJoin(repairCases, eq(repairCases.id, repairCaseUsedParts.repairCaseId));
}

type KyosanOrigin = {
  /** 연락서 이식이 넣은 줄의 id. 🔵 지금은 지워진 id 도 섞여 있다 — 교집합으로만 쓴다. */
  ids: Set<string>;
  /** 🔴 `usedPartIds` 가 **없는** 옛 흔적 가운데 부품을 넣은 것의 수(아래 머리말). */
  tracesWithoutIds: number;
  /** 그 옛 흔적들이 말하는 사용 부품 줄 수의 합. */
  rowsWithoutIds: number;
};

/**
 * 어느 줄이 **연락서에서 왔는지** 가른다.
 *
 * 🔴 `repair_case_used_parts` 에는 그것을 알려 주는 칸이 **없다**(그 표의 머리말과
 * `replaceUsedParts` 의 주석). `part_id IS NULL` 로도 못 가른다 — 사람이 손으로 적는
 * 줄도 비어 있다. 단서는 이식 흔적(`status_change_histories.metadata`)의 `usedPartIds`
 * 하나뿐이고, 되돌리기 도구가 쓰는 바로 그 단서다.
 *
 * 🔴 **옛 흔적에는 그 칸이 없다**(조각 S5-A 전). 그때 넣은 줄은 **가를 길이 없다** —
 *    없는 것을 지어내지 않고, 그런 흔적이 몇 건인지 **따로 세어 찍는다.** 그 수가 0 이
 *    아니면 아래의 「그 밖」 묶음에는 연락서에서 온 줄이 섞여 있다는 뜻이고, 그 사실을
 *    모른 채 「손으로 적은 이름은 이렇다」고 읽으면 결론이 틀어진다.
 */
async function readKyosanOrigin(): Promise<KyosanOrigin> {
  const traces = await db
    .select({ metadata: statusChangeHistories.metadata })
    .from(statusChangeHistories)
    .where(sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_REPORT_SOURCE}`);

  const ids = new Set<string>();
  let tracesWithoutIds = 0;
  let rowsWithoutIds = 0;
  for (const trace of traces) {
    const metadata = readKyosanTraceMetadata(trace.metadata);
    if (!metadata.isKyosanReportTrace) continue;
    if (metadata.usedPartIds === null) {
      const count = metadata.usedPartCount ?? 0;
      // 🔵 부품을 한 줄도 안 넣은 흔적은 가를 것이 없다 — 「못 가른다」로 세지 않는다.
      if (count > 0) {
        tracesWithoutIds += 1;
        rowsWithoutIds += count;
      }
      continue;
    }
    for (const id of metadata.usedPartIds) ids.add(id);
  }
  return { ids, tracesWithoutIds, rowsWithoutIds };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n" + "─".repeat(72));
  console.log("  사용 부품 이름 ↔ 재고 관리 부품명 — 얼마나 겹치나 (읽기만 한다)");
  console.log("─".repeat(72));

  // ── A/S 쪽 ──────────────────────────────────────────────────────────
  const rows = await readUsedPartRows();
  const origin = await readKyosanOrigin();

  const fromKyosan = rows.filter((row) => origin.ids.has(row.id));
  const rest = rows.filter((row) => !origin.ids.has(row.id));
  const deletedRows = rows.filter((row) => row.caseDeleted === true).length;

  const allNames = tallyNames(rows.map((row) => row.text));
  const kyosanNames = tallyNames(fromKyosan.map((row) => row.text));
  const restNames = tallyNames(rest.map((row) => row.text));

  console.log("\n─ A/S 쪽 — repair_case_used_parts");
  console.log(`  줄 ${rows.length}개 · 서로 다른 이름 ${allNames.length}가지`);
  console.log(`  그중 휴지통 건의 줄 ${deletedRows}개 (빼지 않았다 — 그래프의 범위는 아직 정해지지 않았다)`);
  console.log(
    `  연락서 이식이 넣은 줄 ${fromKyosan.length}개(이름 ${kyosanNames.length}가지) · ` +
      `그 밖 ${rest.length}개(이름 ${restNames.length}가지)`
  );
  if (origin.tracesWithoutIds > 0) {
    console.log(
      `  🔴 가를 수 없는 이식 흔적 ${origin.tracesWithoutIds}건(그 흔적이 말하는 줄 ${origin.rowsWithoutIds}개) — ` +
        "옛 흔적이라 `usedPartIds` 가 없다. 그만큼이 위 「그 밖」에 섞여 있다."
    );
  } else {
    console.log("  🔵 이식 흔적은 모두 `usedPartIds` 를 들고 있다 — 가름이 온전하다.");
  }
  if (rows.length === 0) {
    cannotMeasure("🔴 맞대기 전부", "사용 부품 줄이 한 개도 없다 — 개발 DB 로 돌리지 않았는지 보십시오");
  }

  // ── 재고 관리 쪽 ────────────────────────────────────────────────────
  console.log("\n─ 재고 관리 쪽 — GET /api/v1/parts");
  const parts = await fetchInventoryParts();
  if (parts.status !== "ok") {
    /* 🔴 여기서 표를 그리면 안 된다 — 「0개 겹침」으로 읽힌다(머리말). */
    cannotMeasure(
      "🔴 맞대기 전부",
      `재고 관리에 **못 물어봤다**(${parts.reason}) — ${inventoryUnreachableMessage(parts.reason)}`
    );
    console.log("     🔴 이것은 「겹치는 것이 없다」가 아니다. 겹침은 **재지 못했다.**");
    return;
  }
  console.log(`  부품 ${parts.value.length}줄을 받아 왔다`);
  if (parts.value.length === 0) {
    cannotMeasure("🔴 맞대기 전부", "통로는 답했는데 부품이 한 줄도 없다");
    return;
  }

  /* 🔴 칸의 차례와 이름표는 **공용 묶음이 쥔다**(`PART_FIELD_ORDER`·`PART_FIELD_LABELS`).
     여기서 다시 적으면 어디서는 「품명2」이고 어디서는 「규격」이 된다. 값을 꺼내는 자도
     그 묶음의 `partFieldEntries` 다 — `-` 만 적힌 칸을 「없음」으로 보는 자가 한 벌이어야
     한다(저쪽 재고 관리도 같은 글자들을 빈 값으로 본다). */
  const pickerRows = toPartPickerRows(parts.value);
  const byField = new Map<PartFieldKey, string[]>(PART_FIELD_ORDER.map((key) => [key, []]));
  for (const row of pickerRows) {
    for (const entry of partFieldEntries(row)) byField.get(entry.key)?.push(entry.value);
  }

  const buckets: NameBucket[] = PART_FIELD_ORDER.map((key) => ({
    label: PART_FIELD_LABELS[key],
    values: byField.get(key) ?? [],
  }));
  /* 🔵 「아무 칸이나」 — 어느 칸이든 걸리면 묶을 수는 있다는 뜻이다. 🔴 그래도 칸별 수를
     함께 보여 주는 까닭: 어느 칸에서 걸렸는지가 그래프를 어떻게 묶을지를 정한다.
     🔴 이름표에 그림글자를 쓰지 않는다 — 자리 맞추개가 그림글자의 너비를 모른다
     (`part-name-overlap.ts` 의 `WIDE_RANGES` 머리말). 그 줄만 한 칸 밀린다. */
  const anyBucket: NameBucket = { label: "아무 칸이나(합)", values: buckets.flatMap((bucket) => bucket.values) };
  const withAny = [...buckets, anyBucket];

  // ── 맞대기 ──────────────────────────────────────────────────────────
  console.log("\n─ 맞대기 (분모는 **적힌 글자 기준 서로 다른 이름 수**)");
  emit(formatOverlapTable({ title: "전체", asNames: allNames, buckets: withAny }));
  emit(formatOverlapTable({ title: "연락서 이식이 넣은 줄", asNames: kyosanNames, buckets: withAny }));
  emit(
    formatOverlapTable({
      /* 🔴 가를 수 없는 옛 흔적이 있으면 **이 묶음의 이름부터** 그렇게 적는다 — 「손으로
         적은 줄」이라고 적어 두면 그 글자를 믿은 사람이 틀린 결론을 낸다. */
      title: origin.tracesWithoutIds > 0 ? "그 밖(옛 이식분이 섞여 있다)" : "그 밖(손으로 적은 줄)",
      asNames: restNames,
      buckets: withAny,
    })
  );

  // ── 본보기 ──────────────────────────────────────────────────────────
  for (const line of formatUnmatchedSamples({
    title: "어느 칸과도 안 겹친 것",
    asNames: allNames,
    bucket: anyBucket,
    limit: SAMPLE_LIMIT,
  })) {
    console.log(line);
  }
  /* 🔵 품명 칸만 따로 한 번 더 — 지시서가 말한 「재고 관리 부품명」이 그 칸이고, 거기만
     놓고 보면 두 체계가 얼마나 다른지가 가장 또렷하게 보인다. */
  const partNameBucket = buckets.find((bucket) => bucket.label === PART_FIELD_LABELS.partName);
  if (partNameBucket !== undefined) {
    for (const line of formatUnmatchedSamples({
      title: "품명 칸만 놓고 보면",
      asNames: allNames,
      bucket: partNameBucket,
      limit: SAMPLE_LIMIT,
    })) {
      console.log(line);
    }
  }
}

main()
  .then(async () => {
    console.log("\n" + "─".repeat(72));
    if (unmeasured > 0) {
      console.log(`  🔴 못 잰 것이 ${unmeasured}가지 있습니다 — 위의 ? 줄을 먼저 없애고 다시 돌리십시오.`);
      process.exitCode = 1;
    } else {
      console.log("  다 쟀습니다. 🔵 이 수는 **돌린 그 DB 의 사실**입니다 — 개발 DB 로는 아무것도 못 잽니다.");
    }
    console.log("─".repeat(72) + "\n");
    await pgClient.end({ timeout: 5 });
  })
  .catch(async (error) => {
    console.error("재지 못했습니다:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await pgClient.end({ timeout: 5 });
  });
