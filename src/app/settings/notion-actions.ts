"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { normId, NotionClient, pageTitle } from "@/server/connectors/notion/client";
import { notionRoot } from "@/server/connectors/notion/sync";
import { enqueue, sourceRoots } from "@/server/sources/manage";

const client = () => new NotionClient({ fetch, token: process.env.NOTION_TOKEN ?? "" });

/** 루트 페이지 추가: 주소나 ID 를 받아 통합이 볼 수 있는지 확인한 뒤 소스로 등록 */
export async function addNotionRoot(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const id = normId(String(form.get("page") ?? ""));
  if (!id) return { ok: false, message: "Notion 페이지 주소나 32자리 ID 를 넣어 주세요." };
  const db = getDb();
  if (sourceRoots(db).includes(notionRoot(id))) return { ok: false, message: "이미 등록된 페이지입니다." };
  try {
    const page = await client().getPage(id);
    const title = pageTitle(page);
    const row = db
      .insert(sources)
      .values({ kind: "notion", name: `${title} (Notion)`, rootPath: notionRoot(id), config: { rootId: id, rootTitle: title }, createdAt: Date.now() })
      .returning()
      .get();
    enqueue(db, "source_added", { sourceId: row.id });
    refresh();
    return { ok: true, message: `'${title}' 페이지와 하위 페이지를 가져옵니다.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 연결 확인: 통합 이름·워크스페이스 */
export async function notionWhoAmI(): Promise<string> {
  try {
    const me = await client().me();
    return `${me.bot?.workspace_name ?? "워크스페이스"} · 통합 '${me.name ?? ""}'`;
  } catch (e) {
    return `확인 실패: ${(e as Error).message}`;
  }
}
