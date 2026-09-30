"use client";

import { ChevronRight } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setTagEmojiAction } from "./actions";
import { GraphView, type GraphOptionsState } from "./graph-view";

type TagMain = { name: string; count: number; emoji?: string; children: { name: string; count: number }[] };

const PRESET = "📁 📚 💻 👨‍💻 🧪 📝 📅 🗓️ ✅ ⭐ 🔥 💡 🎯 🏫 🎓 ✈️ 🏠 💼 🎨 🎮 🎵 📷 🧠 🔧 🌱 ❤️ 🚀 📌".split(" ");

function EmojiPicker({ tag, current, onDone }: { tag: string; current?: string; onDone: () => void }) {
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const save = (e: string) =>
    start(async () => {
      const r = await setTagEmojiAction(tag, e);
      if (r.ok) onDone();
      else setErr(r.message ?? "");
    });
  return (
    <div className="mt-1 space-y-2 rounded-md border bg-popover p-2 shadow-lg">
      <div className="grid grid-cols-7 gap-1">
        {PRESET.map((e) => (
          <button key={e} type="button" onClick={() => save(e)} disabled={pending} className="rounded p-1 text-lg hover:bg-muted">
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="직접 입력 (⌃⌘Space)"
          className="h-7 w-full rounded border bg-background px-2 text-sm"
          maxLength={16}
        />
        <Button size="sm" className="h-7" onClick={() => save(value)} disabled={pending}>
          저장
        </Button>
      </div>
      <div className="flex justify-between text-xs">
        {current ? (
          <button type="button" onClick={() => save("")} className="text-muted-foreground underline">
            이모지 빼기
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onDone} className="text-muted-foreground">
          닫기
        </button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function TagPane({ tags, onChange }: { tags: TagMain[]; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="space-y-0.5 text-sm">
      {!tags.length && <p className="text-muted-foreground">색인된 태그가 없습니다.</p>}
      {tags.map((t) => (
        <div key={t.name}>
          <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted">
            <button type="button" onClick={() => setOpen(open === t.name ? null : t.name)} className={`text-muted-foreground ${t.children.length ? "" : "invisible"}`} aria-label="하위 태그">
              <ChevronRight className={`size-3.5 transition-transform ${open === t.name ? "rotate-90" : ""}`} />
            </button>
            <button type="button" onClick={() => setEdit(edit === t.name ? null : t.name)} className="w-6 text-center text-base" title="이모지 설정">
              {t.emoji ?? <span className="text-xs text-muted-foreground">＋</span>}
            </button>
            <a href={`/search?q=${encodeURIComponent(t.name)}&tag=${encodeURIComponent(t.name)}`} className="flex-1 truncate hover:underline">
              {t.name}
            </a>
            <span className="text-xs text-muted-foreground">{t.count}</span>
          </div>
          {edit === t.name && (
            <EmojiPicker
              tag={t.name}
              current={t.emoji}
              onDone={() => {
                setEdit(null);
                onChange();
              }}
            />
          )}
          {open === t.name &&
            t.children.map((c) => (
              <a key={c.name} href={`/search?q=${encodeURIComponent(c.name)}&tag=${encodeURIComponent(c.name)}`} className="flex items-center gap-1 rounded py-0.5 pl-12 pr-1 hover:bg-muted">
                <span className="flex-1 truncate">{c.name.slice(t.name.length + 1)}</span>
                <span className="text-xs text-muted-foreground">{c.count}</span>
              </a>
            ))}
        </div>
      ))}
    </div>
  );
}

export function GraphClient({ tags, projects }: { tags: TagMain[]; projects: { id: number; name: string }[] }) {
  const [opts, setOpts] = useState<GraphOptionsState>({ tags: false, files: false, orphans: false, color: "folder", project: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const toggle = (k: "tags" | "files" | "orphans") => setOpts((o) => ({ ...o, [k]: !o[k] }));
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="relative h-[65vh] min-h-[420px] flex-1 lg:h-auto">
        <GraphView opts={opts} reloadKey={reloadKey} />
      </div>
      <aside className="space-y-5 overflow-y-auto border-t border-foreground/10 bg-background/60 p-4 lg:w-[320px] lg:border-l lg:border-t-0">
        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">표시</h2>
          {(
            [
              ["tags", "태그"],
              ["files", "첨부파일"],
              ["orphans", "연결 없는 노트"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-2">
            색 기준
            <select value={opts.color} onChange={(e) => setOpts((o) => ({ ...o, color: e.target.value as GraphOptionsState["color"] }))} className="h-7 rounded border bg-background px-1">
              <option value="folder">최상위 폴더</option>
              <option value="tag">메인 태그</option>
              <option value="source">소스</option>
            </select>
          </label>
          {projects.length > 0 && (
            <label className="flex items-center gap-2">
              범위
              <select value={opts.project} onChange={(e) => setOpts((o) => ({ ...o, project: e.target.value }))} className="h-7 max-w-44 rounded border bg-background px-1">
                <option value="">전체</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-muted-foreground">점을 누르면 노트가 열리고, 마우스를 올리면 이어진 노트가 강조됩니다. 휠로 확대하면 이름이 보입니다.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">태그</h2>
          <p className="text-xs text-muted-foreground">왼쪽 칸을 눌러 메인 태그에 이모지를 넣을 수 있습니다. 하위 태그와 그래프·검색에도 함께 보입니다.</p>
          <TagPane tags={tags} onChange={() => setReloadKey((k) => k + 1)} />
        </section>
      </aside>
    </div>
  );
}
