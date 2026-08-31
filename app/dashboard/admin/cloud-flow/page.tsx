"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BadgeDollarSign,
  BellRing,
  CalendarCheck,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  Headphones,
  Laptop,
  LockKeyhole,
  MousePointerClick,
  PackageCheck,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  UserPlus,
  UsersRound,
  WalletCards,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  CloudFlowCard,
  CloudFlowCategory,
  CloudFlowReport,
  CloudFlowStatus,
} from "@/lib/cloud-flow";
import styles from "./cloud-flow.module.css";

type ErrorPayload = { ok?: false; message?: string };

const CATEGORY_COPY: Record<
  CloudFlowCategory,
  { title: string; description: string }
> = {
  "customer-flow": {
    title: "Customer flow",
    description: "Bookings, payments, orders, downloads, and the desktop handoff.",
  },
  infrastructure: {
    title: "Cloud systems",
    description: "The services that keep Studio OS Cloud online and moving.",
  },
  "security-recovery": {
    title: "Security & recovery",
    description: "Owner protection and the recovery checks that need human confirmation.",
  },
};

const CARD_ICONS: Record<string, LucideIcon> = {
  "public-website": Wifi,
  "cloud-database": Database,
  "online-booking": CalendarCheck,
  "online-payments": WalletCards,
  "customer-orders": ShoppingBag,
  "gallery-downloads": Download,
  "private-storage": Cloud,
  "desktop-sync": Laptop,
  "site-traffic": Activity,
  "owner-alerts": BellRing,
  "account-security": ShieldCheck,
  backups: HardDrive,
};

function relativeTime(value: string | null, now: number) {
  if (!value) return "No activity recorded";
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "Time unavailable";
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function exactTime(value: string | null) {
  if (!value) return "No activity recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return parsed.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: CloudFlowStatus) {
  if (status === "healthy") return "Flowing";
  if (status === "warning") return "Review";
  if (status === "critical") return "Attention";
  return "Manual check";
}

function StatusIcon({ status }: { status: CloudFlowStatus }) {
  if (status === "healthy") return <Check size={15} strokeWidth={3} />;
  if (status === "warning") return <AlertTriangle size={15} strokeWidth={2.5} />;
  if (status === "critical") return <XCircle size={15} strokeWidth={2.5} />;
  return <CircleHelp size={15} strokeWidth={2.5} />;
}

function FlowCardView({ card, now }: { card: CloudFlowCard; now: number }) {
  const Icon = CARD_ICONS[card.id] ?? Server;
  const content = (
    <article className={`${styles.card} ${styles[`card_${card.status}`]}`}>
      <div className={styles.cardTop}>
        <span className={`${styles.iconBox} ${styles[`icon_${card.status}`]}`}>
          <Icon size={21} strokeWidth={2.15} />
        </span>
        <span className={`${styles.statusPill} ${styles[`status_${card.status}`]}`}>
          <StatusIcon status={card.status} />
          {statusLabel(card.status)}
        </span>
      </div>

      <h3>{card.title}</h3>
      <p className={styles.summary}>{card.summary}</p>

      <div className={styles.metricBlock}>
        <strong>{card.metric}</strong>
        <span>{card.metricLabel}</span>
      </div>

      <p className={styles.detail}>{card.detail}</p>

      <div className={styles.cardFooter}>
        <span title={exactTime(card.lastActivity)}>
          Last evidence: {relativeTime(card.lastActivity, now)}
        </span>
        {card.href ? <ChevronRight size={17} aria-hidden="true" /> : null}
      </div>
    </article>
  );

  if (!card.href) return content;
  return (
    <Link href={card.href} className={styles.cardLink}>
      {content}
    </Link>
  );
}

function LoadingView() {
  return (
    <div className={styles.loadingGrid} aria-label="Loading Cloud Flow checks">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className={styles.skeletonCard} key={index}>
          <div className={styles.skeletonLineSmall} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLineWide} />
          <div className={styles.skeletonMetric} />
        </div>
      ))}
    </div>
  );
}

function Founding100Panel({
  campaign,
}: {
  campaign: CloudFlowReport["founding100"];
}) {
  const metrics = [
    { label: "Landing visitors", value: campaign.visitors, icon: UsersRound },
    { label: "Trial interest", value: campaign.trialClicks, icon: MousePointerClick },
    { label: "Demo interest", value: campaign.demoClicks, icon: Headphones },
    { label: "Accounts created", value: campaign.registrations, icon: UserPlus },
    { label: "Activated", value: campaign.activated, icon: UserCheck },
    { label: "Paid", value: campaign.paid, icon: BadgeDollarSign },
  ];

  return (
    <section className={styles.campaignPanel} aria-labelledby="founding-100-title">
      <div className={styles.campaignHeader}>
        <div>
          <div className={styles.campaignEyebrow}>
            <Rocket size={16} /> Growth campaign
          </div>
          <h2 id="founding-100-title">Founding 100 activation</h2>
          <p>
            A photographer is activated after creating a school or project, or
            connecting a Studio OS desktop device.
          </p>
        </div>
        <div className={styles.campaignGoal}>
          <strong>{campaign.activated}</strong>
          <span>/ {campaign.goal} activated</span>
        </div>
      </div>

      <div className={styles.campaignProgress} aria-label={`${campaign.progressPercent}% of activation goal`}>
        <span style={{ width: `${campaign.progressPercent}%` }} />
      </div>

      <div className={styles.campaignMetrics}>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <metric.icon size={17} />
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.campaignFooter}>
        <div>
          <span>{campaign.activeTrials} active trials</span>
          <span>{campaign.activationRate}% account-to-activation rate</span>
          <span>
            {campaign.trackingMode === "persistent"
              ? "Persistent campaign tracking"
              : "Recent activity fallback"}
          </span>
        </div>
        <Link href="/founding-100">
          Open campaign page <ArrowUpRight size={15} />
        </Link>
      </div>
    </section>
  );
}

export default function CloudFlowPage() {
  const supabase = useMemo(() => createClient(), []);
  const [report, setReport] = useState<CloudFlowReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      else if (!report) setLoading(true);
      setError("");
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const response = await fetch("/api/dashboard/admin/cloud-flow", {
          cache: "no-store",
          credentials: "include",
          headers,
        });
        const payload = (await response.json().catch(() => ({}))) as
          | CloudFlowReport
          | ErrorPayload;
        if (response.status === 401) {
          window.location.href = `/sign-in?redirect=${encodeURIComponent("/dashboard/admin/cloud-flow")}`;
          return;
        }
        if (response.status === 403) {
          window.location.href = "/dashboard";
          return;
        }
        if (!response.ok || payload.ok !== true) {
          throw new Error((payload as ErrorPayload).message || "Cloud Flow could not load.");
        }
        setReport(payload as CloudFlowReport);
        setNow(Date.now());
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Cloud Flow could not load. No data was changed.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [report, supabase],
  );

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const refresh = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [load]);

  const groups = useMemo(() => {
    const source = report?.cards ?? [];
    return (Object.keys(CATEGORY_COPY) as CloudFlowCategory[]).map((category) => ({
      category,
      cards: source.filter((card) => card.category === category),
    }));
  }, [report]);

  const overall = report?.summary.status ?? "healthy";

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topRow}>
          <Link href="/dashboard" className={styles.backLink}>
            <ArrowLeft size={16} /> Dashboard
          </Link>
          <div className={styles.ownerOnly}>
            <LockKeyhole size={14} /> Owner only
          </div>
        </div>

        <section className={`${styles.hero} ${styles[`hero_${overall}`]}`}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <Cloud size={17} /> Studio OS Cloud Flow
            </div>
            <h1>See everything moving.<br />Know everything is working.</h1>
            <p>
              A private, read-only view of the systems that carry a customer from
              booking to payment, photography, ordering, and download.
            </p>
          </div>

          <div className={styles.heroStatus}>
            {loading && !report ? (
              <div className={styles.heroLoading}>
                <RefreshCw size={30} className={styles.spin} />
                <strong>Checking every flow…</strong>
              </div>
            ) : report ? (
              <>
                <div className={`${styles.overallOrb} ${styles[`orb_${overall}`]}`}>
                  {overall === "healthy" ? (
                    <Check size={34} strokeWidth={3} />
                  ) : overall === "warning" ? (
                    <AlertTriangle size={32} />
                  ) : (
                    <XCircle size={32} />
                  )}
                </div>
                <div>
                  <span className={styles.overallLabel}>Overall flow</span>
                  <strong className={styles.overallTitle}>
                    {overall === "healthy"
                      ? "Everything is flowing"
                      : overall === "warning"
                        ? "Flowing with a review"
                        : "Attention needed"}
                  </strong>
                  <p>{report.summary.message}</p>
                </div>
              </>
            ) : null}
          </div>
        </section>

        {report ? (
          <section className={styles.pulsePanel} aria-label="Cloud Flow summary">
            <div className={styles.pulseStats}>
              <div>
                <strong>{report.summary.healthy}</strong>
                <span>Flowing</span>
              </div>
              <div>
                <strong>{report.summary.warning}</strong>
                <span>Review</span>
              </div>
              <div>
                <strong>{report.summary.critical}</strong>
                <span>Attention</span>
              </div>
              <div>
                <strong>{report.summary.manual}</strong>
                <span>Manual</span>
              </div>
            </div>
            <div className={styles.flowBar} aria-hidden="true">
              {report.summary.healthy > 0 ? (
                <span
                  className={styles.flowHealthy}
                  style={{ flex: report.summary.healthy }}
                />
              ) : null}
              {report.summary.warning > 0 ? (
                <span
                  className={styles.flowWarning}
                  style={{ flex: report.summary.warning }}
                />
              ) : null}
              {report.summary.critical > 0 ? (
                <span
                  className={styles.flowCritical}
                  style={{ flex: report.summary.critical }}
                />
              ) : null}
              {report.summary.manual > 0 ? (
                <span className={styles.flowManual} style={{ flex: report.summary.manual }} />
              ) : null}
            </div>
            <div className={styles.refreshRow}>
              <div>
                <span>Last full check</span>
                <strong title={exactTime(report.checkedAt)}>
                  {relativeTime(report.checkedAt, now)}
                </strong>
                <small>
                  {report.environment}
                  {report.deployment ? ` · build ${report.deployment}` : ""}
                </small>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing}
                className={styles.refreshButton}
              >
                <RefreshCw size={16} className={refreshing ? styles.spin : undefined} />
                {refreshing ? "Checking…" : "Check everything now"}
              </button>
            </div>
          </section>
        ) : null}

        {report ? <Founding100Panel campaign={report.founding100} /> : null}

        {error ? (
          <div className={styles.errorBox} role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>Cloud Flow could not finish its checks.</strong>
              <span>{error} No customer data was changed.</span>
            </div>
            <button type="button" onClick={() => void load(true)}>
              Try again
            </button>
          </div>
        ) : null}

        {loading && !report ? <LoadingView /> : null}

        {report
          ? groups.map(({ category, cards }) => (
              <section className={styles.group} key={category}>
                <div className={styles.groupHeader}>
                  <div>
                    <h2>{CATEGORY_COPY[category].title}</h2>
                    <p>{CATEGORY_COPY[category].description}</p>
                  </div>
                  <span>
                    {cards.filter((item) => item.status === "healthy").length}/{cards.length}{" "}
                    flowing
                  </span>
                </div>
                <div className={styles.cardGrid}>
                  {cards.map((item) => (
                    <FlowCardView card={item} now={now} key={item.id} />
                  ))}
                </div>
              </section>
            ))
          : null}

        <section className={styles.truthPanel}>
          <div className={styles.truthIcon}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <h2>Green means we have evidence.</h2>
            <p>
              Cloud Flow performs read-only checks. It never creates a booking,
              charges a card, downloads a student photo, changes an order, or exposes
              private customer information. A quiet day is shown as “no recent
              activity,” not as a failure.
            </p>
          </div>
          <Link href="/dashboard/admin/notifications">
            Open activity report <ExternalLink size={15} />
          </Link>
        </section>

        <footer className={styles.footer}>
          <PackageCheck size={16} />
          Studio OS Cloud Flow · owner operations console
        </footer>
      </div>
    </main>
  );
}
