import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function Home() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>최근 수정</CardTitle>
          <CardDescription>오늘 / 이번 주 / 이번 달</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty>아직 인덱싱된 항목이 없습니다. Phase 1에서 소스를 연결하면 여기에 표시됩니다.</Empty>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>소스 상태</CardTitle>
          <CardDescription>정상 · 동기화 중 · 오프라인 · 오류</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty>연결된 소스가 없습니다.</Empty>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>이어서 작업하기</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>최근 활동이 많은 프로젝트와 파일이 여기에 표시됩니다.</Empty>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Phase 0 점검</CardTitle>
        </CardHeader>
        <CardContent>
          <Link href="/phase0" className="text-sm underline underline-offset-4">
            환경 점검과 한국어 검색 비교 결과 보기 →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
