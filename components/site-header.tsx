import Link from "next/link";
import { UserRound } from "lucide-react";
import { Logo } from "./logo";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/studio-os", label: "Studio OS" },
  { href: "/parents", label: "Parents" },
  { href: "/preview", label: "Preview" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[96px] max-w-7xl items-center justify-between gap-4 px-4 pt-[4px] sm:px-6 lg:px-8">
        <Link href="/" className="text-left">
          <Logo small />
        </Link>

        <nav className="hidden md:flex items-center gap-6">
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

        <div className="hidden sm:flex items-center gap-3">
          <Link
            href="/parents"
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
          >
            <UserRound className="h-4 w-4" />
            Parents Portal
          </Link>

          <Link
            href="/sign-in"
            className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
          >
            Photographer Sign In
          </Link>

          <Link
            href="/preview"
            className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
          >
            Platform Demo
          </Link>
        </div>
      </div>
    </header>
  );
}