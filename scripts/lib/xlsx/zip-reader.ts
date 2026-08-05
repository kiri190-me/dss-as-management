import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP central-directory reader, just enough to pull named entries
 * (xl/worksheets/sheetN.xml, xl/drawings/drawingN.xml, etc.) out of an
 * .xlsx, which is an ordinary ZIP/OOXML package. Deliberately not a general
 * ZIP library and not a new dependency — this project has no existing
 * xlsx-parsing package, and the importer only ever needs to read a handful
 * of known-shaped XML entries by exact path, so a ~100-line reader using
 * only Node's built-in `zlib.inflateRawSync` is less surface area than
 * pulling in a third-party unzip library for one script.
 *
 * Supports the two compression methods every real-world .xlsx writer uses
 * (0 = stored, 8 = deflate). No ZIP64 support — not needed for files well
 * under 4 GB, which every worksheet/drawing entry in this workbook is by a
 * wide margin.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

type CentralDirEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export class ZipArchive {
  private readonly buf: Buffer;
  private readonly entries: Map<string, CentralDirEntry>;

  private constructor(buf: Buffer, entries: Map<string, CentralDirEntry>) {
    this.buf = buf;
    this.entries = entries;
  }

  static fromFile(filePath: string): ZipArchive {
    const buf = readFileSync(filePath);
    return ZipArchive.fromBuffer(buf);
  }

  static fromBuffer(buf: Buffer): ZipArchive {
    const eocdOffset = findEndOfCentralDirectory(buf);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

    const entries = new Map<string, CentralDirEntry>();
    let ptr = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      const sig = buf.readUInt32LE(ptr);
      if (sig !== CENTRAL_DIR_SIGNATURE) {
        throw new Error(
          `Malformed zip: expected central directory signature at offset ${ptr}, found 0x${sig.toString(16)}`
        );
      }
      const compressionMethod = buf.readUInt16LE(ptr + 10);
      const compressedSize = buf.readUInt32LE(ptr + 20);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);
      const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

      entries.set(name, { name, compressionMethod, compressedSize, localHeaderOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    return new ZipArchive(buf, entries);
  }

  has(entryName: string): boolean {
    return this.entries.has(entryName);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  /** Returns the entry's decompressed bytes, or null if it doesn't exist. */
  readEntry(entryName: string): Buffer | null {
    const entry = this.entries.get(entryName);
    if (!entry) return null;

    const localSig = this.buf.readUInt32LE(entry.localHeaderOffset);
    if (localSig !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(
        `Malformed zip: expected local file header signature for "${entryName}" at offset ${entry.localHeaderOffset}`
      );
    }
    const nameLen = this.buf.readUInt16LE(entry.localHeaderOffset + 26);
    const extraLen = this.buf.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const compressed = this.buf.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return Buffer.from(compressed);
    if (entry.compressionMethod === 8) return inflateRawSync(compressed);
    throw new Error(
      `Unsupported zip compression method ${entry.compressionMethod} for entry "${entryName}"`
    );
  }

  /** Same as readEntry, but decoded as UTF-8 text; throws if the entry is missing. */
  readText(entryName: string): string {
    const bytes = this.readEntry(entryName);
    if (!bytes) throw new Error(`Zip entry not found: "${entryName}"`);
    return bytes.toString("utf8");
  }

  readTextOrNull(entryName: string): string | null {
    const bytes = this.readEntry(entryName);
    return bytes ? bytes.toString("utf8") : null;
  }
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The EOCD record is at least 22 bytes and can be followed by a comment
  // up to 65535 bytes long, so scan backward from the end within that
  // window rather than assuming it's the last 22 bytes.
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("Not a valid zip file: end-of-central-directory record not found");
}
