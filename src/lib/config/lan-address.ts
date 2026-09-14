/**
 * 이 기계의 사내망 IPv4 주소를 실행 시점에 찾는다.
 *
 * 왜 있는가: next.config.ts의 allowedDevOrigins 주석이 그대로 증언한다 —
 * "이 목록이 오늘 하루에만 세 번 늘어난 데서 보이듯, 접속 네트워크가 바뀔
 * 때마다 여기를 고쳐야 한다." SSO_ISSUER·SSO_REDIRECT_URI도 같은 처지였고,
 * 하나라도 빠뜨리면 증상은 "로그인이 안 된다" 하나로 뭉뚱그려진다.
 * 주소를 적지 않고 여기서 찾으면 고칠 곳이 사라진다.
 *
 * ⚠️ 이 파일은 dss-auth/src/lib/config/lan-address.ts와 **같은 판정**을
 * 담고 있다. 두 저장소가 서로를 참조하지 않으므로(공유 패키지가 없다)
 * 의도적으로 복제해 두었다. 한쪽의 판정 규칙을 고치면 다른 쪽도 고쳐야
 * 한다 — 둘이 다른 주소를 고르면 redirect_uri가 어긋나 로그인이 막힌다.
 *
 * server-only를 붙이지 않는다. next.config.ts가 이 파일을 읽는다.
 *
 * 이 저장소에는 이 판정의 테스트가 없다. 규칙은 dss-auth의
 * src/lib/config/lan-address.test.ts가 지킨다 — 판정을 고칠 때는 그쪽
 * 테스트부터 세우고, 통과한 판정을 여기에 그대로 옮긴다.
 */
import { networkInterfaces } from "node:os";

export type InterfaceSnapshot = Record<
  string,
  ReadonlyArray<{ address: string; family: string | number; internal: boolean }> | undefined
>;

/** 가상 어댑터. WSL이 172.23.224.1처럼 사설 대역을 들고 있어 주소만으로는 구별되지 않는다. */
const VIRTUAL_ADAPTER = /(vethernet|hyper-?v|wsl|virtualbox|vmware|docker|bluetooth|블루투스|loopback)/i;

/**
 * Windows 모바일 핫스팟. 기본 대역이 192.168.137.0/24(PC가 .1)이고, 어댑터
 * 이름은 "로컬 영역 연결* 12"·"Local Area Connection* 12"처럼 별표 뒤에 번호가
 * 붙는다(별표 없는 "Local Area Connection 2"는 옛 Windows의 진짜 랜카드다).
 * 2026-09-13 포털 issuer가 이 주소로 떠서 폰·동료 PC의 로그인이 막혔다 —
 * 둘 다 192.168이라 사전순에서 "137"이 실제 Wi-Fi의 "35"보다 앞섰다.
 * 버리지 않고 뒤로만 민다. 핫스팟에 폰을 붙여 쓸 때가 있다.
 */
const HOTSPOT_SUBNET = "192.168.137.";
const HOTSPOT_ADAPTER = /(연결|connection)\*\s*\d+$/i;

/**
 * 어댑터 층. 0 진짜 어댑터 → 1 핫스팟 → 2 가상 어댑터. 대역 순위보다 먼저
 * 본다 — 아이폰 핫스팟에 붙은 Wi-Fi(172.20.10.x)가 이 PC의 핫스팟에 밀리면
 * 안 된다. 핫스팟은 폰이 실제로 붙는 망이라, 이 PC 밖에서 아무도 닿지 않는
 * 가상 어댑터와 한 층에 두지 않고 그 앞에 둔다.
 */
function adapterTier(name: string, address: string): number {
  if (VIRTUAL_ADAPTER.test(name)) return 2;
  if (address.startsWith(HOTSPOT_SUBNET) || HOTSPOT_ADAPTER.test(name)) return 1;
  return 0;
}

/** 사설 대역 선호 순위. 같은 층 안에서만 본다. 이름 규칙이 빗나가도 한 번 더 걸러 준다. */
function subnetRank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

export function collectLanAddresses(snapshot: InterfaceSnapshot): string[] {
  const found: { address: string; tier: number }[] = [];

  for (const [name, entries] of Object.entries(snapshot)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      if (entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue; // 주소를 못 받았다는 뜻
      found.push({ address: entry.address, tier: adapterTier(name, entry.address) });
    }
  }

  return found
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const rank = subnetRank(a.address) - subnetRank(b.address);
      if (rank !== 0) return rank;
      return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
    })
    .map((entry) => entry.address);
}

/** 5초 캐시. 매 요청 시스템 호출은 아깝고, 프로세스 내내 붙들면 Wi-Fi를 옮길 때 재시작해야 한다. */
const DETECT_CACHE_MS = 5000;
let cache: { at: number; addresses: string[] } | null = null;

export function detectLanAddresses(now: number = Date.now()): string[] {
  if (cache && now - cache.at < DETECT_CACHE_MS) return cache.addresses;
  const addresses = collectLanAddresses(networkInterfaces() as InterfaceSnapshot);
  cache = { at: now, addresses };
  return addresses;
}

/**
 * 대표 주소 하나. 못 찾으면 조용히 localhost로 물러서지 않고 멈춘다 —
 * 그 상태로 뜨면 폰에서 들어온 로그인이 "성공했는데 돌아오지 못하는"
 * 가장 설명하기 어려운 모양으로 깨진다.
 */
export function primaryLanAddress(): string {
  const [first] = detectLanAddresses();
  if (!first) {
    throw new Error(
      "사내망 IPv4 주소를 찾지 못했습니다. 랜/Wi-Fi 연결을 확인하거나, .env.local에 " +
        "auto 대신 주소를 직접 적으세요(예: SSO_ISSUER=http://192.168.0.13:3100)."
    );
  }
  return first;
}

/**
 * "auto" 또는 "auto:3100"이면 이 기계 주소로 만들고, 아니면 적힌 값을 그대로 쓴다.
 *
 * auto는 언제나 http다. HTTPS는 앞에 리버스 프록시가 서야 성립하는데, 그때
 * 밖에서 보이는 이름은 IP가 아니라 도메인이라 이 기계가 알아낼 수 없다.
 */
export function resolveAutoUrl(raw: string, fallbackPort: number, address: string): string {
  if (raw !== "auto" && !raw.startsWith("auto:")) return raw;
  const port = raw.startsWith("auto:") ? raw.slice("auto:".length) : String(fallbackPort);
  if (!/^\d+$/.test(port)) {
    throw new Error(`auto: 뒤에는 포트 번호만 올 수 있습니다(받은 값: ${raw}).`);
  }
  return `http://${address}:${port}`;
}

export function isAutoValue(raw: string): boolean {
  return raw === "auto" || raw.startsWith("auto:");
}
