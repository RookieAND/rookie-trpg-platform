import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "[서비스 이름]" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
