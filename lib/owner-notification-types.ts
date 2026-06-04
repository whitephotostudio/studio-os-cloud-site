export type OwnerNotificationSettings = {
  activityTrackingEnabled: boolean;
  alertOnNewRegistration: boolean;
  alertOnNewSubscription: boolean;
  alertOnPaymentFailed: boolean;
  alertOnSubscriptionCanceled: boolean;
  alertOnHighIntentVisit: boolean;
  alertOnEverySiteVisit: boolean;
  alertOnMarketingClick: boolean;
  visitAlertCooldownMinutes: number;
};

export type OwnerNotificationSettingKey = keyof OwnerNotificationSettings;

export const DEFAULT_OWNER_NOTIFICATION_SETTINGS: OwnerNotificationSettings = {
  activityTrackingEnabled: true,
  alertOnNewRegistration: true,
  alertOnNewSubscription: true,
  alertOnPaymentFailed: true,
  alertOnSubscriptionCanceled: true,
  alertOnHighIntentVisit: false,
  alertOnEverySiteVisit: false,
  alertOnMarketingClick: false,
  visitAlertCooldownMinutes: 30,
};

export type OwnerActivityType = "page_view" | "marketing_click";

export type OwnerActivity = {
  id: string;
  type: OwnerActivityType;
  event: string | null;
  path: string;
  label: string | null;
  placement: string | null;
  href: string | null;
  referrer: string | null;
  anonymousId: string | null;
  userAgentSummary: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isHighIntent: boolean;
  receivedAt: string;
};

export type OwnerActivityReport = {
  activities: OwnerActivity[];
  totals: {
    last24Hours: number;
    pageViewsLast24Hours: number;
    marketingClicksLast24Hours: number;
    highIntentLast24Hours: number;
  };
  topPages: Array<{ path: string; count: number }>;
};
