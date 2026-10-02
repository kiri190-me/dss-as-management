import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { products } from "../schema";

/**
 * ============================================================================
 * S/N 으로 **등록된 장비**를 찾는다 — 명판을 글자로 읽는 일을 덜어 주려고
 * ============================================================================
 * 명판 사진에서 세 칸을 다 읽어 내려 했지만, 실측에서 잘 읽히는 것은 **S/N
 * 하나뿐**이다(다섯 장 중 넷). Model 은 2/5, L/N 은 1/5 다 — S/N 이 흰 바탕에
 * 검은 숫자 일곱 자리라 가장 또렷하기 때문이다.
 *
 * 그런데 이 시스템에는 장비가 **model·S/N·L/N 과 함께 이미 등록돼 있다**
 * (`products`). 그러니 세 칸을 다 읽으려 애쓸 것이 아니라, **제일 잘 읽히는
 * S/N 하나로 장비를 찾아 나머지를 가져오면 된다.** 실제로 글자 인식이 그렇게
 * 애써도 못 읽던 `WZ6243` 이 `S/N 1307009` 행에 그냥 들어 있다.
 *
 * ── 🔴 **한 대라고 가정하지 마라** ─────────────────────────────────────
 * S/N 이 겹치는 장비가 실제로 있다(개발 DB 에 2건). 그래서 **배열로** 돌려주고,
 * 부르는 쪽이 「여럿이면 사람에게 고르게 한다」를 하게 둔다. 하나로 가정하고
 * `limit(1)` 을 걸면 둘 중 아무거나 집어 **틀린 Model·L/N 이 조용히 들어간다.**
 *
 * SELECT 만 한다. 쓰지 않는다.
 * ============================================================================
 */

/** 찾은 장비 한 대. 접수폼이 채우는 칸과 이름을 맞춰 두었다. */
export type ProductBySerial = {
  id: string;
  modelName: string;
  serialNumber: string | null;
  lotNumber: string | null;
};

/**
 * S/N 으로 등록된 장비를 찾는다. 없으면 빈 배열.
 *
 * 🔴 **앞뒤 공백을 떼고 대소문자를 가리지 않는다.** 글자 인식이 준 값에는
 * 눈에 안 보이는 공백이 붙어 오고, 사람이 손으로 적은 S/N 에는 대소문자가
 * 섞인다. 양쪽을 같은 자로 눕혀 놓고 비교한다.
 *
 * 비어 있는 S/N(`null` 이거나 공백뿐)으로는 **절대 찾지 않는다** — 그러면
 * S/N 이 비어 있는 장비들이 통째로 걸려 나온다.
 */
export async function findProductsBySerialNumber(serial: string): Promise<ProductBySerial[]> {
  const wanted = serial.trim();
  if (wanted.length === 0) return [];

  return db
    .select({
      id: products.id,
      modelName: products.modelName,
      serialNumber: products.serialNumber,
      lotNumber: products.lotNumber,
    })
    .from(products)
    .where(
      and(
        eq(products.isDeleted, false),
        sql`lower(btrim(${products.serialNumber})) = lower(btrim(${wanted}))`
      )
    )
    .orderBy(products.modelName, products.id);
}
