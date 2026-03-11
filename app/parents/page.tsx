import { SiteHeader } from "../../components/site-header";
import { Logo } from "../../components/logo";

const schoolOptions = [
  "ARS Armenian School",
  "St. Mary School",
  "Westside Academy",
  "Holy Cross School",
];

export default function ParentsPage() {
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
              Parents Portal
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              Choose your school and enter your PIN to access your gallery.
            </p>
          </div>

          <form className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="school"
                className="mb-2 block text-sm font-medium text-neutral-700"
              >
                School
              </label>
              <select
                id="school"
                name="school"
                className="w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-neutral-300 text-neutral-800"
                defaultValue=""
              >
                <option value="" disabled>
                  Select your school
                </option>
                {schoolOptions.map((school) => (
                  <option key={school} value={school}>
                    {school}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="pin"
                className="mb-2 block text-sm font-medium text-neutral-700"
              >
                PIN
              </label>
              <input
                id="pin"
                name="pin"
                type="text"
                placeholder="Enter your access PIN"
                className="w-full rounded-2xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-2xl bg-black text-white px-4 py-3 font-medium hover:opacity-90 transition"
            >
              Open Gallery
            </button>
          </form>

          <div className="mt-5 rounded-2xl bg-neutral-50 border border-neutral-200 p-4 text-sm text-neutral-600 leading-7">
            Your school and PIN will connect you directly to your child’s gallery and available order options.
          </div>
        </div>
      </main>
    </div>
  );
}