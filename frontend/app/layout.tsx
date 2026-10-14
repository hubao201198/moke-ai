import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./automation.css";
import "./coze.css";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${protocol}://${host}`;
  const title = "贸客 AI · 外贸智能获客与自动化";
  const description = "从 AI 搜客、客户管理到企微与邮件运营的外贸工作台。";
  return { title, description, icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" }, openGraph: { title, description, type: "website", images: [{ url: `${base}/og.png`, width: 1733, height: 909, alt: "贸客 AI 外贸智能获客与自动化" }] }, twitter: { card: "summary_large_image", title, description, images: [`${base}/og.png`] } };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
