import { SiteHeader } from "../../components/site-header";

const studioSections = [
  {
    title: "Capture faster",
    text: "Keep photo day moving with tools designed to reduce confusion and speed up the workflow.",
  },
  {
    title: "Stay organized",
    text: "Manage jobs, folders, people, and production steps in one structured system.",
  },
  {
    title: "Produce with confidence",
    text: "Review, sort, prepare, and connect your work to cloud delivery without jumping between disconnected tools.",
  },
];

export default function StudioOSPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />

      <main className="min-h-[calc(100vh-72px)] px-4 py-10 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.08),transparent_24%)]">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <div className="text-sm text-neutral-500">Desktop app overview</div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-950">
              Studio OS
            </h1>
            <p className="mt-2 text-neutral-600 max-w-2xl leading-8">
              A desktop workflow designed to make photographers faster, more organized, and more confident from capture to delivery.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
            <div className="rounded-[32px] border border-neutral-200 bg-white shadow-xl overflow-hidden">
              <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-between bg-neutral-50">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">Studio OS desktop preview</div>
                  <div className="text-xs text-neutral-500">Screenshots and short workflow clips</div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-neutral-700 border border-neutral-200">
                  Demo clips
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="aspect-[16/9] rounded-[24px] border border-neutral-200 bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center">
                  <div className="text-center">
                    <div className="mt-4 text-sm font-semibold text-neutral-900">
                      Main Studio OS overview clip
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Short, clear product walkthrough
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  {["Capture screen", "Sort screen", "Orders screen"].map((label) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
                    >
                      <div className="aspect-[4/3] rounded-xl bg-white border border-neutral-200" />
                      <div className="mt-3 text-sm font-medium text-neutral-900">{label}</div>
                      <div className="mt-1 text-xs text-neutral-500">Screenshot preview</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-medium text-red-500">Why Studio OS</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950">
                  Short, sweet, and built around real photographer pain points.
                </h2>
                <p className="mt-3 text-neutral-600 leading-8">
                  This page explains how Studio OS reduces friction, keeps jobs organized, and makes production easier without overwhelming visitors with too much detail.
                </p>
              </div>

              {studioSections.map((section) => (
                <div
                  key={section.title}
                  className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm"
                >
                  <div className="text-lg font-semibold text-neutral-950">{section.title}</div>
                  <p className="mt-2 text-sm leading-7 text-neutral-600">{section.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}