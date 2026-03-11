import { SiteHeader } from "../components/site-header";
import { Hero } from "../components/hero";
import { SiteFooter } from "../components/site-footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
      </main>
      <SiteFooter />
    </div>
  );
}