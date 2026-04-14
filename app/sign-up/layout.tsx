import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up — Start Your Free Trial",
  description:
    "Create your Studio OS Cloud account and start your free trial. Choose from Starter, Core, or Studio plans for your photography business.",
  alternates: {
    canonical: "https://studiooscloud.com/sign-up",
  },
  openGraph: {
    title: "Sign Up for Studio OS Cloud — Free Trial",
    description:
      "Start your free trial of Studio OS Cloud. The all-in-one photography workflow platform for school, event, and high-volume photographers.",
    url: "https://studiooscloud.com/sign-up",
  },
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
