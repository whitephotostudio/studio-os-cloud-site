import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing for Galleries, Online Booking & Workflow",
  description:
    "Compare Studio OS Cloud plans in CAD, USD, AUD, and GBP for businesses in Canada, the US, Australia, and the UK, with premium galleries and connected photography workflow.",
  alternates: {
    canonical: "https://www.studiooscloud.com/pricing",
  },
  openGraph: {
    title: "Studio OS Cloud Pricing",
    description:
      "Compare Studio OS Cloud plans for galleries, online booking, automatic student rosters, ordering, desktop workflow, and production control.",
    url: "https://www.studiooscloud.com/pricing",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
