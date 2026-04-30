import Link from "next/link";
import { Logo } from "./logo";

const footerLinks = [
  { href: "/", label: "Home" },
  { href: "/studio-os", label: "Studio OS" },
  { href: "/studio-os/download", label: "Download App" },
  { href: "/pricing", label: "Pricing" },
  { href: "/parents", label: "Parents Portal" },
  { href: "/sign-in", label: "Photographer Sign In" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-white text-neutral-950">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
        <div>
          <Logo small />
          <p className="marketing-caption mt-5 max-w-md text-neutral-500">
            Premium galleries, private ordering, and connected production tools for
            modern photography businesses.
          </p>
        </div>

        <nav className="marketing-caption grid gap-3 font-medium text-neutral-600 sm:grid-cols-2 lg:text-right">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-neutral-950">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="marketing-caption mx-auto max-w-7xl border-t border-neutral-200 px-4 py-6 text-neutral-500 sm:px-6 lg:px-8">
        © 2026 Studio OS Cloud. All rights reserved.
      </div>
    </footer>
  );
}
