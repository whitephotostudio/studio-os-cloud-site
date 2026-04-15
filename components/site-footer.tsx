import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="bg-white">
      <div className="mx-auto max-w-7xl px-4 pb-[30px] pt-[80px] sm:px-6 lg:px-8">
        <div className="grid gap-8 border-b border-neutral-100 pb-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-950">
              Product
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li><Link href="/pricing" className="text-sm text-neutral-500 transition hover:text-neutral-950">Pricing</Link></li>
              <li><Link href="/studio-os" className="text-sm text-neutral-500 transition hover:text-neutral-950">Desktop App</Link></li>
              <li><Link href="/studio-os/download" className="text-sm text-neutral-500 transition hover:text-neutral-950">Download</Link></li>
              <li><Link href="/sign-up" className="text-sm text-neutral-500 transition hover:text-neutral-950">Start Free Trial</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-950">
              Solutions
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li><Link href="/school-photography-software" className="text-sm text-neutral-500 transition hover:text-neutral-950">School Photography Software</Link></li>
              <li><Link href="/high-volume-photography-software" className="text-sm text-neutral-500 transition hover:text-neutral-950">High Volume Photography</Link></li>
              <li><Link href="/photography-workflow-software" className="text-sm text-neutral-500 transition hover:text-neutral-950">Photography Workflow Software</Link></li>
              <li><Link href="/online-photo-gallery-ordering-software" className="text-sm text-neutral-500 transition hover:text-neutral-950">Gallery & Ordering Software</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-950">
              Compare
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li><Link href="/pixieset-alternative" className="text-sm text-neutral-500 transition hover:text-neutral-950">Pixieset Alternative</Link></li>
              <li><Link href="/gotphoto-alternative" className="text-sm text-neutral-500 transition hover:text-neutral-950">GotPhoto Alternative</Link></li>
              <li><Link href="/compare/studio-os-vs-shootproof" className="text-sm text-neutral-500 transition hover:text-neutral-950">vs ShootProof</Link></li>
              <li><Link href="/compare/studio-os-vs-smugmug" className="text-sm text-neutral-500 transition hover:text-neutral-950">vs SmugMug</Link></li>
              <li><Link href="/compare/studio-os-vs-zenfolio" className="text-sm text-neutral-500 transition hover:text-neutral-950">vs Zenfolio</Link></li>
              <li><Link href="/compare/studio-os-vs-photoday" className="text-sm text-neutral-500 transition hover:text-neutral-950">vs PhotoDay</Link></li>
              <li><Link href="/compare/studio-os-vs-zno" className="text-sm text-neutral-500 transition hover:text-neutral-950">vs ZNO</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-950">
              Company
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li><Link href="/sign-in" className="text-sm text-neutral-500 transition hover:text-neutral-950">Sign In</Link></li>
            </ul>
          </div>
        </div>
        <div className="pt-6 text-center text-xs text-neutral-500">
          © 2026 Studio OS Cloud. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
