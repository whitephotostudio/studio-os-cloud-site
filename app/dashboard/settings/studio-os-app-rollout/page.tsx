import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  KeyRound,
  Rocket,
  ShieldCheck,
  Upload,
} from "lucide-react";

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dde5f2",
  borderRadius: 28,
  padding: 24,
  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.05)",
};

const steps = [
  {
    icon: Upload,
    title: "1. Build the Flutter apps",
    text: "Create the real Mac and Windows installers from the Flutter codebase. When those builds are stable, upload the downloadable files to the secure location you want photographers to use.",
  },
  {
    icon: Download,
    title: "2. Paste the release links",
    text: "Open Dashboard Settings, find the Studio OS App Beta Access admin area, and paste the Mac and Windows download URLs along with the version number and release notes.",
  },
  {
    icon: ShieldCheck,
    title: "3. Choose the rollout state",
    text: "Use hidden to keep the rollout internal, beta to open it only for approved photographers, and public when every eligible paid account should be able to download the app.",
  },
  {
    icon: KeyRound,
    title: "4. Let Photography Keys handle activation",
    text: "Eligible plans automatically receive the correct number of Photography Keys. The Flutter app activates against the website, and each key is intended for one device at a time.",
  },
  {
    icon: Rocket,
    title: "5. Publish when you are ready",
    text: "Once the build, links, and release notes are ready, switch to public. App Plan gets 1 key, Studio gets 2 keys, and only Studio can add extra keys for $55 each.",
  },
];

export default function StudioOsAppRolloutGuidePage() {
  return (
    <div style={{ background: "#eef3fa", minHeight: "100vh", padding: "32px 28px 60px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <Link
          href="/dashboard/settings"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 20,
            border: "1px solid #d6dfef",
            borderRadius: 18,
            background: "#fff",
            padding: "12px 18px",
            fontWeight: 800,
            color: "#0f172a",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={18} /> Back to Settings
        </Link>

        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Internal rollout guide
          </div>
          <h1
            style={{
              marginTop: 10,
              fontSize: 44,
              lineHeight: 1.06,
              fontWeight: 900,
              color: "#0f172a",
            }}
          >
            Studio OS App beta rollout
          </h1>
          <p
            style={{
              marginTop: 12,
              maxWidth: 900,
              fontSize: 18,
              lineHeight: 1.75,
              color: "#64748b",
            }}
          >
            This page explains how Flutter builds become real downloadable Studio OS App releases,
            how beta access works, and how Photography Keys stay aligned with plan entitlements.
          </p>
        </div>

        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
            Plan rules that the rollout must respect
          </div>
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gap: 12,
              color: "#334155",
              lineHeight: 1.8,
              fontSize: 16,
            }}
          >
            <div>
              <strong>$49 Web Gallery</strong> — no Studio OS App access and no Photography Keys.
            </div>
            <div>
              <strong>$99 App Plan</strong> — app eligible, includes 1 Photography Key, and must
              upgrade to Studio for a second key.
            </div>
            <div>
              <strong>$199 Studio</strong> — app eligible, includes 2 Photography Keys, and can add
              extra keys for $55 each.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.15fr 0.85fr" }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", marginBottom: 18 }}>
              Release workflow
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 20,
                      padding: "18px 18px 18px 20px",
                      background: "#fff",
                      display: "flex",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 14,
                        background: "#eff6ff",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={20} color="#2563eb" />
                    </div>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>
                        {step.title}
                      </div>
                      <div style={{ marginTop: 6, color: "#64748b", lineHeight: 1.75 }}>
                        {step.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gap: 20, alignSelf: "start" }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                Release states
              </div>
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {[
                  {
                    title: "Hidden",
                    text: "Keep the app out of normal circulation while you are still preparing build links, testing installers, or limiting access to internal accounts.",
                  },
                  {
                    title: "Beta",
                    text: "Show the app only to approved photographers who have beta access and an eligible paid plan.",
                  },
                  {
                    title: "Public",
                    text: "Open downloads to every eligible paid account according to plan-based app entitlement rules.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 18,
                      padding: "14px 16px",
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{item.title}</div>
                    <div style={{ marginTop: 6, color: "#64748b", lineHeight: 1.7 }}>
                      {item.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                What the Flutter app uses
              </div>
              <div style={{ marginTop: 14, display: "grid", gap: 10, color: "#334155", lineHeight: 1.8 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 4 }} />
                  Activation endpoint for first-time key use on a device
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 4 }} />
                  Validation endpoint to confirm the key still has access
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 4 }} />
                  Dashboard-configured release metadata for version, notes, and download URLs
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 4 }} />
                  Plan-based key counts, including Studio-only extra keys
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
