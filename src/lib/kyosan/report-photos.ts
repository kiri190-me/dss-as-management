import { createHash } from "node:crypto";

import { resolveSheetDrawingPart, resolveSheetPart } from "../xlsx/workbook-parts";
import type { ZipArchive } from "../xlsx/zip-reader";

/**
 * ============================================================================
 * 연락서에 붙은 사진 — 🔴 같은 그림을 여러 번 세지 않는다 (2026-09-21, S1)
 * ============================================================================
 * 사진은 시트에 붙어 있고, 시트 ↔ 그림은 관계 파일(`_rels`)로 이어진다:
 *
 *   xl/worksheets/sheet6.xml
 *     → xl/worksheets/_rels/sheet6.xml.rels  (…/relationships/drawing)
 *     → xl/drawings/drawing5.xml             (<a:blip r:embed="rId3"/>)
 *     → xl/drawings/_rels/drawing5.xml.rels  (rId3 → ../media/image8.jpg)
 *     → xl/media/image8.jpg
 *
 * ── 🔴 왜 내용 해시로 묶는가 ──────────────────────────────────────────
 * 실측(파일 한 장): `Card` 시트에 30번, `交換部品詳細` 시트에 30번 — 합쳐 60번
 * 놓인 그림이 알고 보니 **1,161바이트짜리 같은 파일 하나**였다(양식이 쓰는 작은
 * 아이콘). 회사 도장도 보고서 시트 둘에 똑같이 들어간다. 놓인 자리를 세면 이
 * 연락서에 사진이 60장 있는 것처럼 보인다. 그래서 **내용(SHA-256)으로 묶고**,
 * 어디에 놓였는지는 곁들여 적는다.
 *
 * 파트 이름으로 묶지 않는 까닭: 같은 그림이 파일마다 다른 번호를 받고, 드물게
 * 같은 그림이 두 파트로 복사되어 들어간다. 이름은 증거가 못 된다.
 *
 * ── 매크로는 건드리지 않는다 ──────────────────────────────────────────
 * `.xlsm` 은 확장자만 다른 zip 이다. 여기서는 zip 항목을 풀어 읽을 뿐이고
 * `xl/vbaProject.bin` 은 손도 대지 않는다.
 * ============================================================================
 */

export type KyosanPhoto = {
  /** 🔴 그림 내용의 SHA-256. 같은 그림인지 판단하는 유일한 근거다. */
  sha256: string;
  bytes: number;
  /** 이 내용을 담고 있던 zip 파트들(보통 하나). */
  parts: readonly string[];
  /** 이 그림이 놓인 시트들, 통합문서 차례대로·중복 없이. */
  sheets: readonly string[];
  /** 몇 자리에 놓였는가. 같은 시트에 두 번이면 둘로 센다. */
  placements: number;
};

export type PhotoScan = {
  photos: readonly KyosanPhoto[];
  /** 읽다가 만난 문제들. 고객 내용은 담지 않는다(파트 이름과 사유만). */
  problems: readonly string[];
};

type PhotoDraft = {
  sha256: string;
  bytes: number;
  parts: Set<string>;
  sheets: string[];
  placements: number;
};

/** 통합문서의 모든 시트를 훑어 그림을 모으고 내용 해시로 묶는다. */
export function collectPhotos(archive: ZipArchive, sheetNames: readonly string[]): PhotoScan {
  const byHash = new Map<string, PhotoDraft>();
  const problems: string[] = [];

  for (const sheetName of sheetNames) {
    let drawingPart: string | null;
    try {
      drawingPart = resolveSheetDrawingPart(archive, resolveSheetPart(archive, sheetName));
    } catch {
      // 시트 파트를 못 찾는 통합문서가 실제로 있다(관계가 깨진 채 저장된 것).
      // 사진 하나 때문에 판독 전체를 멈추지 않는다 — 문제로 적고 넘어간다.
      problems.push("시트 파트를 찾지 못해 그림을 건너뛰었다");
      continue;
    }
    if (!drawingPart) continue;

    const relations = readRelationships(archive, relsPartOf(drawingPart));
    let drawingXml: string;
    try {
      drawingXml = archive.readText(drawingPart);
    } catch {
      problems.push(`그림 파트를 읽지 못했다: ${drawingPart}`);
      continue;
    }

    for (const blip of drawingXml.matchAll(/<a:blip\b[^>]*?r:embed="([^"]+)"/g)) {
      const target = relations.get(blip[1]);
      if (!target) {
        problems.push(`그림 관계를 찾지 못했다: ${drawingPart}#${blip[1]}`);
        continue;
      }
      const mediaPart = resolveRelative(drawingPart, target);

      let bytes: Buffer | null;
      try {
        bytes = archive.readEntry(mediaPart);
      } catch {
        problems.push(`그림 내용을 풀지 못했다: ${mediaPart}`);
        continue;
      }
      if (!bytes) {
        problems.push(`그림 파트가 없다: ${mediaPart}`);
        continue;
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const draft = byHash.get(sha256);
      if (draft) {
        draft.parts.add(mediaPart);
        if (!draft.sheets.includes(sheetName)) draft.sheets.push(sheetName);
        draft.placements += 1;
      } else {
        byHash.set(sha256, {
          sha256,
          bytes: bytes.length,
          parts: new Set([mediaPart]),
          sheets: [sheetName],
          placements: 1,
        });
      }
    }
  }

  const photos = [...byHash.values()].map((draft) => ({
    sha256: draft.sha256,
    bytes: draft.bytes,
    parts: [...draft.parts].sort(),
    sheets: draft.sheets,
    placements: draft.placements,
  }));

  return { photos, problems };
}

/** `xl/drawings/drawing5.xml` → `xl/drawings/_rels/drawing5.xml.rels` */
function relsPartOf(part: string): string {
  return part.replace(/([^/]+)$/, "_rels/$1.rels");
}

function readRelationships(archive: ZipArchive, relsPart: string): Map<string, string> {
  const map = new Map<string, string>();
  let xml: string | null;
  try {
    xml = archive.readTextOrNull(relsPart);
  } catch {
    return map;
  }
  if (!xml) return map;

  for (const relation of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(relation[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(relation[0])?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

/** `xl/drawings/drawing5.xml` + `../media/image8.jpg` → `xl/media/image8.jpg` */
function resolveRelative(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = fromPart.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") segments.pop();
    else segments.push(piece);
  }
  return segments.join("/");
}
