import type { Metadata } from "next";
import { CalendarCheck2, Headphones, Mail, ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Contact, Support & Product Demo",
  description:
    "Contact Studio OS Cloud for product questions, photographer support, a guided demo, or security and privacy concerns.",
  alternates: { canonical: "https://www.studiooscloud.com/contact" },
};

const contacts = [
  {
    title: "Book a product demo",
    text: "Tell us what kind of photography you run and which workflow you want to see.",
    href: "mailto:galleries@studiooscloud.com?subject=Studio%20OS%20Cloud%20Demo%20Request",
    action: "Request a demo",
    icon: CalendarCheck2,
  },
  {
    title: "Photographer support",
    text: "Get help with account access, galleries, booking, the Studio OS app, or production workflow.",
    href: "mailto:galleries@studiooscloud.com?subject=Studio%20OS%20Cloud%20Support",
    action: "Email support",
    icon: Headphones,
  },
  {
    title: "Security or privacy",
    text: "Report a concern without including passwords, codes, photos, or other sensitive data in the first message.",
    href: "mailto:galleries@studiooscloud.com?subject=Studio%20OS%20Security%20Concern",
    action: "Contact security",
    icon: ShieldCheck,
  },
];

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main>
        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-5xl text-center">
            <Mail className="mx-auto h-8 w-8 text-red-400" />
            <p className="marketing-kicker mt-5 text-red-300">Contact</p>
            <h1 className="marketing-display mt-5">Questions, support, or a guided demo.</h1>
            <p className="marketing-body mx-auto mt-6 max-w-3xl text-white/68">
              Choose the reason for your message so it reaches the right conversation quickly.
            </p>
          </div>
        </section>
        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
            {contacts.map((item) => (
              <article key={item.title} className="flex flex-col rounded-[1.5rem] border border-neutral-200 bg-white p-7 shadow-sm">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                  <item.icon className="h-5 w-5" />
                </span>
                <h2 className="marketing-card-title mt-5">{item.title}</h2>
                <p className="marketing-caption mt-3 flex-1 text-neutral-600">{item.text}</p>
                <a href={item.href} className="marketing-button mt-7 inline-flex items-center justify-center rounded-full bg-neutral-950 px-5 py-3 text-white transition hover:bg-black">
                  {item.action}
                </a>
              </article>
            ))}
          </div>
          <p className="marketing-caption mx-auto mt-8 max-w-3xl text-center text-neutral-500">
            General email: <a className="font-semibold text-neutral-950 underline underline-offset-4" href="mailto:galleries@studiooscloud.com">galleries@studiooscloud.com</a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
