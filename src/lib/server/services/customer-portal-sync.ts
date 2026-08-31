import "server-only";
import { listActiveLinks, listPortalItemsForCustomer } from "@/lib/db/queries/customer-portal";
import {
  insertPulledRequests,
  recordPortalSync,
} from "@/lib/db/mutations/customer-portal";
import { db } from "@/lib/db/client";
import { customerRepairLinks, customerRepairRequests } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";

/**
 * ============================================================================
 * 고객 안내 창구 — 밖과 주고받기
 * ============================================================================
 *
 * ■ 연결은 언제나 이쪽이 먼저 건다
 *
 * 공개 사이트(dss-home)는 인터넷에 있고 이 시스템은 사내 NAS에만 있다.
 * 의뢰를 가져오는 것도, 현황을 내보내는 것도 전부 이쪽에서 나가는 요청이다.
 * **방화벽에 들어오는 구멍을 뚫지 않는다** — 밖이 통째로 털려도 공격자는
 * 사내망 문 앞까지 오지 못한다.
 *
 * ■ 몇 번을 돌려도 안전하다
 *
 * 당겨오기는 넣거나-넘어가기(sourceId unique), 확인은 다시 해도 무해,
 * 스냅샷은 통째 교체다. 그래서 예정된 실행과 사람이 누른 「지금 내보내기」가
 * 겹쳐 돌아도 잠금이 필요 없다.
 * ============================================================================
 */

function config() {
  const baseUrl = process.env.DSS_HOME_URL;
  const secret = process.env.DSS_HOME_SYNC_SECRET;

  // 설정이 빠졌는데 조용히 아무 일도 안 하는 것이 가장 위험하다 — 고객 의뢰가
  // 며칠째 안 들어오는데 아무도 모르는 상태가 된다.
  if (!baseUrl || !secret) {
    throw new Error(
      "DSS_HOME_URL 또는 DSS_HOME_SYNC_SECRET이 설정되지 않았습니다. .env.local을 확인하세요(.env.example 참고)."
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

async function call(
  path: string,
  init: { method: string; body?: unknown }
): Promise<Response> {
  const { baseUrl, secret } = config();
  return fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    // 밖이 느리거나 죽었을 때 이 스크립트가 영원히 매달려 있지 않게 한다.
    signal: AbortSignal.timeout(30_000),
  });
}

/** 밖에서 온 의뢰 한 건의 모양. 공개 쪽 API가 내주는 그대로다. */
type IncomingRequest = Record<string, unknown> & {
  id: string;
  nasLinkId: string;
  submittedAt: string;
};

/**
 * 밖에서 온 값이 채울 수 있는 칸 — **딱 이만큼이다.**
 *
 * 표의 나머지 칸(status·convertedRepairCaseId·rejectedBy·customerId…)은 우리
 * 업무 상태이고 여기서 정한다. 목록을 두지 않고 JSON을 통째로 펼치면, 바깥이
 * `status: "CONVERTED"` 하나만 실어 보내도 접수된 적 없는 의뢰가 처리된
 * 것으로 사라진다.
 *
 * 칸 이름이 공개 쪽 폼과 같은 것은 의도한 것이다(「수리의뢰서.xlsx」를 양쪽이
 * 그대로 따른다). 그래서 여기 이름을 고치면 저쪽도 함께 고쳐야 한다.
 */
const CUSTOMER_FILLABLE_COLUMNS = [
  "formKind",
  "companyName",
  "contactName",
  "contactPhone",
  "contactEmail",
  "productModelName",
  "lotNumber",
  "serialNumber",
  "endUser",
  "returnAddress",
  "chamberInfo",
  "pc1GeneratorLotNumber",
  "pc1GeneratorModel",
  "pc1MatcherLotNumber",
  "pc1MatcherModel",
  "pc2GeneratorLotNumber",
  "pc2GeneratorModel",
  "pc2MatcherLotNumber",
  "pc2MatcherModel",
  "pc3GeneratorLotNumber",
  "pc3GeneratorModel",
  "pc3MatcherLotNumber",
  "pc3MatcherModel",
  "alarmName",
  "symptomDescription",
  "processSourcePower",
  "processBiasPower",
  "issuePower",
  "normalPosition",
  "issuePosition",
  "customerActions",
  "issueProcessScope",
  "issueIntermittency",
  "issueTiming",
  "issueProcessCondition",
  "chamberCounts",
  "customerInspectionDetail",
] as const;

/**
 * 새 의뢰를 가져와 넣는다.
 *
 * 받은 것을 **넣고 나서** "받았다"고 알린다. 순서를 바꾸면 알린 직후 넣기가
 * 실패했을 때 그 의뢰를 영영 못 받는다 — 밖에서는 이미 가져간 것으로 표시돼
 * 다시 내주지 않기 때문이다.
 */
export async function pullNewRequests(): Promise<{ pulled: number; inserted: number }> {
  const res = await call("/api/nas-sync/repair-requests?limit=200", { method: "GET" });
  if (!res.ok) {
    throw new Error(`의뢰를 가져오지 못했습니다 (HTTP ${res.status}).`);
  }

  const body = (await res.json()) as { requests?: IncomingRequest[] };
  const requests = body.requests ?? [];
  if (requests.length === 0) return { pulled: 0, inserted: 0 };

  // 링크로 고객사를 찾는다. **여기가 고객사를 정하는 유일한 자리다** —
  // 고객이 폼에 적은 회사명은 참고용으로 저장만 하고, 고객사 마스터로
  // 이어지는 데 쓰지 않는다.
  const links = await db
    .select({ id: customerRepairLinks.id, customerId: customerRepairLinks.customerId })
    .from(customerRepairLinks);
  const linkMap = new Map(links.map((l) => [l.id, l]));

  const rows: (typeof customerRepairRequests.$inferInsert)[] = [];

  for (const request of requests) {
    const link = linkMap.get(request.nasLinkId);
    // 모르는 링크에서 온 것은 넣지 않는다. 링크가 없다는 것은 우리가 발급한
    // 적이 없다는 뜻이고, 고객사를 정할 근거가 없다.
    if (!link) continue;

    // 밖에서 온 JSON을 통째로 펼치지 않고 **허용된 칸만 골라 담는다.**
    // 통째로 펼치면 바깥이 status 나 convertedRepairCaseId 같은 칸을 실어
    // 보내는 순간 우리 업무 상태가 밖에서 정해진다.
    const incoming: Record<string, string | null> = {};
    for (const column of CUSTOMER_FILLABLE_COLUMNS) {
      const value = request[column];
      incoming[column] = typeof value === "string" && value.trim() ? value : null;
    }

    rows.push({
      ...incoming,
      // 필수 칸은 폼이 이미 강제하지만, 밖에서 온 값이라 여기서도 확인한다.
      companyName: incoming.companyName ?? "",
      contactName: incoming.contactName ?? "",
      contactPhone: incoming.contactPhone ?? "",
      productModelName: incoming.productModelName ?? "",
      lotNumber: incoming.lotNumber ?? "",
      serialNumber: incoming.serialNumber ?? "",
      endUser: incoming.endUser ?? "",
      symptomDescription: incoming.symptomDescription ?? "",
      sourceId: request.id,
      customerLinkId: link.id,
      customerId: link.customerId,
      submittedAt: new Date(request.submittedAt),
    });
  }

  const insertedIds = await insertPulledRequests(rows);

  // 넣기가 끝난 뒤에 알린다. 이미 있던 것(중복)도 함께 알린다 — 우리 쪽에
  // 있다는 것은 다시 받을 이유가 없다는 뜻이다.
  const ackIds = requests.map((r) => r.id);
  const ackRes = await call("/api/nas-sync/repair-requests/ack", {
    method: "POST",
    body: { ids: ackIds },
  });
  if (!ackRes.ok) {
    // 알리기가 실패해도 넣은 것은 그대로 둔다. 다음 실행에서 같은 것을 다시
    // 받겠지만 sourceId unique 가 흡수한다.
    console.warn(`  ⚠ 받았다고 알리지 못했습니다 (HTTP ${ackRes.status}). 다음에 다시 시도합니다.`);
  }

  return { pulled: requests.length, inserted: insertedIds.length };
}

/**
 * 고객사별 현황을 통째로 내보낸다.
 *
 * 바뀐 것만 보내지 않는 이유는 **사라져야 하는 것** 때문이다 — 출하 완료된 건,
 * 삭제된 접수. 증분이면 "지워라"를 따로 보내야 하고 그 메시지가 한 번
 * 유실되면 고객 화면에 출하된 물건이 영영 남는다.
 */
export async function pushSnapshots(): Promise<
  { customerName: string; itemCount: number; ok: boolean }[]
> {
  const links = await listActiveLinks();
  const results = [];

  for (const link of links) {
    const items = await listPortalItemsForCustomer(link.customerId);

    const res = await call("/api/nas-sync/items", {
      method: "PUT",
      body: {
        nasLinkId: link.id,
        items: items.map((item) => ({
          sourceKind: item.sourceKind,
          sourceId: item.sourceId,
          intakeNumber: item.intakeNumber,
          modelName: item.modelName,
          lotNumber: item.lotNumber,
          serialNumber: item.serialNumber,
          receivedAt: item.receivedAt,
          statusLabel: item.statusLabel,
          statusNote: item.statusNote,
          quoteNumber: item.quoteNumber,
          quoteIssuedDate: item.quoteIssuedDate,
          // 금액과 사내 진단 내용은 여기 없다. 나가지 않는다는 약속을
          // 지키는 방법은 애초에 담지 않는 것이다.
        })),
      },
    });

    if (res.ok) {
      await recordPortalSync({ customerLinkId: link.id, itemCount: items.length });
    }

    results.push({
      customerName: link.customerName,
      itemCount: items.length,
      ok: res.ok,
    });
  }

  return results;
}

/** 한 고객사만 내보낸다. 화면의 「지금 내보내기」가 부른다. */
export async function pushSnapshotForLink(linkId: string): Promise<number> {
  const [link] = await db
    .select({ id: customerRepairLinks.id, customerId: customerRepairLinks.customerId })
    .from(customerRepairLinks)
    .where(and(eq(customerRepairLinks.id, linkId), isNull(customerRepairLinks.revokedAt)));

  if (!link) throw new Error("회수되었거나 없는 링크입니다.");

  const items = await listPortalItemsForCustomer(link.customerId);

  const res = await call("/api/nas-sync/items", {
    method: "PUT",
    body: {
      nasLinkId: link.id,
      items: items.map((item) => ({
        sourceKind: item.sourceKind,
        sourceId: item.sourceId,
        intakeNumber: item.intakeNumber,
        modelName: item.modelName,
        lotNumber: item.lotNumber,
        serialNumber: item.serialNumber,
        receivedAt: item.receivedAt,
        statusLabel: item.statusLabel,
        statusNote: item.statusNote,
        quoteNumber: item.quoteNumber,
        quoteIssuedDate: item.quoteIssuedDate,
      })),
    },
  });

  if (!res.ok) {
    throw new Error(`현황을 내보내지 못했습니다 (HTTP ${res.status}).`);
  }

  await recordPortalSync({ customerLinkId: link.id, itemCount: items.length });
  return items.length;
}

/**
 * 링크를 밖에 심는다. 발급·재발급 직후에 부른다.
 *
 * 평문 토큰을 밖으로 넘기는 유일한 자리다. 이쪽 DB 에 남는 것은 sha256 과
 * 키로 암호화한 사본뿐이고(customer_repair_links.token_cipher), 저쪽도
 * token_hash 만 남긴다 — 평문은 양쪽 어디에도 저장되지 않는다.
 */
export async function pushCustomerLink(params: {
  nasLinkId: string;
  token: string;
  customerDisplayName: string;
}): Promise<void> {
  const res = await call("/api/nas-sync/customer-links", {
    method: "POST",
    body: {
      nasLinkId: params.nasLinkId,
      action: "CREATE",
      token: params.token,
      customerDisplayName: params.customerDisplayName,
    },
  });
  if (!res.ok) {
    throw new Error(`링크를 밖에 심지 못했습니다 (HTTP ${res.status}).`);
  }
}

/** 밖의 링크를 회수한다. */
export async function pushLinkRevocation(nasLinkId: string): Promise<void> {
  const res = await call("/api/nas-sync/customer-links", {
    method: "POST",
    body: { nasLinkId, action: "REVOKE" },
  });
  if (!res.ok) {
    throw new Error(`링크를 회수하지 못했습니다 (HTTP ${res.status}).`);
  }
}
