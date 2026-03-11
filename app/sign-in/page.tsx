import { SiteHeader } from "../../components/site-header";
import { Logo } from "../../components/logo";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />

      <main className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 py-10 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.08),transparent_24%)]">
        <div className="w-full max-w-md rounded-[32px] border border-neutral-200 bg-white p-8 shadow-2xl">
          <div className="flex justify-center">
            <Logo />
          </div>

          <div className="mt-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
              Sign in to Studio OS Cloud
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              Manage your cloud account, galleries, and studio workflow.
            </p>
          </div>

          <form className="mt-8 space-y-4">
            <input
              type="email"
              placeholder="Email address"
              className="w-full rounded-2xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full rounded-2xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <button
              type="submit"
              className="w-full rounded-2xl bg-black text-white px-4 py-3 font-medium hover:opacity-90 transition"
            >
              Sign In
            </button>
          </form>

          <div className="mt-8 rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-sm text-neutral-600">
            <div className="font-medium text-neutral-900">New to Studio OS?</div>
            <p className="mt-2 leading-7">
              Create your account and choose a plan on the Studio OS Cloud website, then return to sign in and connect your workflow.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <button className="flex-1 rounded-xl bg-black text-white px-4 py-2.5 font-medium">
                Create Account
              </button>
              <button className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-800">
                View Pricing
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}