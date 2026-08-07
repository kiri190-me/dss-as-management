"use client";

import { useState } from "react";
import ReceiveStockDialog from "./ReceiveStockDialog";
import PartEditDialog from "./PartEditDialog";
import type { PartDetail } from "@/lib/db/queries/inventory";

/** Same string-typed local mirrors used across the Phase 5B-2 client components — UX convenience only, the mutation layer re-checks role independently regardless (see InventoryListScreen.tsx's identical comment). */
function canCreateOrEditPart(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}
function canReceiveStock(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
}

export default function PartDetailHeaderActions({
  part,
  categorySuggestions,
  itemTypeSuggestions,
  actingUserRole,
}: {
  part: PartDetail;
  categorySuggestions: string[];
  itemTypeSuggestions: string[];
  actingUserRole: string;
}) {
  const [dialog, setDialog] = useState<"RECEIVE" | "EDIT" | null>(null);
  const canReceive = canReceiveStock(actingUserRole);
  const canEdit = canCreateOrEditPart(actingUserRole);

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
