import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// `preload: false` — font-mono is used on /qc, /etiology, /heatmap,
// /incomplete and /screening only, but the preload link was injected into
// every route's <head> at High priority, competing with the render-blocking
// CSS. The @font-face (with font-display: swap and a metric-adjusted
// fallback) still ships, so those pages swap the glyphs in without shift.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "OHCA Dashboard",
  description: "OHCA REDCap Registry Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
