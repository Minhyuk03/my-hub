"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { enqueue } from "@/server/sources/manage";

export async function rescanSource(sourceId: number) {
  enqueue(getDb(), "rescan", { sourceId });
  refresh();
}

export async function retryErrors(itemIds: number[]) {
  enqueue(getDb(), "retry", { itemIds });
  refresh();
}

export async function backupNow() {
  enqueue(getDb(), "backup");
  refresh();
}
