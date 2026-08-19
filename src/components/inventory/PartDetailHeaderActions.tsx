"use client";

import { useState } from "react";
import ReceiveStockDialog from "./ReceiveStockDialog";
import PartEditDialog from "./PartEditDialog";
import type { PartDetail } from "@/lib/db/queries/inventory";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";

/* 역할 규칙의 로컬 사본이 여기 있었다 — InventoryListScreen.tsx와 같은 이유로
   제거하고, 서버가 해석한 capabilities를 받는다. */

export default function PartDetailHeaderActions({
  part,
  categorySuggestions,
  itemTypeSuggestions,
  capabilities,
}: {
  part: PartDetail;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
  capabilities: InventoryCapabilities;
}) {
  const [dialog, setDialog] = useState<"RECEIVE" | "EDIT" | null>(null);
  const canReceive = capabilities.stock;
  const canEdit = capabilities.parts;

  return (
    <div className="flex gap-2">
      {canEdit && (
        <button
          type="button"
          onClick={() => setDialog("EDIT")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          정보 수정
        </button>
      )}
      {canReceive && (
        <button
          type="button"
          onClick={() => setDialog("RECEIVE")}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          입고
        </button>
      )}

      <ReceiveStockDialog isOpen={dialog === "RECEIVE"} onClose={() => setDialog(null)} partId={part.id} />
      <PartEditDialog
        isOpen={dialog === "EDIT"}
        onClose={() => setDialog(null)}
        part={part}
        categorySuggestions={categorySuggestions}
        itemTypeSuggestions={itemTypeSuggestions}
      />
    </div>
  );
}
