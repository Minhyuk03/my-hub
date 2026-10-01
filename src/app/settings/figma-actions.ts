"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { FigmaClient, parseFigmaTarget } from "@/server/connectors/figma/client";
import { figmaRoot } from "@/server/connectors/figma/sync";
import { patchSourceConfig } from "@/server/connectors/common";
import { enqueue, sourceRoots } from "@/server/sources/manage";

const client = () => new FigmaClient({ fetch, token: process.env.FIGMA_TOKEN ?? "" });

export async function figmaWhoAmI(): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await client().me();
    return { ok: true, message: me.handle };
  } catch (e) {
    return { ok: false, message: `확인 실패: ${(e as Error).message}` };
  }
}

/** 팀·프로젝트 주소로 소스 추가 (주소를 확인한 뒤 등록) */
export async function addFigmaTarget(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const t = parseFigmaTarget(String(form.get("target") ?? ""));
  if (!t) return { ok: false, message: "팀 주소(…/files/team/숫자/…) 또는 프로젝트 주소(…/files/project/숫자/…)를 넣어 주세요." };
  const db = getDb();
  const root = figmaRoot(t.kind, t.id);
  if (sourceRoots(db).includes(root)) return { ok: false, message: "이미 등록되어 있습니다." };
  try {
    const name = t.kind === "team" ? (await client().teamProjects(t.id)).name : (await client().projectFiles(t.id)).name;
    const fetchText = form.get("fetchText") === "on";
    const row = db
      .insert(sources)
      .values({ kind: "figma", name: `${name || t.id} (Figma)`, rootPath: root, config: { target: t.kind, id: t.id, name, fetchText, dailyTextLimit: 20 }, createdAt: Date.now() })
      .returning()
      .get();
    enqueue(db, "source_added", { sourceId: row.id });
    refresh();
    return { ok: true, message: `'${name}' 을(를) 가져옵니다.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function setFigmaFetchText(sourceId: number, on: boolean) {
  const db = getDb();
  if (db.select().from(sources).where(eq(sources.id, sourceId)).get()) {
    patchSourceConfig(db, sourceId, { fetchText: on });
    if (on) enqueue(db, "rescan", { sourceId });
  }
  refresh();
}
