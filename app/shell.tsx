"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/tenancy";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const HOME = "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10";
const BOOK = "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z";
const CLIPBOARD = "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M8 2h8v4H8z M12 11h4 M12 16h4 M8 11h.01 M8 16h.01";
const HELP = "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z";
const FILE = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8";
const USERS = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75";
const CAP = "M22 10v6 M2 10l10-5 10 5-10 5z M6 12v5c3 3 9 3 12 0v-5";
const DOWNLOAD = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3";
const CLOCK = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2";
const PENCIL = "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z";

const GROUPS = [
  ["Council work", [
    ["/", "Home", HOME],
    ["/inventory", "Inventory", CLIPBOARD],
    ["/draft", "Draft", FILE],
    ["/review", "Review", USERS],
    ["/training", "Training", CAP],
  ]],
  ["Reference", [
    ["/catalog", "Catalog", BOOK],
    ["/questionnaire", "Questions", HELP],
    ["/export", "Export", DOWNLOAD],
    ["/renewals", "Renewals", CLOCK],
  ]],
] as const;
const COUNCIL_ICON = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M19 8v6 M22 11h-6";

export function Shell({ user, title, kicker, children }: {
  user: (SessionUser & { districtName?: string }) | null;
  title: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  // Narrow screens only: the menu button shows and hides the nav.
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [path]);
  const item = (href: string, label: string, d: string) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link key={href} href={href} aria-current={active ? "page" : undefined}
        className={"navlink" + (active ? " active" : "")}>
        <Icon d={d} />
        {label}
      </Link>
    );
  };
  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      <div className={user ? "app" : "app public"}>
        <header className={"masthead" + (open ? " open" : "")}>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={PENCIL} />
              </svg>
            </span>
            <span className="wordmark">
              <Link href={user ? "/" : "/signin"}>Exhibit</Link>
              <span className="wordmark-sub">Your district&apos;s AI tool list, in plain language</span>
            </span>
          </div>
          {user ? (
            <>
              <button type="button" className="menu-btn" aria-expanded={open} aria-controls="primarynav" onClick={() => setOpen(!open)}>
                {open ? "Close menu" : "Menu"}
              </button>
              <nav className="primarynav" id="primarynav" aria-label="Primary">
                {GROUPS.map(([group, links]) => (
                  <React.Fragment key={group}>
                    <p className="navgroup">{group}</p>
                    {links.map(([href, label, d]) => item(href, label, d))}
                  </React.Fragment>
                ))}
                {user.role === "owner" ? (
                  <>
                    <p className="navgroup">Owner</p>
                    {item("/council", "Council", COUNCIL_ICON)}
                  </>
                ) : null}
              </nav>
              <div className="session">
                <span className="session-district">{user.districtName ?? "District"}</span>
                <span className="session-user">{user.email} · {user.role}</span>
                <Link className="signout" href="/signout">Sign out</Link>
              </div>
            </>
          ) : null}
        </header>
        <main className="wrap" id="content">
          {kicker ? <p className="kicker">{kicker}</p> : null}
          <h1>{title}</h1>
          {children}
          <footer className="footer">
            <span>Made with care for school staff · Exhibit</span>
            <span>Unknown is okay — we never guess about vendors.</span>
          </footer>
        </main>
      </div>
    </>
  );
}
