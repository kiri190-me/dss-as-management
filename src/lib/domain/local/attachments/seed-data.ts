import { mockAttachments, mockRepairCases, mockUsers } from "../../mock-data";
import type { AttachmentMetadata } from "../../types";
import { isExtensionAllowedForCategory, isExtensionMimeCompatible, isPreviewCapableExtension } from "./allowlist";
import type {
  AttachmentCategory,
  LocalAttachmentEvent,
  LocalAttachmentMetadata,
  LocalMalwareScanStatus,
  PreviewStatus,
} from "./attachment-types";
import { deriveExtensionFromFileName, hasExecutableExtension } from "./filename";
import { validateAttachmentRecord } from "./validation";

/**
 * Stage D-2 시드는 mock-data.ts의 기존 mockAttachments(레거시 att-* 20건)를
 * 유일한 소스로 하는 어댑터 변환 결과다 — mockAttachments/AttachmentMetadata는
 * 런타임에도, 이 파일에서도 절대 mutate하지 않는다(읽기 전용 import만 한다).
 * 새 스키마에만 존재하는 필드(category/description/checksum/previewStatus 등)는
 * 아래 규칙에 따라 결정론적으로 채운다 — 매 실행마다 같은 원본이면 항상 같은
 * 결과가 나와야 한다(무작위 값을 쓰지 않는다).
 */

export type SeedConversionFailure = { originalId: string; reason: string };

const MALWARE_MAP: Record<AttachmentMetadata["malwareScanStatus"], LocalMalwareScanStatus> = {
  PENDING: "PENDING",
  CLEAN: "CLEAN",
  INFECTED: "BLOCKED",
};

/**
 * checksum.ts의 computeDemoChecksum과 완전히 동일한 알고리즘/문자열 포맷
 * (`${id}|${originalFileName}|${fileSizeBytes}|${category}|${uploadedAt}`의
 * SHA-256, "demo-meta-sha256:" 접두어)으로 미리 계산해 둔 상수다. 시드 생성은
 * useSyncExternalStore의 동기 getSnapshot 안에서 일어나므로 Web Crypto의
 * 비동기 crypto.subtle.digest를 여기서 await할 수 없어, 빌드 전에 Node의
 * crypto.createHash("sha256")로 동일한 입력에 대해 한 번 계산해 상수화했다.
 * seed-att-XXX 레코드가 늘어나면 이 맵도 함께 갱신해야 한다.
 */
const SEED_CHECKSUMS: Record<string, string> = {
  "seed-att-001": "demo-meta-sha256:4417ba2c44b4539179db29ff8caaa0a11051a801a16bed56f2c782a1940bd516",
  "seed-att-002": "demo-meta-sha256:8734accfde5e978e8a62c09c1b53ff4424f44d0fc8a837015caeb898d3c5a416",
  "seed-att-003": "demo-meta-sha256:235d0cd07878813d6d7140c7f6fbba5f0970db58757f05353e249f001c71af30",
  "seed-att-004": "demo-meta-sha256:8a8bd86d142f4e911cebbc3b51e14045cd216c76a32cd65f3f6051947cb40a42",
  "seed-att-005": "demo-meta-sha256:8a4b1fae7543948e60119560552c406a55a430ea49dc741a7f2a1debc6c487a6",
  "seed-att-006": "demo-meta-sha256:9cb3b5ae7b4ecb93bcc14b641977050659545b13d4d0003ca301fe547690dd9c",
  "seed-att-007": "demo-meta-sha256:ed7caeae8387a3a798b7ff5bf4dfe70a194c416b10161e7d7ce8e9976213b973",
  "seed-att-008": "demo-meta-sha256:6757d60289f0a89326861d3256e71186c86eac740eb73e4fb20001bf1e67b7e6",
  "seed-att-009": "demo-meta-sha256:cc85639bb53c8f921dbf5ccd1686ec71b4e1fcf3592f2859a1ac520cf813e527",
  "seed-att-010": "demo-meta-sha256:9096ee926e6dee3af3fcba99d0dffe8c782a833eabbe82afef32f1d5169fe943",
  "seed-att-011": "demo-meta-sha256:892d7997a4261be97cbaca31815e220e5ba1f8cb543c510c932e3d0feedca07d",
  "seed-att-012": "demo-meta-sha256:69fe5158046ef3f10cd3592deb31bf8a25ac8023615f265bd732957d890629c5",
  "seed-att-013": "demo-meta-sha256:d426d4212ea480cc94ad683496ee26e09d2d837425305f3af2f07db138ef5766",
  "seed-att-014": "demo-meta-sha256:3c7238fc6c8f5f0c08fd6d9e116eddd3e2a6104a1343da2efb42c817fdd8062a",
  "seed-att-015": "demo-meta-sha256:6f261d4fdca4abaf50801e63bd1a1fe345317bc96fc348a868b92bef1f20056d",
  "seed-att-016": "demo-meta-sha256:96b39153327ea4c8ccb72f6be1842aecf6530625e407d49c84e95ed5042498cd",
  "seed-att-017": "demo-meta-sha256:9f56e38d90ecbcbdee6185349a2b472d2b08c679bc216a8c6e2f751d474a4013",
  "seed-att-018": "demo-meta-sha256:f34a83e34b5d53a58cd4cb59e80d52befb04d9da09ce1ca36feeec9966087ef7",
  "seed-att-019": "demo-meta-sha256:1ae0e651a7912cfb6c8b1e7e8cb03b454d0189ad0b514082d1badf0736bc3842",
  "seed-att-020": "demo-meta-sha256:5ba9543ec4142b0f96448f78fd48ac82ab1230e270eb5c5ca8e97c8cdd93b427",
};

/** 파일명 패턴으로 결정론적 분류를 부여한다(원본에 category 필드가 없다). */
function deriveSeedCategory(fileName: string): AttachmentCategory {
  if (fileName.includes("photo")) return "INTAKE_PHOTO";
  if (fileName.includes("report")) return "INSPECTION_REPORT";
  if (fileName.includes("quote")) return "CUSTOMER_DOCUMENT";
  return "OTHER";
}

/**
 * 시드 레코드는 "이미 존재해 온" 레거시 데모 항목이라는 서사를 유지하기 위해
 * 새로 등록되는 레코드(actions.ts의 addAttachment, 항상 NOT_SCANNED/PENDING·
 * NOT_AVAILABLE)와는 다른 규칙을 쓴다: 매핑된 악성코드 상태가 BLOCKED면
 * 미리보기도 만들어지지 않은 것으로, PENDING이면 미리보기도 대기 중으로,
 * CLEAN이면(미리보기 가능 확장자에 한해) 이미 생성된 것으로 본다.
 */
function deriveSeedPreviewStatus(extension: string, malwareScanStatus: LocalMalwareScanStatus): PreviewStatus {
  if (malwareScanStatus === "BLOCKED") return "NOT_AVAILABLE";
  if (!isPreviewCapableExtension(extension)) return "NOT_AVAILABLE";
  if (malwareScanStatus === "PENDING") return "PENDING";
  return "READY";
}

export type SeedConversionResult = {
  records: LocalAttachmentMetadata[];
  events: LocalAttachmentEvent[];
  failures: SeedConversionFailure[];
};

/**
 * mockAttachments의 각 레코드를 LocalAttachmentMetadata + CREATED 이벤트로
 * 변환한다. mockAttachments/AttachmentMetadata는 여기서도 읽기만 하고 절대
 * 수정하지 않는다. 안전하게 변환할 수 없는 레코드(알 수 없는 접수 건/사용자,
 * 허용되지 않는 확장자·MIME 조합 등)는 건너뛰고 failures에 사유를 기록한다 —
 * 조용히 다른 값으로 보정하지 않는다.
 */
export function buildSeedAttachmentEnvelope(): SeedConversionResult {
  const records: LocalAttachmentMetadata[] = [];
  const events: LocalAttachmentEvent[] = [];
  const failures: SeedConversionFailure[] = [];

  for (const original of mockAttachments) {
    const seedId = original.id.replace(/^att-/, "seed-att-");

    if (!mockRepairCases.some((c) => c.id === original.repairCaseId)) {
      failures.push({ originalId: original.id, reason: `알 수 없는 repairCaseId: ${original.repairCaseId}` });
      continue;
    }
    const uploader = mockUsers.find((u) => u.id === original.uploadedBy);
    if (!uploader) {
      failures.push({ originalId: original.id, reason: `알 수 없는 uploadedBy: ${original.uploadedBy}` });
      continue;
    }
    const extension = deriveExtensionFromFileName(original.fileName);
    if (!extension) {
      failures.push({ originalId: original.id, reason: `확장자를 파생할 수 없는 fileName: ${original.fileName}` });
      continue;
    }
    if (hasExecutableExtension(extension)) {
      failures.push({ originalId: original.id, reason: `실행 파일 확장자: .${extension}` });
      continue;
    }
    const category = deriveSeedCategory(original.fileName);
    if (!isExtensionAllowedForCategory(extension, category)) {
      failures.push({ originalId: original.id, reason: `카테고리(${category})에 허용되지 않는 확장자: .${extension}` });
      continue;
    }
    if (!isExtensionMimeCompatible(extension, original.mimeType)) {
      failures.push({ originalId: original.id, reason: `확장자/MIME 불일치: .${extension} / ${original.mimeType}` });
      continue;
    }
    if (!Number.isInteger(original.fileSizeBytes) || original.fileSizeBytes <= 0) {
      failures.push({ originalId: original.id, reason: `유효하지 않은 fileSizeBytes: ${original.fileSizeBytes}` });
      continue;
    }
    const malwareScanStatus = MALWARE_MAP[original.malwareScanStatus];
    if (!malwareScanStatus) {
      failures.push({ originalId: original.id, reason: `알 수 없는 malwareScanStatus: ${original.malwareScanStatus}` });
      continue;
    }
    const checksum = SEED_CHECKSUMS[seedId];
    if (!checksum) {
      failures.push({ originalId: original.id, reason: `사전 계산된 체크섬 없음: ${seedId}` });
      continue;
    }

    const previewStatus = deriveSeedPreviewStatus(extension, malwareScanStatus);

    const record: LocalAttachmentMetadata = {
      id: seedId,
      repairCaseId: original.repairCaseId,
      originalFileName: original.fileName,
      displayName: original.fileName,
      fileExtension: extension,
      mimeType: original.mimeType,
      fileSizeBytes: original.fileSizeBytes,
      category,
      uploadedByUserId: original.uploadedBy,
      uploadedByNameSnapshot: uploader.name,
      uploadedAt: original.uploadedAt,
      previewStatus,
      malwareScanStatus,
      checksum,
      description: null,
      isDeleted: false,
      deletedByUserId: null,
      deletedByNameSnapshot: null,
      deletedAt: null,
      deletionReason: null,
      source: "LOCAL_DEMO",
    };

    if (!validateAttachmentRecord(record)) {
      failures.push({ originalId: original.id, reason: "변환된 레코드가 자체 검증 규칙을 통과하지 못함" });
      continue;
    }

    records.push(record);
    events.push({
      id: `${seedId}-event-created`,
      attachmentId: seedId,
      repairCaseId: original.repairCaseId,
      eventType: "CREATED",
      actorUserId: original.uploadedBy,
      actorNameSnapshot: uploader.name,
      occurredAt: original.uploadedAt,
      comment: null,
      previousDisplayName: null,
      newDisplayName: null,
      source: "LOCAL_DEMO",
    });
  }

  return { records, events, failures };
}
