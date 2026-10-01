"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { GitHubClient } from "@/server/connectors/github/client";
import { githubRoot } from "@/server/connectors/github/sync";
import { enqueue, sourceRoots } from "@/server/sources/manage";

const client = () => new GitHubClient({ fetch, token: process.env.GITHUB_TOKEN ?? "" });

export async function githubWhoAmI(): Promise<{ ok: boolean; login?: string; message: string }> {
  try {
    const me = await client().me();
    return { ok: true, login: me.login, message: `${me.login}${me.name ? ` (${me.name})` : ""}` };
  } catch (e) {
    return { ok: false, message: `확인 실패: ${(e as Error).message}` };
  }
}

/** 토큰 계정의 저장소를 소스로 등록 */
export async function addGitHubAccount(includeForks: boolean) {
  const me = await githubWhoAmI();
  if (!me.ok || !me.login) return;
  const db = getDb();
  if (sourceRoots(db).includes(githubRoot(me.login))) return;
  const row = db
    .insert(sources)
    .values({ kind: "github", name: `${me.login} (GitHub)`, rootPath: githubRoot(me.login), config: { login: me.login, includeForks }, createdAt: Date.now() })
    .returning()
    .get();
  enqueue(db, "source_added", { sourceId: row.id });
  refresh();
}
