import { deflateRawSync } from "node:zlib";

/**
 * ============================================================================
 * 최소 ZIP 쓰기 — `zip-reader.ts` 의 반대편
 * ============================================================================
 * .xlsx 는 XML 들을 담은 평범한 ZIP 이다. 견적서 생성은 원본 양식을 풀어
 * 시트 XML 한 장만 고쳐 다시 묶는 일이라, 필요한 것은 **읽은 파트들을 같은
 * 순서로 다시 싸는 것**뿐이다. 범용 ZIP 라이브러리가 아니고, 그럴 이유도 없다 —
 * 이 저장소는 xlsx 패키지를 하나도 쓰지 않고(런타임 의존성 8개가 전부),
 * 리더도 같은 이유로 손으로 짜여 있다.
 *
 * ── 출력이 결정적이다 ───────────────────────────────────────────────────
 * 타임스탬프를 DOS 에포크(1980-01-01 00:00)로 고정한다. 현재 시각을 쓰면 같은
 * 입력으로 만든 두 파일이 달라져서, "이 견적서가 그 견적서와 같은가"를 바이트로
 * 답할 수 없게 된다. 테스트의 라운드트립 단언도 그 성질에 기대고 있다.
 *
 * ── Zip64 는 지원하지 않는다 ────────────────────────────────────────────
 * 4GB 를 넘는 파트나 65,535개를 넘는 엔트리가 나오면 **던진다.** 견적서 양식은
 * 86KB, 파트는 27개다. 조용히 잘못된 헤더를 쓰느니 멈추는 편이 낫다.
 * ============================================================================
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** DOS 에포크. 위 '출력이 결정적이다' 참조. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const UTF8_NAME_FLAG = 0x0800;
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;

export type ZipEntryInput = {
  name: string;
  data: Buffer;
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 엔트리를 **주어진 순서 그대로** 묶는다. 순서를 바꾸지 않는 것은 취향이 아니다 —
 * 호출부가 원본 zip 의 엔트리 순서를 넘기고, 그래야 원본과 나란히 놓고 비교할 수 있다.
 */
export function writeZip(entries: readonly ZipEntryInput[]): Buffer {
  if (entries.length > MAX_UINT16) {
    throw new Error(`ZIP 엔트리가 ${MAX_UINT16}개를 넘습니다 (Zip64 미지원): ${entries.length}개`);
  }

  const seen = new Set<string>();
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`ZIP 엔트리 이름이 중복됩니다: "${entry.name}"`);
    }
    seen.add(entry.name);

    const nameBytes = Buffer.from(entry.name, "utf8");
    if (nameBytes.length > MAX_UINT16) {
      throw new Error(`ZIP 엔트리 이름이 너무 깁니다: "${entry.name}"`);
    }
    const flags = isAscii(nameBytes) ? 0 : UTF8_NAME_FLAG;

    const uncompressed = entry.data;
    // 압축해서 되레 커지는 파트(이미 압축된 이미지 등)는 그냥 담는다.
    const deflated = deflateRawSync(uncompressed, { level: 6 });
    const useDeflate = deflated.length < uncompressed.length;
    const stored = useDeflate ? deflated : uncompressed;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORED;

    if (uncompressed.length > MAX_UINT32 || stored.length > MAX_UINT32) {
      throw new Error(`ZIP 파트가 4GB를 넘습니다 (Zip64 미지원): "${entry.name}"`);
    }
    if (offset > MAX_UINT32) {
      throw new Error("ZIP 전체가 4GB를 넘습니다 (Zip64 미지원)");
    }

    const crc = crc32(uncompressed);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localChunks.push(local, nameBytes, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBytes);

    offset += local.length + nameBytes.length + stored.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

function isAscii(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) return false;
  return true;
}
