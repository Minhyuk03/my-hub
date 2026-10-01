import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "나의 허브",
  description: "흩어진 작업물을 한곳에서 찾는 개인 허브",
  // 아이폰 홈 화면에 추가하면 주소창 없이 앱처럼 열린다
  appleWebApp: { capable: true, title: "허브", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// 연결이 끊겼을 때 안내 화면을 보여 주는 서비스 워커 (HTTPS 또는 localhost 에서만 동작)
const swScript = `if("serviceWorker" in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})`;

// 첫 화면이 그려지기 전에 다크 모드 클래스를 정해 깜빡임을 막는다.
// 저장값: "light" | "dark" | 없음(시스템 설정 따름)
// 화면이 처음부터 다시 그려지며 <html> 클래스가 초기화돼도(React 복구 렌더링) 저장값대로 되돌린다.
const themeScript = `(function(){try{var h=document.documentElement;var want=function(){var t=localStorage.getItem("theme");return t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches};h.classList.toggle("dark",want());new MutationObserver(function(){var w=want();if(h.classList.contains("dark")!==w)h.classList.toggle("dark",w)}).observe(h,{attributes:true,attributeFilter:["class"]})}catch(e){}})()`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // CSP 가 허용하는 이번 요청의 nonce (src/proxy.ts)
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
