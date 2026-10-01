"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { FOLDER_MIME } from "@/server/connectors/gdrive/client";
import { keychainStore } from "@/server/connectors/gdrive/tokens";
import { resetWebDrive, webDrive } from "@/server/connectors/gdrive/web";
import { isLocalRequest } from "@/server/http/local";
import { createDriveSource } from "@/server/sources/manage";
import { setSetting } from "@/server/settings";

export type DriveFolder = { id: string; name: string };

/** Drive 폴더 고르기: parentId 바로 아래 폴더 목록 */
export async function listDriveFolders(parentId: string): Promise<{ ok: boolean; folders: DriveFolder[]; name?: string; parent?: string | null; message?: string }> {
  try {
    const d = webDrive();
    const out: DriveFolder[] = [];
    let token: string | undefined;
    do {
      const page = await d.listChildren(parentId, token, true);
      out.push(...page.files.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })));
      token = page.nextPageToken;
    } while (token && out.length < 2000);
    const me = parentId === "root" ? { name: "내 드라이브", parents: [] as string[] } : await d.getFile(parentId);
    return { ok: true, folders: out, name: me.name, parent: parentId === "root" ? null : (me.parents?.[0] ?? "root") };
  } catch (e) {
    return { ok: false, folders: [], message: (e as Error).message };
  }
}

export async function addDriveFolder(id: string, name: string): Promise<{ ok: boolean; message: string }> {
  try {
    const s = createDriveSource(getDb(), id, name);
    refresh();
    return { ok: true, message: `${s.name} 추가됨. 가져오기를 시작합니다.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 연결 해제: 키체인의 토큰을 지운다. 이미 가져온 색인은 남고, 소스는 오프라인으로 표시된다. */
export async function disconnectDrive() {
  if (!isLocalRequest(await headers())) throw new Error("Mac mini에서 직접 접속한 경우에만 해제할 수 있습니다.");
  await keychainStore.clear();
  resetWebDrive();
  setSetting(getDb(), "gdriveAccount", null);
  refresh();
}
