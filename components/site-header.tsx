"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, UserRound, X } from "lucide-react";
import { Logo } from "./logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/studio-os", label: "Studio OS" },
  { href: "/studio-os/download", label: "Download App" },
  { href: "/pricing", label: "Pricing" },
  // The prominent "Parents Portal" button on the right side of the header
  // already links to /parents, so the small-text link here was redundant.
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu if the viewport grows past the md breakpoint
  // (e.g. user rotates a tablet to landscape while the panel is open).
  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [menuOpen]);

  // Lock background scroll while the mobile menu is open.
  useEffect(() => {
    if (menuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:h-[96px] sm:px-6 sm:pt-[4px] lg:px-8">
        <Link href="/" className="text-left" onClick={closeMenu}>
          <Logo small caption="brand" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-neutral-600 transition hover:text-neutral-950"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          <Link
            href="/parents"
            className="inline-flex items-center gap-2 rounded-2xl border border-[#e7e2d8] bg-[linear-gradient(180deg,#ffffff_0%,#faf8f4_50%,#f3eee5_100%)] px-4 py-2.5 text-sm font-semibold text-neutral-950 shadow-[0_10px_22px_rgba(23,23,23,0.06)] transition hover:brightness-[0.99]"
          >
            <UserRound className="h-4 w-4 text-neutral-700" />
            Parents Portal
          </Link>

          <Link
            href="/sign-in"
            className="rounded-2xl border border-transparent px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-200/80 hover:bg-neutral-50 hover:text-neutral-950"
          >
            Photographer Sign In
          </Link>

          <Link
            href="/studio-os/download"
            className="rounded-2xl border border-[#050505] bg-[linear-gradient(180deg,#181818_0%,#080808_55%,#000000_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_14px_28px_rgba(0,0,0,0.18)] transition hover:brightness-[1.03]"
          >
            Download App
          </Link>
        </div>

        {/* Hamburger — visible below the sm breakpoint */}
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="site-header-mobile-panel"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-800 transition hover:bg-neutral-50 active:scale-[0.97] sm:hidden"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile slide-down panel */}
      {menuOpen && (
        <div
          id="site-header-mobile-panel"
          className="border-t border-neutral-200 bg-white sm:hidden"
        >
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-xl px-3 py-3 text-base font-medium text-neutral-800 transition hover:bg-neutral-50 active:bg-neutral-100"
              >
                {link.label}
              </Link>
            ))}

            <div className="mt-2 flex flex-col gap-2 border-t border-neutral-200 pt-3">
              <Link
                href="/parents"
                onClick={closeMenu}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#e7e2d8] bg-[linear-gradient(180deg,#ffffff_0%,#faf8f4_50%,#f3eee5_100%)] px-4 py-3 text-sm font-semibold text-neutral-950 shadow-[0_10px_22px_rgba(23,23,23,0.06)]"
              >
                <UserRound className="h-4 w-4 text-neutral-700" />
                Parents Portal
              </Link>

              <Link
                href="/sign-in"
                onClick={closeMenu}
                className="rounded-2xl border border-neutral-200 px-4 py-3 text-center text-sm font-medium text-neutral-800 transition hover:bg-neutral-50"
              >
                Photographer Sign In
              </Link>

              <Link
                href="/studio-os/download"
                onClick={closeMenu}
                className="rounded-2xl border border-[#050505] bg-[linear-gradient(180deg,#181818_0%,#080808_55%,#000000_100%)] px-4 py-3 text-center text-sm font-medium text-white shadow-[0_14px_28px_rgba(0,0,0,0.18)]"
              >
                Download App
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
