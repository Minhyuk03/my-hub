import type { Metadata, Viewport } from "next";
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

// 첫 화면이 그려지기 전에 다크 모드 클래스를 정해 깜빡임을 막는다.
// 저장값: "light" | "dark" | 없음(시스템 설정 따름)
// 연결이 끊겼을 때 안내 화면을 보여 주는 서비스 워커 (HTTPS 또는 localhost 에서만 동작)
const swScript = `if("serviceWorker" in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})`;
const themeScript = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
