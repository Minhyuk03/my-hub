"use client";

import { ArrowDown, ArrowUp, Crop, Plus, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_PROFILE, imageSrc, PROFILE_FIELDS, splitImageRef, withImagePos, PROFILE_LISTS, type FieldDef, type Profile, type ProfileListKey } from "@/server/profile";
import { saveProfile, uploadProfileImage } from "../actions";

type Row = Record<string, string | number | boolean | null>;
const inputCls = "h-8";
const areaCls = "min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm";
const IMAGE_HINT = "올리기·끌어 놓기, 또는 허브 파일 번호(1234)·/items/1234·https 주소";

type Frame = { label: string; cls: string };
/** 첫 화면에서 사진이 들어가는 칸 모양 (위치 고르기 미리보기용) */
const FRAMES: Record<string, Frame[]> = {
  hero: [
    { label: "넓은 화면", cls: "aspect-video w-44" },
    { label: "휴대폰", cls: "aspect-[9/19] w-20" },
  ],
  photo: [{ label: "프로필", cls: "aspect-[4/5] w-28" }],
  cover: [
    { label: "가로 칸", cls: "aspect-[4/3] w-32" },
    { label: "세로 칸", cls: "aspect-[4/5] w-28" },
  ],
};

/** 보일 위치 고르기: 원본 위를 누르거나 끌면 그 부분이 칸 안에 남는다. 옆에 실제 칸 모양 미리보기 */
function FocusPicker({ src, x, y, frames, onChange }: { src: string; x: number; y: number; frames: Frame[]; onChange: (x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    onChange(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  };
  return (
    // 사진 칸이 <label> 안에 있어서, 누른 것이 label 의 다른 버튼(위치·업로드)으로 넘어가지 않게 막는다
    <div className="flex flex-wrap items-start gap-4 rounded-md border bg-muted/30 p-3" onClick={(e) => e.preventDefault()}>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">남길 부분을 누르거나 끌어서 고르세요</p>
        <div
          ref={box}
          className="relative inline-block cursor-crosshair touch-none select-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            set(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) set(e);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 원본 전체 보기 */}
          <img src={src} alt="" draggable={false} className="block max-h-72 max-w-full rounded-sm" />
          <span
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {frames.map((f) => (
          <figure key={f.label} className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- 칸 모양 미리보기 */}
            <img src={src} alt="" className={`${f.cls} rounded-sm object-cover`} style={{ objectPosition: `${x}% ${y}%` }} />
            <figcaption className="text-[11px] text-muted-foreground">{f.label}</figcaption>
          </figure>
        ))}
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange(50, 50)}>
          가운데로
        </Button>
      </div>
    </div>
  );
}

/** 사진 칸: 업로드 버튼·끌어 놓기 + 직접 적기(허브 파일·주소) + 미리보기 + 보일 위치 */
function ImageField({ id, value, frames, onChange }: { id: string; value: string; frames: Frame[]; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const src = imageSrc(value);
  const { ref: base, x, y } = splitImageRef(value);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", file);
      const r = await uploadProfileImage(form);
      if (r.ok) {
        onChange(r.ref);
        setCrop(true);
      }
      else setError(r.message);
    } catch (e) {
      setError(`올리지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div
      className={`space-y-1 rounded-md ${over ? "ring-2 ring-primary" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex items-center gap-2">
        {/* 네모 칸을 눌러도 사진 고르기가 열린다. <label> 안이라 button 대신 span: label 이 이 칸을 대상으로 잡지 않게 한다 */}
        <span
          role="button"
          tabIndex={0}
          title="눌러서 사진 고르기"
          aria-label="사진 고르기"
          className="size-10 shrink-0 cursor-pointer rounded-sm hover:ring-2 hover:ring-primary/50"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) input.current?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) input.current?.click();
            }
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- 올린 사진·허브 파일·외부 주소 미리보기
            <img src={src} alt="" className="size-10 rounded-sm object-cover" style={{ objectPosition: `${x}% ${y}%` }} />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-sm border border-dashed text-muted-foreground">
              <Upload className="size-3.5" />
            </span>
          )}
        </span>
        <Input id={id} className={inputCls} value={base.startsWith("upload:") ? "올린 사진" : base} readOnly={base.startsWith("upload:")} placeholder={IMAGE_HINT} onChange={(e) => onChange(withImagePos(e.target.value, x, y))} />
        <input ref={input} id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={busy} onClick={() => input.current?.click()}>
          <Upload className="size-3.5" /> {busy ? "올리는 중…" : "업로드"}
        </Button>
        {src && (
          <Button type="button" variant={crop ? "secondary" : "ghost"} size="sm" className="h-8 shrink-0" onClick={() => setCrop(!crop)} aria-expanded={crop} title="사진이 잘릴 때 보일 부분 고르기">
            <Crop className="size-3.5" /> 위치
          </Button>
        )}
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={() => onChange("")} aria-label="사진 빼기" title="사진 빼기">
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {crop && src && <FocusPicker src={src} x={x} y={y} frames={frames} onChange={(nx, ny) => onChange(withImagePos(base, nx, ny))} />}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** 칸 하나: 글 / 여러 줄 / 별점 / 이미지(미리보기) */
function Field({ id, def, value, onChange }: { id: string; def: FieldDef; value: string; onChange: (v: string) => void }) {
  if (def.type === "multiline") return <textarea id={id} className={areaCls} value={value} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
  if (def.type === "stars")
    return (
      <select id={id} className="h-8 w-full rounded-md border bg-background px-2" value={value || "0"} onChange={(e) => onChange(e.target.value)}>
        {[5, 4, 3, 2, 1, 0].map((n) => (
          <option key={n} value={n}>
            {n ? "★".repeat(n) + "☆".repeat(5 - n) : "표시 안 함"}
          </option>
        ))}
      </select>
    );
  if (def.type === "image") return <ImageField id={id} value={value} frames={FRAMES[def.key] ?? FRAMES.cover} onChange={onChange} />;
  return <Input id={id} className={inputCls} value={value} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

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
  const setField = (k: "name" | "nameEn" | "headline" | "about" | "photo" | "hero", v: string) => update({ ...p, [k]: v });
  const rows = (k: ProfileListKey) => p[k] as unknown as Row[];
  const setRows = (k: ProfileListKey, r: Row[]) => update({ ...p, [k]: r });
  const blankRow = (k: ProfileListKey): Row => {
    const r: Row = { public: false };
    for (const f of PROFILE_FIELDS[k].fields) r[f.key] = f.type === "stars" ? "3" : "";
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
            <span className="text-muted-foreground">프로필 사진</span>
            <Field id="pf-photo" def={{ key: "photo", label: "프로필 사진", type: "image" }} value={p.photo} onChange={(v) => setField("photo", v)} />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">맨 위 배경 사진</span>
            <Field id="pf-hero" def={{ key: "hero", label: "배경 사진", type: "image" }} value={p.hero} onChange={(v) => setField("hero", v)} />
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

      {PROFILE_LISTS.map((k) => {
        const def = PROFILE_FIELDS[k];
        const list = rows(k);
        return (
          <section key={k} id={k} className="scroll-mt-20 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{def.title}</h2>
              <span className="text-xs text-muted-foreground">{list.length}개</span>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{def.hint}</p>
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
                      <label key={f.key} className={`space-y-1 text-sm ${f.type === "multiline" || f.type === "image" ? "sm:col-span-2" : ""}`}>
                        <span className="text-xs text-muted-foreground">{f.label}</span>
                        <Field id={`pf-${k}-${i}-${f.key}`} def={f} value={String(r[f.key] ?? "")} onChange={(v) => set(f.key, v)} />
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
