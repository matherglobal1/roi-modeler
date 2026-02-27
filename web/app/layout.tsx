import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import AppShell from "@/components/app-shell";
import "./globals.css";

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ROI Modeller Dashboard",
  description: "Interactive ROI optimization dashboard for multi-client budget planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
