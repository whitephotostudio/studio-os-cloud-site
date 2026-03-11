import {
  Cloud,
  CreditCard,
  Image as ImageIcon,
  LayoutDashboard,
  School,
  Shield,
  Users,
} from "lucide-react";
import { SiteHeader } from "../../components/site-header";
import { Logo } from "../../components/logo";

const orders = [
  { school: "ARS Armenian School", type: "Graduation", count: 42, status: "Ready for review" },
  { school: "St. Mary School", type: "Spring Photos", count: 18, status: "Awaiting fulfillment" },
  { school: "Westside Academy", type: "Staff Portraits", count: 9, status: "Synced" },
];

const sidebarItems = [
  { icon: LayoutDashboard, label: "Overview" },
  { icon: School, label: "Schools" },
  { icon: Users, label: "Students" },
  { icon: ImageIcon, label: "Galleries" },
  { icon: CreditCard, label: "Orders" },
  { icon: Cloud, label: "Sync Status" },
  { icon: Shield, label: "Account" },
];

const stats = [
  { label: "Active Schools", value: "12" },
  { label: "Live Galleries", value: "84" },
  { label: "New Orders", value: "27" },
  { label: "Sync Health", value: "98%" },
];

const onboardingSteps = [
  "Create account on Studio OS Cloud",
  "Choose a subscription plan",
  "Connect studio settings and packages",
  "Sign in through the app and sync",
];

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <div className="mb-6">
          <div className="text-sm text-neutral-500">Preview mode</div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
            Studio OS Cloud Dashboard
          </h1>
        </div>

        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <aside className="rounded-[28px] border border-neutral-200 bg-white p-4 shadow-sm h-fit">
            <div className="pb-4 border-b border-neutral-200">
              <Logo small />
            </div>

            <div className="mt-4 space-y-2">
              {sidebarItems.map(({ icon: Icon, label }, i) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl ${
                    i === 0 ? "bg-black text-white" : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{label}</span>
                </div>
              ))}
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-[24px] border border-neutral-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-sm font-semibold text-neutral-900">Dashboard preview</div>
              <div className="text-xs text-neutral-500">
                A clearer look at the photographer experience
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              {stats.map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm"
                >
                  <div className="text-sm text-neutral-500">{label}</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
              <div className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-950">Recent order flow</h2>
                    <p className="text-sm text-neutral-500 mt-1">
                      A cleaner production pipeline for cloud-connected jobs
                    </p>
                  </div>
                  <button className="text-sm font-medium text-neutral-700">View all</button>
                </div>

                <div className="mt-5 space-y-3">
                  {orders.map((order) => (
                    <div
                      key={`${order.school}-${order.type}`}
                      className="rounded-2xl border border-neutral-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-semibold text-neutral-900">{order.school}</div>
                          <div className="text-sm text-neutral-500 mt-1">{order.type}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-neutral-950">
                            {order.count}
                          </div>
                          <div className="text-xs text-neutral-500">orders</div>
                        </div>
                      </div>

                      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        {order.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-neutral-950">
                    Photographer onboarding
                  </h2>
                  <p className="mt-1 text-sm text-neutral-500">
                    How new studios enter the ecosystem
                  </p>

                  <div className="mt-5 space-y-3">
                    {onboardingSteps.map((step, i) => (
                      <div key={step} className="flex items-start gap-3 text-sm text-neutral-700">
                        <div className="w-7 h-7 rounded-xl bg-black text-white flex items-center justify-center text-xs font-semibold">
                          {i + 1}
                        </div>
                        <div className="pt-1">{step}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-neutral-200 bg-gradient-to-br from-black to-neutral-800 text-white p-6 shadow-xl">
                  <div className="text-sm text-neutral-300">Future direction</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">
                    AI retouch and smart production tools
                  </div>
                  <p className="mt-3 text-sm text-neutral-300 leading-7">
                    Space for premium add-ons like retouch credits, background tools, advanced
                    gallery customization, and deeper cloud-to-production syncing.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}