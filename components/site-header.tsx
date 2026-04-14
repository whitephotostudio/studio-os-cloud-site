import Link from "next/link";
import { UserRound } from "lucide-react";
import { Logo } from "./logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/studio-os", label: "Studio OS" },
  { href: "/studio-os/download", label: "Download App" },
  { href: "/pricing", label: "Pricing" },
  { href: "/parents", label: "Parents" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[96px] max-w-7xl items-center justify-between gap-4 px-4 pt-[4px] sm:px-6 lg:px-8">
        <Link href="/" className="text-left">
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
      </div>
    </header>
  );
}
