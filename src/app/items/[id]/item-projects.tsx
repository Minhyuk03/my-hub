import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { itemRuleAction } from "@/app/projects/actions";

/** 이 항목이 속한 프로젝트 + 개별 추가 */
export function ItemProjects({
  itemId,
  memberOf,
  projects,
}: {
  itemId: number;
  memberOf: { id: number; name: string; via: "folder" | "item" }[];
  projects: { id: number; name: string }[];
}) {
  const others = projects.filter((p) => !memberOf.some((m) => m.id === p.id));
  async function add(form: FormData) {
    "use server";
    const pid = Number(form.get("project"));
    if (pid) await itemRuleAction(pid, itemId, "include");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">프로젝트:</span>
      {!memberOf.length && <span className="text-muted-foreground">없음</span>}
      {memberOf.map((m) => (
        <span key={m.id} className="flex items-center gap-1">
          <Link href={`/projects/${m.id}`}>
            <Badge variant="secondary">{m.name}</Badge>
          </Link>
          <form action={itemRuleAction.bind(null, m.id, itemId, m.via === "item" ? "clear" : "exclude")}>
            <Button type="submit" variant="ghost" size="sm" className="h-6 px-1 text-xs text-muted-foreground" title={m.via === "item" ? "프로젝트에서 빼기" : "이 프로젝트에서 제외"}>
              ✕
            </Button>
          </form>
        </span>
      ))}
      {others.length > 0 && (
        <form action={add} className="flex items-center gap-1">
          <select name="project" className="h-7 rounded-md border bg-background px-1 text-xs" defaultValue="">
            <option value="" disabled>
              프로젝트에 추가…
            </option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
            추가
          </Button>
        </form>
      )}
    </div>
  );
}
