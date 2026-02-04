export type UsageEvent = {
  id: string;
  event_ts: string;
  event_name: string;
  feature: string | null;
  action: string | null;
  success: boolean | null;
  user_id: string | null;
  session_id: string | null;
  anon_id: string | null;
  plan: string | null;
  subscription_status: string | null;
  billing_period: string | null;
  route: string | null;
  section: string | null;
  device_type: string | null;
  os: string | null;
  browser: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_page: string | null;
  properties: Record<string, unknown> | null;
};

export type DateRange = {
  start: string;
  end: string;
};

export type Filters = {
  plan: string;
  subscriptionStatus: string;
  billingPeriod: string;
  action: string;
  route: string;
  section: string;
  feature: string;
  eventName: string;
  deviceType: string;
  os: string;
  browser: string;
  referrer: string;
  landingPage: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
};

export const EMPTY_FILTER_VALUE = '__empty__';
export const LOVABLE_FILTER_VALUE = '__lovable__';

export type BarDatum = {
  label: string;
  value: number;
  key?: string;
  isFallback?: boolean;
  title?: string;
};

export type DailyDatum = {
  day: string;
  users: number;
  sessions: number;
  events: number;
};

// ============================================================================
// Terminal Events Types
// ============================================================================

export type TerminalEvent = {
  id: string;
  event_ts: string;
  event_name: string;
  feature: string | null;
  action: string | null;
  success: boolean | null;
  user_id: string | null;
  session_id: string | null;
  ticker: string | null;
  response_mode: string | null;
  duration_ms: number | null;
  token_count: number | null;
  phase: string | null;
  error_message: string | null;
  properties: Record<string, unknown> | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
};

export type TerminalFilters = {
  ticker: string;
  responseMode: string;
  eventName: string;
  phase: string;
  deviceType: string;
  browser: string;
  os: string;
};

export type TerminalDailyDatum = {
  day: string;
  messages: number;
  users: number;
  sessions: number;
};

export type TerminalStats = {
  totalMessages: number;
  uniqueUsers: number;
  uniqueTickers: number;
  uniqueSessions: number;
  avgDurationMs: number;
  successRate: number;
};

export type AgentPhaseStats = {
  planning: { avg: number; count: number };
  execution: { avg: number; count: number };
  answering: { avg: number; count: number };
};
