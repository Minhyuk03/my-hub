import { ImageResponse } from "next/og";
import { HubIcon } from "./hub-icon";

export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
  // 512 는 maskable 용으로도 쓰므로 모서리를 둥글리지 않는다 (기기가 잘라 냄)
  return new ImageResponse(<HubIcon size={size} rounded={size < 512} />, { width: size, height: size });
}
