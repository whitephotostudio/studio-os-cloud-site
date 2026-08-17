export type CloudFlowStatus = "healthy" | "warning" | "critical" | "manual";

export type CloudFlowCategory =
  | "customer-flow"
  | "infrastructure"
  | "security-recovery";

export type CloudFlowCard = {
  id: string;
  title: string;
  category: CloudFlowCategory;
  status: CloudFlowStatus;
  summary: string;
  detail: string;
  metric: string;
  metricLabel: string;
  lastActivity: string | null;
  checkedAt: string;
  href?: string;
};

export type CloudFlowSummary = {
  status: Exclude<CloudFlowStatus, "manual">;
  message: string;
  healthy: number;
  warning: number;
  critical: number;
  manual: number;
  automated: number;
};

export type CloudFlowReport = {
  ok: true;
  checkedAt: string;
  environment: string;
  deployment: string | null;
  summary: CloudFlowSummary;
  cards: CloudFlowCard[];
  founding100: Founding100Report;
};

export type Founding100Report = {
  goal: 100;
  startedAt: string;
  visitors: number;
  trialClicks: number;
  demoClicks: number;
  registrations: number;
  activeTrials: number;
  activated: number;
  paid: number;
  progressPercent: number;
  activationRate: number;
  trackingMode: "persistent" | "recent-activity";
};

export function summarizeCloudFlow(cards: CloudFlowCard[]): CloudFlowSummary {
  const healthy = cards.filter((card) => card.status === "healthy").length;
  const warning = cards.filter((card) => card.status === "warning").length;
  const critical = cards.filter((card) => card.status === "critical").length;
  const manual = cards.filter((card) => card.status === "manual").length;
  const automated = healthy + warning + critical;

  if (critical > 0) {
    return {
      status: "critical",
      message: `${critical} system${critical === 1 ? " needs" : "s need"} attention.`,
      healthy,
      warning,
      critical,
      manual,
      automated,
    };
  }

  if (warning > 0) {
    return {
      status: "warning",
      message: `Core systems are flowing; ${warning} item${warning === 1 ? " needs" : "s need"} review.`,
      healthy,
      warning,
      critical,
      manual,
      automated,
    };
  }

  return {
    status: "healthy",
    message: "All monitored systems are flowing normally.",
    healthy,
    warning,
    critical,
    manual,
    automated,
  };
}

export function ageInMilliseconds(value: string | null | undefined, now = Date.now()) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, now - parsed);
}
