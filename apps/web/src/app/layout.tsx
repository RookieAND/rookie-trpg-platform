import type { ReactNode } from "react";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";
import { SERVICE_NAME } from "../shared/config";

export const metadata = { title: SERVICE_NAME };

/** 주소창·상태 막대 색을 화면 바탕과 맞춘다 */
export const viewport = { themeColor: "#08090a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
