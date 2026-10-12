"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/server/category-labels";

const KEY = "hub.categories";

/** 이 브라우저에 기억한 분류 선택 (없으면 null = 전부) */
export function savedCategories(): Category[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (!Array.isArray(v)) return null;
    const cats = v.filter((x): x is Category => (CATEGORIES as readonly string[]).includes(x));
    return cats.length && cats.length < CATEGORIES.length ? cats : null;
  } catch {
    return null;
  }
}

/**
 * 분류 체크박스 (문서·노트·코드·데이터·사진영상소리·기타). 누르면 바로 주소(?cat=)가 바뀌어 목록이 다시 그려진다.
 * 고른 것은 이 브라우저에 기억해, 검색·PARA 어디서든 같은 선택으로 시작한다. 마지막 하나는 끌 수 없다.
 */
export function CategoryFilter({ counts, className = "", inline = false }: { counts?: Record<string, number>; className?: string; inline?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const fromUrl = sp.getAll("cat").filter((x): x is Category => (CATEGORIES as readonly string[]).includes(x));
  const selected: Category[] = fromUrl.length ? fromUrl : [...CATEGORIES];

  const go = (cats: Category[]) => {
    const u = new URLSearchParams(sp.toString());
    u.delete("cat");
    u.delete("page");
    if (cats.length < CATEGORIES.length) for (const c of cats) u.append("cat", c);
    router.replace(`${pathname}${u.size ? `?${u}` : ""}`, { scroll: false });
  };

  // 주소에 선택이 없으면 기억해 둔 선택으로 시작
  useEffect(() => {
    if (fromUrl.length) return;
    const saved = savedCategories();
    if (saved) go(saved);
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (c: Category) => {
    const next = selected.includes(c) ? selected.filter((x) => x !== c) : CATEGORIES.filter((x) => x === c || selected.includes(x));
    if (!next.length) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    go(next);
  };

  return (
    <fieldset className={`${inline ? "flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" : "space-y-1"} ${className}`}>
      <legend className={inline ? "sr-only" : "mb-1 font-medium"}>분류</legend>
      {CATEGORIES.map((c) => {
        const on = selected.includes(c);
        return (
          <label key={c} className="flex items-center gap-2">
            <input type="checkbox" checked={on} disabled={on && selected.length === 1} onChange={() => toggle(c)} />
            <span>{CATEGORY_LABEL[c]}</span>
            {counts && <span className={`${inline ? "" : "ml-auto "}text-xs text-muted-foreground`}>{(counts[c] ?? 0).toLocaleString()}</span>}
          </label>
        );
      })}
      {/* 같은 화면의 다른 필터 양식을 제출해도 분류 선택이 유지되게 */}
      {selected.length < CATEGORIES.length && selected.map((c) => <input key={c} type="hidden" name="cat" value={c} />)}
      {selected.length < CATEGORIES.length && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            try {
              localStorage.removeItem(KEY);
            } catch {}
            go([...CATEGORIES]);
          }}
        >
          모두 보기
        </button>
      )}
    </fieldset>
  );
}
