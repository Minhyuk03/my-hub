import Link from "next/link";
import { connection } from "next/server";
import { SourceIcon, SourceStatusBadge } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { bytes, fullDate, relTime, shortPath, untilTime } from "@/lib/format";
import { ITEM_STATE_LABEL, SOURCE_KIND_LABEL } from "@/lib/labels";
import { getDb } from "@/server/db";
import { envSnapshot, errorList, sourcesWithStats, workerStatus } from "@/server/queries";
import { getSettings } from "@/server/settings";
import { AutoRefresh } from "./auto-refresh";
import { backupNow, rescanSource, retryErrors } from "./actions";

export default async function StatusPage() {
  await connection();
  const db = getDb();
  const srcs = sourcesWithStats(db);
  const errors = errorList(db);
  const worker = workerStatus(db);
  // 디스크는 직접 읽지 않고 워커가 기록한 정보만 쓴다 (권한 문제로 웹 화면이 멈추지 않게)
  const env = envSnapshot(db);
  const settings = getSettings(db);
  const diskBackups = env?.backups ?? [];
  const pending = env?.pending ?? [];
  const syncing = srcs.some((s) => s.status === "syncing");

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={syncing ? 3 : 15} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">동기화 상태</h1>
        <span className={worker.alive ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          인덱서 {worker.alive ? `실행 중 (마지막 응답 ${relTime(worker.updatedAt)})` : "멈춤 — 터미널에서 npm run hub 로 시작하세요"}
        </span>
        <Link href="/duplicates" className="ml-auto text-sm text-primary hover:underline">
          중복 파일 보기 →
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {srcs.map((s) => {
          const pct = s.job?.total ? Math.min(100, Math.round((s.job.processed / s.job.total) * 100)) : null;
          return (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SourceIcon kind={s.kind} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto">
                    <SourceStatusBadge status={s.status} />
                  </span>
                </CardTitle>
                <CardDescription className="break-all">
                  {SOURCE_KIND_LABEL[s.kind]} · {shortPath(s.rootPath)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {s.lastError && <p className="text-destructive">{s.lastError}</p>}
                {s.job && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">
                      확인 중 {s.job.processed.toLocaleString()}
                      {s.job.total ? ` / 약 ${s.job.total.toLocaleString()}` : ""}개
                    </p>
                    {pct != null && <Progress value={pct} />}
                  </div>
                )}
                <p>
                  항목 {s.total.toLocaleString()}개
                  {Object.entries(s.byState)
                    .filter(([k]) => k !== "ok")
                    .map(([k, n]) => ` · ${ITEM_STATE_LABEL[k] ?? k} ${n.toLocaleString()}`)
                    .join("")}
                </p>
                <p className="text-muted-foreground">
                  마지막 전체 확인: {fullDate(s.lastFullScanAt)} {s.lastFullScanOk === false && "(실패)"}
                </p>
                <div className="flex gap-2 pt-1">
                  <form action={rescanSource.bind(null, s.id)}>
                    <Button type="submit" variant="outline" size="sm">
                      지금 다시 확인
                    </Button>
                  </form>
                  {s.errorCount > 0 && <span className="self-center text-destructive">오류 {s.errorCount}개</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>외장 디스크</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {!env && <p className="text-muted-foreground">인덱서가 아직 정보를 기록하지 않았습니다.</p>}
          {env?.volumes.map((v) => (
            <p key={v.path}>
              <code>{v.path}</code> — {v.mounted ? `연결됨 · 여유 ${bytes(v.freeBytes)} / ${bytes(v.totalBytes)}` : "분리됨"}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DB 백업</CardTitle>
          <CardDescription>
            매일 {settings.backupHour}시 이후 자동 · 일간 {settings.backupKeepDaily}개 + 주간 {settings.backupKeepWeekly}개 보관
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            위치: <code>{settings.backupDir}</code> ({diskBackups.length}개)
          </p>
          <p>마지막 백업: {diskBackups[0] ? `${fullDate(diskBackups[0].createdAt)} (${bytes(diskBackups[0].size)})` : "없음"}</p>
          {pending.length > 0 && <p className="text-destructive">외장 디스크가 없어 내장 디스크에 임시 보관 중인 백업 {pending.length}개 (디스크 연결 시 자동 이동)</p>}
          <form action={backupNow}>
            <Button type="submit" variant="outline" size="sm">
              지금 백업
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>오류 목록</CardTitle>
          <CardDescription>실패한 항목은 1분 → 5분 → 30분 → 6시간 간격으로 자동 재시도합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!errors.length && <p className="text-muted-foreground">오류가 없습니다.</p>}
          {errors.length > 0 && (
            <form action={retryErrors.bind(null, errors.map((e) => e.itemId))}>
              <Button type="submit" variant="outline" size="sm">
                전체 다시 시도
              </Button>
            </form>
          )}
          <ul className="divide-y">
            {errors.map((e) => (
              <li key={e.itemId} className="flex flex-wrap items-center gap-2 py-2">
                <a href={`/items/${e.itemId}`} className="truncate font-medium hover:underline">
                  {e.title}
                </a>
                <span className="text-destructive">{e.message}</span>
                <span className="text-xs text-muted-foreground">
                  재시도 {e.retryCount}회 · {e.nextRetryAt ? `다음 시도 ${untilTime(e.nextRetryAt)}` : "자동 재시도 끝"}
                </span>
                <form action={retryErrors.bind(null, [e.itemId])} className="ml-auto">
                  <Button type="submit" variant="ghost" size="sm">
                    재시도
                  </Button>
                </form>
                <span className="w-full truncate text-xs text-muted-foreground">{shortPath(e.path)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
