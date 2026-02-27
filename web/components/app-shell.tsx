"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/upload-data", label: "Upload Data" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandTop}>JUSTGLOBAL</span>
          <strong>ROI Modeller</strong>
        </div>

        <nav className={styles.nav} aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive(pathname, item.href) ? styles.navItemActive : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className={styles.viewport}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
