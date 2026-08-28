/**
 * ============================================================================
 * O/H 부품 템플릿 초기 데이터 — `견적서 OH.xlsx` 의 숨은 열에서 옮겨 온 것
 * ============================================================================
 * 출처: `OH견적서` 시트 P~AD열 34~46행. `K11` 에 기종 코드를 넣으면 IFS 로
 * 그 기종 목록이 보이는 칸에 나타나던 값들이다.
 *
 * **이미 있는 코드는 건드리지 않는다.** 사람이 화면에서 고친 뒤 이 스크립트를
 * 다시 돌려도 그 수정이 덮이지 않는다 — 초기 적재용이지 동기화 도구가 아니다.
 *
 * 실행:  npx node --conditions=react-server --import tsx scripts/seed-oh-part-templates.ts
 * ============================================================================
 */
import "./load-env";

import { and, eq } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import { ohPartTemplateItems, ohPartTemplates, parts, users } from "../src/lib/db/schema";

type SeedTemplate = {
  code: string;
  name: string;
  items: { name: string; quantity: number }[];
};

const TEMPLATES: SeedTemplate[] = [
  {
    code: "15",
    name: "기종 15",
    items: [
      { name: "스위칭 전원 48V", quantity: 1 },
      { name: "RF 컨트롤 판넬", quantity: 1 },
      { name: "중/종단 AMP 입력 보호 휴즈", quantity: 22 },
      { name: "스위칭 전원 24V", quantity: 1 },
      { name: "S-CONT 휴즈", quantity: 2 },
      { name: "3상 입력 보호 휴즈", quantity: 3 },
      { name: "PLBK-5 기판", quantity: 1 },
      { name: "필름 콘덴서(스누버 콘덴서)", quantity: 2 },
      { name: "필름 콘덴서(FH-SEQ 기판용) ASSAY", quantity: 2 },
      { name: "S-CONT 필름 콘덴서", quantity: 1 },
      { name: "냉각 팬 ASSAY", quantity: 1 },
      { name: "CAP-3 기판", quantity: 1 },
      { name: "유량계", quantity: 1 },
    ],
  },
  {
    code: "20",
    name: "기종 20",
    items: [
      { name: "스위칭 전원 48V", quantity: 1 },
      { name: "RF 컨트롤 판넬", quantity: 1 },
      { name: "중/종단 AMP 입력 보호 휴즈", quantity: 30 },
      { name: "스위칭 전원 24V", quantity: 1 },
      { name: "S-CONT 휴즈", quantity: 2 },
      { name: "3상 입력 보호 휴즈", quantity: 3 },
      { name: "PLBK-6 기판", quantity: 1 },
      { name: "필름 콘덴서(스누버 콘덴서)", quantity: 4 },
      { name: "필름 콘덴서(FH-SEQ 기판용) ASSAY", quantity: 2 },
      { name: "S-CONT 필름 콘덴서", quantity: 1 },
      { name: "냉각 팬 ASSAY 20/30kW", quantity: 2 },
      { name: "CAP-3 25k- 기판", quantity: 1 },
    ],
  },
  {
    code: "301",
    name: "기종 301",
    items: [
      { name: "스위칭 전원(48V)", quantity: 1 },
      { name: "RF 컨트롤러", quantity: 1 },
      { name: "중,종단 AMP 입력 보호 휴즈", quantity: 42 },
      { name: "스위칭 전원(24V)", quantity: 1 },
      { name: "S-CONT 입력 보호 휴즈", quantity: 2 },
      { name: "3상 입력 보호 휴즈", quantity: 3 },
      { name: "PLBK-7 기판", quantity: 1 },
      { name: "DMP-CR2 기판", quantity: 1 },
      { name: "필름 콘덴서(스누버 콘덴서)", quantity: 6 },
      { name: "필름 콘덴서(FH-SEQ 기판용) ASSAY", quantity: 2 },
      { name: "S-CONT 필름 콘덴서", quantity: 1 },
      { name: "냉각 팬 ASSAY 20/30kW", quantity: 4 },
    ],
  },
  /**
   * ⚠️ 양식의 기종 목록에는 `302` 도 있지만 **부품 목록이 없다** — IFS 수식이
   * 15/20/301 만 처리해서, 302 를 고르면 빈칸이 나온다. 없는 자료를 지어내지
   * 않는다. 빈 템플릿으로 만들어 두어 화면에서 채울 수 있게만 한다.
   */
  { code: "302", name: "기종 302 (부품 미등록)", items: [] },
];

/** 이름이 똑같은 재고 부품이 있으면 이어 준다. 없으면 이름만 남긴다(스키마 주석). */
async function findPartIdByName(name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: parts.id })
    .from(parts)
    .where(and(eq(parts.partName, name), eq(parts.isDeleted, false)))
    .limit(1);
  return row?.id ?? null;
}

async function main() {
  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!actor) throw new Error("계정이 하나도 없습니다.");

  for (const template of TEMPLATES) {
    const [existing] = await db
      .select({ id: ohPartTemplates.id })
      .from(ohPartTemplates)
      .where(eq(ohPartTemplates.code, template.code))
      .limit(1);
    if (existing) {
      console.log(`건너뜀  ${template.code} — 이미 있습니다(사람이 고친 값을 덮지 않습니다).`);
      continue;
    }

    const [created] = await db
      .insert(ohPartTemplates)
      .values({
        code: template.code,
        name: template.name,
        note: "견적서 OH.xlsx 의 숨은 열에서 옮겨 온 초기값",
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: ohPartTemplates.id });

    let linked = 0;
    if (template.items.length > 0) {
      const rows = [];
      for (const [index, item] of template.items.entries()) {
        const partId = await findPartIdByName(item.name);
        if (partId) linked += 1;
        rows.push({
          templateId: created.id,
          displayOrder: index + 1,
          partId,
          partNameText: item.name,
          quantity: item.quantity,
        });
      }
      await db.insert(ohPartTemplateItems).values(rows);
    }
    console.log(
      `추가함  ${template.code} (${template.name}) — 부품 ${template.items.length}종, 재고 연결 ${linked}종`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end({ timeout: 5 }));
