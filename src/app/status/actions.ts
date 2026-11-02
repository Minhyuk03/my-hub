"use server";

import { getDb } from "@/server/db";
import { enqueueAndWait } from "@/server/sources/manage";

// 워커가 처리할 때까지 기다렸다가 결과를 돌려준다 (화면의 CommandButton 이 보여 줌)

export async function rescanSource(sourceId: number) {
  return enqueueAndWait(getDb(), "rescan", { sourceId });
}

export async function retryErrors(itemIds: number[]) {
  return enqueueAndWait(getDb(), "retry", { itemIds }, 60_000);
}

export async function backupNow() {
  return enqueueAndWait(getDb(), "backup", {}, 60_000);
}
