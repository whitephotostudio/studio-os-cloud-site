import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up — Start Your Free Trial",
  description:
    "Create your Studio OS Cloud account and start a 30-day launch trial. Choose from Web Gallery, App, or Studio plans for your photography business.",
  alternates: {
    canonical: "https://www.studiooscloud.com/sign-up",
  },
  openGraph: {
    title: "Sign Up for Studio OS Cloud — Free Trial",
    description:
      "Start a 30-day launch trial of Studio OS Cloud, the connected photography workflow for school, event, and high-volume photographers.",
    url: "https://www.studiooscloud.com/sign-up",
  },
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
