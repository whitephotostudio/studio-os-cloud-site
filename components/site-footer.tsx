import Link from "next/link";
import { Logo } from "./logo";

const productLinks = [
  { href: "/studio-os", label: "Studio OS App" },
  { href: "/mobile-app", label: "Mobile App" },
  { href: "/studio-os/download", label: "Download" },
  { href: "/sample-galleries", label: "Sample Galleries" },
  { href: "/pricing", label: "Pricing" },
  { href: "/sign-up", label: "Sign Up" },
];

const solutionsLinks = [
  { href: "/photography-workflow-software", label: "Photography Workflow Software" },
  { href: "/online-photo-gallery-ordering-software", label: "Online Gallery & Ordering" },
  { href: "/online-school-photography-booking", label: "Online School Booking" },
  { href: "/school-photography-software", label: "School Photography Software" },
  { href: "/high-volume-photography-software", label: "High Volume Photography" },
  { href: "/pixieset-alternative", label: "Pixieset Alternative" },
  { href: "/gotphoto-alternative", label: "GotPhoto Alternative" },
];

const compareLinks = [
  { href: "/compare/studio-os-vs-pixieset", label: "vs Pixieset" },
  { href: "/compare/studio-os-vs-gotphoto", label: "vs GotPhoto" },
  { href: "/compare/studio-os-vs-photoday", label: "vs PhotoDay" },
  { href: "/compare/studio-os-vs-shootproof", label: "vs ShootProof" },
  { href: "/compare/studio-os-vs-smugmug", label: "vs SmugMug" },
  { href: "/compare/studio-os-vs-zenfolio", label: "vs Zenfolio" },
  { href: "/compare/studio-os-vs-zno", label: "vs Zno" },
];

const resourceLinks = [
  { href: "/sign-in", label: "Photographer Sign In" },
  { href: "https://www.youtube.com/channel/UC2Ou4lxHAD9BrYq9qa303_Q", label: "YouTube" },
];

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact & Demo" },
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-responsibility-agreement", label: "Data Responsibility" },
];

type FooterLink = { href: string; label: string };

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: FooterLink[];
}) {
  return (
    <div>
      <h2 className="marketing-caption text-xs font-semibold uppercase tracking-wider text-neutral-950">
        {heading}
      </h2>
      <ul className="marketing-caption mt-4 space-y-2 font-medium text-neutral-600">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="transition hover:text-neutral-950"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-white text-neutral-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.35fr_repeat(5,1fr)]">
          <div>
            <Logo small />
            <p className="marketing-caption mt-5 max-w-md text-neutral-500">
              Premium galleries, private ordering, and connected production tools for
              modern photography businesses.
            </p>
            <p className="marketing-caption mt-6 text-neutral-500">
              <Link
                href="/parents"
                rel="nofollow"
                className="font-medium text-neutral-700 transition hover:text-neutral-950"
              >
                Parents Portal →
              </Link>
            </p>
          </div>
          <FooterColumn heading="Product" links={productLinks} />
          <FooterColumn heading="Solutions" links={solutionsLinks} />
          <FooterColumn heading="Compare" links={compareLinks} />
          <FooterColumn heading="Resources" links={resourceLinks} />
          <FooterColumn heading="Company" links={companyLinks} />
        </div>
      </div>
      <div className="marketing-caption mx-auto max-w-7xl border-t border-neutral-200 px-4 py-6 text-neutral-500 sm:px-6 lg:px-8">
        © 2026 Studio OS Cloud. All rights reserved.
      </div>
    </footer>
  );
}
