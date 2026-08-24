"use client";

/**
 * ============================================================================
 * 여러 파일을 ZIP 하나로 묶는다 — 압축하지 않고 담기만 한다
 * ============================================================================
 * 브라우저는 파일을 잇달아 내려받는 것을 막는다. 링크를 여러 번 눌러도 첫
 * 개만 통과하고 나머지는 **조용히 버려진다**(폰에서는 허용 확인창조차 뜨지
 * 않는 경우가 많다). 그래서 여러 개는 하나로 묶어 한 번만 내려받는다.
 *
 * ── 압축 라이브러리를 쓰지 않는 이유 ─────────────────────────────────────
 * 담을 것이 사진이다. JPEG는 이미 압축된 형식이라 다시 압축해도 거의 줄지
 * 않는다 — 시간만 쓰고 결과는 그대로다. 압축하지 않는 ZIP(store)은 헤더를
 * 붙여 이어 붙이는 일이라 라이브러리가 필요 없고, 그만큼 NAS 컨테이너로
 * 옮길 때 지고 갈 짐이 줄어든다.
 *
 * 형식은 PKZIP 규격 그대로다. 파일마다 앞머리(local header)를 붙여 이어 놓고,
 * 맨 뒤에 목록(central directory)과 마무리(EOCD)를 붙인다. 압축기가 없으니
 * "압축 후 크기"와 "원래 크기"가 같다.
 *
 * ── 한글 파일명 ──────────────────────────────────────────────────────────
 * 이름을 UTF-8로 적고 플래그 11번 비트를 켠다. 이 비트가 없으면 압축 프로그램이
 * 옛 코드페이지로 읽어 한글이 깨진다.
 * ============================================================================
 */

export type ZipEntry = {
  /** ZIP 안에서의 이름. 같은 이름이 겹치지 않게 부르는 쪽이 맞춰 준다. */
  name: string;
  // Blob에 넣으려면 일반 ArrayBuffer 위의 뷰여야 한다. 타입을 이렇게 적어 두면
  // SharedArrayBuffer 위의 것이 섞여 들어오는 것을 컴파일 때 막는다.
  data: Uint8Array<ArrayBuffer>;
};

/** CRC-32 표. 한 번만 만들어 두고 계속 쓴다. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP은 1980년 기준의 DOS 시각 형식을 쓴다. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** UTF-8 이름을 쓴다고 알리는 플래그(11번 비트). 없으면 한글이 깨진다. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const VERSION = 20;

export function createStoredZip(entries: readonly ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(now);

  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const size = entry.data.length;

    // ── 파일 앞머리 ───────────────────────────────────────────────────
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, VERSION, true);
    header.setUint16(6, FLAG_UTF8, true);
    header.setUint16(8, METHOD_STORE, true);
    header.setUint16(10, stamp.time, true);
    header.setUint16(12, stamp.date, true);
    header.setUint32(14, checksum, true);
    header.setUint32(18, size, true); // 압축 후 크기 — 담기만 했으니 원래와 같다
    header.setUint32(22, size, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // extra 없음

    parts.push(new Uint8Array(header.buffer), nameBytes, entry.data);

    // ── 뒤에 붙일 목록 항목 ───────────────────────────────────────────
    const record = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, VERSION, true);
    view.setUint16(8, FLAG_UTF8, true);
    view.setUint16(10, METHOD_STORE, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, checksum, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true); // extra
    view.setUint16(32, 0, true); // 주석
    view.setUint16(34, 0, true); // 시작 디스크
    view.setUint16(36, 0, true); // 내부 속성
    view.setUint32(38, 0, true); // 외부 속성
    view.setUint32(42, offset, true); // 이 파일 앞머리가 있는 자리
    record.set(nameBytes, 46);
    central.push(record);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = central.reduce((sum, record) => sum + record.length, 0);

  // ── 마무리 ──────────────────────────────────────────────────────────
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true); // 이 디스크 번호
  end.setUint16(6, 0, true); // 목록이 시작하는 디스크
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // 목록이 시작하는 자리
  end.setUint16(20, 0, true); // 주석 길이

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: "application/zip",
  });
}

/**
 * 같은 이름이 겹치지 않게 뒤에 번호를 붙인다.
 *
 * 한 접수 건에 같은 이름의 사진이 두 장 있으면(폰이 붙이는 이름은 잘 겹친다)
 * ZIP 안에서 하나가 다른 하나를 덮어쓰거나 압축 프로그램이 경고를 낸다.
 */
export function uniqueEntryNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen === 0) return name;

    const lastDot = name.lastIndexOf(".");
    const base = lastDot > 0 ? name.slice(0, lastDot) : name;
    const extension = lastDot > 0 ? name.slice(lastDot) : "";
    return `${base} (${seen + 1})${extension}`;
  });
}
