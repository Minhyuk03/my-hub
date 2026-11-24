"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Shortcut } from "./actions";
import { FolderPicker } from "./folder-picker";

/** 폴더 없음·연결 끊김 소스의 "위치 바꾸기": 옮긴 폴더를 골라 새 위치로 정한다 */
export function RelocateSource({ sourceId, name, shortcuts }: { sourceId: number; name: string; shortcuts: Shortcut[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        {open ? "닫기" : "위치 바꾸기"}
      </Button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">옮긴 폴더를 고르세요. 프로젝트 연결·태그·AI 제안은 그대로 유지됩니다.</p>
          <FolderPicker shortcuts={shortcuts} relocate={{ sourceId, name }} />
        </div>
      )}
    </div>
  );
}
