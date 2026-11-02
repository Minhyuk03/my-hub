"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_PROFILE, PROFILE_FIELDS, type Profile, type ProfileListKey } from "@/server/profile";
import { saveProfile } from "../actions";

type Row = Record<string, string | number | boolean | null>;
const SECTIONS: ProfileListKey[] = ["links", "education", "skills", "experience", "awards", "projects"];
const inputCls = "h-8";
const areaCls = "min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm";

/** 자기소개 편집: 한 화면에서 고치고 "저장"을 누르면 한꺼번에 저장 */
export function ProfileEditor({ initial, hubProjects }: { initial: Profile; hubProjects: { id: number; name: string }[] }) {
  const [p, setP] = useState<Profile>(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();

  const update = (next: Profile) => {
    setP(next);
    setDirty(true);
    setMsg(null);
  };
  const setField = (k: "name" | "nameEn" | "headline" | "about", v: string) => update({ ...p, [k]: v });
  const rows = (k: ProfileListKey) => p[k] as unknown as Row[];
  const setRows = (k: ProfileListKey, r: Row[]) => update({ ...p, [k]: r });
  const blankRow = (k: ProfileListKey): Row => {
    const r: Row = { public: false };
    for (const f of PROFILE_FIELDS[k].fields) r[f.key] = "";
    if (k === "projects") r.projectId = null;
    return r;
  };
  const save = () =>
    start(async () => {
      try {
        const r = await saveProfile(p);
        setMsg({ ok: r.ok, text: r.message });
        if (r.ok) setDirty(false);
      } catch (e) {
        setMsg({ ok: false, text: `저장하지 못했습니다: ${(e as Error).message}` });
      }
    });

  return (
    <div className="space-y-8 pb-20">
      <section id="basics" className="space-y-3">
        <h2 className="font-semibold">인적사항</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">이름</span>
            <Input id="pf-name" className={inputCls} value={p.name} onChange={(e) => setField("name", e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">영문 이름</span>
            <Input id="pf-name-en" className={inputCls} value={p.nameEn} onChange={(e) => setField("nameEn", e.target.value)} />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">한 줄 소개</span>
            <Input id="pf-headline" className={inputCls} value={p.headline} placeholder="예: 임베디드와 온디바이스 AI를 공부하는 학생" onChange={(e) => setField("headline", e.target.value)} />
          </label>
        </div>
      </section>

      <section id="about" className="space-y-2">
        <h2 className="font-semibold">자기소개</h2>
        <textarea id="pf-about" className={`${areaCls} min-h-32`} value={p.about} placeholder="3~5문장으로 나를 소개해 주세요." onChange={(e) => setField("about", e.target.value)} />
      </section>

      {SECTIONS.map((k) => {
        const def = PROFILE_FIELDS[k];
        const list = rows(k);
        return (
          <section key={k} id={k} className="scroll-mt-20 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{def.title}</h2>
              <span className="text-xs text-muted-foreground">{list.length}개</span>
            </div>
            {list.map((r, i) => {
              const set = (key: string, v: string | number | boolean | null) => setRows(k, list.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
              const move = (d: -1 | 1) => {
                const next = [...list];
                [next[i], next[i + d]] = [next[i + d], next[i]];
                setRows(k, next);
              };
              return (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {def.fields.map((f) => (
                      <label key={f.key} className={`space-y-1 text-sm ${f.multiline ? "sm:col-span-2" : ""}`}>
                        <span className="text-xs text-muted-foreground">{f.label}</span>
                        {f.multiline ? (
                          <textarea id={`pf-${k}-${i}-${f.key}`} className={areaCls} value={String(r[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                        ) : (
                          <Input id={`pf-${k}-${i}-${f.key}`} className={inputCls} value={String(r[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                        )}
                      </label>
                    ))}
                    {k === "projects" && (
                      <label className="space-y-1 text-sm">
                        <span className="text-xs text-muted-foreground">허브 프로젝트 연결 (노트·파일·저장소)</span>
                        <select
                          id={`pf-${k}-${i}-project`}
                          className="h-8 w-full rounded-md border bg-background px-2"
                          value={r.projectId == null ? "" : String(r.projectId)}
                          onChange={(e) => set("projectId", e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">연결 안 함</option>
                          {hubProjects.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <label className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground" title="나중에 공개 페이지를 만들 때 이 항목을 내보냅니다">
                      <input id={`pf-${k}-${i}-public`} type="checkbox" checked={r.public === true} onChange={(e) => set("public", e.target.checked)} />
                      공개 페이지에 넣기
                    </label>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={i === 0} onClick={() => move(-1)} aria-label="위로">
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={i === list.length - 1} onClick={() => move(1)} aria-label="아래로">
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => setRows(k, list.filter((_, j) => j !== i))} aria-label="삭제">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows(k, [...list, blankRow(k)])}>
              <Plus className="size-3.5" /> {def.title} 추가
            </Button>
          </section>
        );
      })}

      {/* 아래에 붙어 있는 저장 줄 */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? "저장 중…" : "저장"}
          </Button>
          <Link href="/" className="text-sm underline">
            {dirty ? "저장하지 않고 돌아가기" : "자기소개 보기"}
          </Link>
          {msg && <span className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>{msg.text}</span>}
          {dirty && !msg && <span className="text-sm text-muted-foreground">저장하지 않은 변경이 있습니다</span>}
          <Button type="button" variant="ghost" size="sm" className="ml-auto text-xs text-muted-foreground" onClick={() => update(EMPTY_PROFILE)}>
            모두 비우기
          </Button>
        </div>
      </div>
    </div>
  );
}
