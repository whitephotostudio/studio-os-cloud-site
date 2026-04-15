import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main className="pb-12 pt-2">{children}</main>
      <SiteFooter />
    </div>
  );
}
