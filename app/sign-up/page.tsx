"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { createClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const supabase = createClient();

  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_name: businessName,
        },
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setMessage("Account created. Check your email to confirm your account.");
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto flex max-w-7xl px-6 py-20">
        <div className="grid w-full gap-12 lg:grid-cols-2">
          <div className="flex flex-col justify-center">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Photographer Registration
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-neutral-950 md:text-5xl">
              Create your Studio OS Cloud account
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-600">
              Start building your photographer portal, school galleries, and connected
              online workflow.
            </p>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
                Create account
              </h2>
              <p className="mt-2 text-sm text-neutral-500">
                Set up your photographer login.
              </p>

              <form onSubmit={handleSignUp} className="mt-8 space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                    placeholder="Your full name"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">
                    Business Name
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                    placeholder="WhitePhoto"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-neutral-700">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none transition focus:border-black"
                    placeholder="Create a password"
                  />
                </div>

                {message ? (
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                    {message}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Creating account..." : "Create Account"}
                </button>
              </form>

              <div className="mt-6 text-sm text-neutral-600">
                Already have an account?{" "}
                <Link href="/sign-in" className="font-medium text-black underline underline-offset-4">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}