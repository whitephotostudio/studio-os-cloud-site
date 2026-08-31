"use client";

import Link from "next/link";
import { Menu, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/sample-galleries", label: "Sample Galleries" },
  { href: "/online-school-photography-booking", label: "Online Booking" },
  { href: "/studio-os", label: "Studio OS" },
  { href: "/mobile-app", label: "Mobile App" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-white/95 pt-[env(safe-area-inset-top)] text-neutral-950 backdrop-blur-xl transition duration-300 ${
        isScrolled
          ? "border-neutral-200 shadow-[0_14px_45px_rgba(0,0,0,0.08)]"
          : "border-neutral-100"
      }`}
    >
      <div className="mx-auto flex h-[92px] max-w-7xl items-center justify-between gap-4 px-4 sm:h-[112px] sm:px-6 lg:px-8">
        <Link
          href="/"
          className="relative z-10 -ml-2 flex h-[82px] w-[96px] items-center justify-center rounded-[6px] text-left transition hover:translate-y-[-1px] sm:h-[96px] sm:w-[118px]"
          aria-label="Studio OS Cloud home"
        >
          <Logo small />
        </Link>

        <nav className="relative z-10 hidden items-center gap-7 xl:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="marketing-caption relative font-medium text-neutral-600 transition hover:-translate-y-0.5 hover:text-neutral-950 after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-red-600 after:transition-all hover:after:w-full"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="relative z-10 hidden items-center gap-3 xl:flex">
          <Link
            href="/parents"
            rel="nofollow"
            data-marketing-event="cta_parents_portal"
            data-marketing-label="Header parents portal"
            data-marketing-placement="site_header"
            className="marketing-button premium-button inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2.5 text-neutral-950 shadow-[0_12px_35px_rgba(0,0,0,0.06)] transition hover:bg-white"
          >
            <UserRound className="h-4 w-4" />
            Parents Portal
          </Link>

          <Link
            href="/sign-in"
            data-marketing-event="cta_photographer_sign_in"
            data-marketing-label="Header photographer sign in"
            data-marketing-placement="site_header"
            className="marketing-caption whitespace-nowrap rounded-full px-4 py-2 font-medium text-neutral-600 transition hover:-translate-y-0.5 hover:bg-neutral-100 hover:text-neutral-950"
          >
            Photographer Sign In
          </Link>

          <Link
            href="/studio-os/download"
            data-marketing-event="cta_download_app"
            data-marketing-label="Header download app"
            data-marketing-placement="site_header"
            className="marketing-button premium-button inline-flex items-center justify-center rounded-full bg-neutral-950 px-5 py-3 text-white shadow-[0_16px_38px_rgba(0,0,0,0.18)] transition hover:bg-black"
          >
            Download App
          </Link>
        </div>

        <div className="relative z-10 xl:hidden">
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            aria-expanded={isOpen}
            aria-label="Toggle navigation"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-sm transition hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div
            className={`absolute right-0 mt-3 w-[min(82vw,320px)] rounded-2xl border border-neutral-200 bg-white p-3 text-neutral-950 shadow-2xl transition duration-200 ${
              isOpen
                ? "pointer-events-auto translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-2 opacity-0"
            }`}
          >
            <nav className="grid gap-1">
              {[
                ...navLinks,
                { href: "/parents", label: "Parents Portal" },
                { href: "/sign-in", label: "Photographer Sign In" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  {...(link.href === "/parents" ? { rel: "nofollow" } : {})}
                  className="marketing-caption rounded-xl px-3 py-2.5 font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/studio-os/download"
                onClick={() => setIsOpen(false)}
                data-marketing-event="cta_download_app"
                data-marketing-label="Mobile header download app"
                data-marketing-placement="mobile_header"
                className="marketing-button mt-2 rounded-xl bg-neutral-950 px-3 py-2.5 text-center text-white"
              >
                Download App
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
