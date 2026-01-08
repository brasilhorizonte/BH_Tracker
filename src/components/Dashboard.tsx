import { useEffect, useMemo, useRef, useState } from 'react';
import { useUsageEvents } from '../hooks/useUsageEvents';
import {
  buildBarList,
  buildDistinctUserBarList,
  computeSessionStats,
  computeSuccessRate,
  distinctCount,
  extractNumericProperty,
  extractTopProperty,
  filterByDateRange,
} from '../lib/metrics';
import type { BarDatum, DateRange, Filters, UsageEvent } from '../types';

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const formatPercent = (value: number | null) =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
};

const formatTimestamp = (value: Date | null) => {
  if (!value) return 'Not updated yet';
  return value.toLocaleString();
};

const getDefaultRange = (): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const toKey = (date: Date) => date.toISOString().slice(0, 10);
  return { start: toKey(start), end: toKey(end) };
};

type DailyBucket = {
  day: string;
  events: number;
  users: Set<string>;
  sessions: Set<string>;
  successCount: number;
  successTotal: number;
  latencySum: number;
  latencyCount: number;
  contentEvents: number;
  aiEvents: number;
  paywallEvents: number;
  anonEvents: number;
  errorEvents: number;
};

type ExpandedChart = {
  title: string;
  subtitle?: string;
  series: { label: string; value: number }[];
  accent?: string;
};

const toDayKey = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const CONTENT_EVENT_NAMES = ['report_view', 'report_download', 'content_view', 'content_download'];
const AI_PRODUCT_DEFS = [
  { key: 'analysis_run', label: 'Analysis', accent: '#f4a259' },
  { key: 'validator_run', label: 'Validator', accent: '#5db7a5' },
  { key: 'qualitativo_run', label: 'Qualitativo', accent: '#f28f79' },
  { key: 'valuai_run', label: 'ValuAI', accent: '#f2c14e' },
];
const AI_PRODUCT_KEYS = new Set(AI_PRODUCT_DEFS.map((item) => item.key));
const LOGIN_EVENT_NAME = 'login';

const isLoginSuccess = (event: UsageEvent) =>
  event.event_name === LOGIN_EVENT_NAME && (event.action === 'success' || event.success === true);

const buildDailyBuckets = (events: UsageEvent[], range: DateRange): DailyBucket[] => {
  const contentEventNames = new Set(CONTENT_EVENT_NAMES);
  const aiEventNames = AI_PRODUCT_KEYS;
  const map = new Map<string, DailyBucket>();

  const ensureBucket = (day: string) => {
    if (!map.has(day)) {
      map.set(day, {
        day,
        events: 0,
        users: new Set(),
        sessions: new Set(),
        successCount: 0,
        successTotal: 0,
        latencySum: 0,
        latencyCount: 0,
        contentEvents: 0,
        aiEvents: 0,
        paywallEvents: 0,
        anonEvents: 0,
        errorEvents: 0,
      });
    }
    return map.get(day) as DailyBucket;
  };

  events.forEach((event) => {
    const time = new Date(event.event_ts);
    if (Number.isNaN(time.getTime())) return;
    const day = toDayKey(time);
    const bucket = ensureBucket(day);
    bucket.events += 1;
    if (event.user_id) bucket.users.add(event.user_id);
    if (event.session_id) bucket.sessions.add(event.session_id);
    if (event.success === true || event.success === false) {
      bucket.successTotal += 1;
      if (event.success) bucket.successCount += 1;
      if (!event.success) bucket.errorEvents += 1;
    }
    if (!event.user_id && event.anon_id) bucket.anonEvents += 1;
    if (contentEventNames.has(event.event_name)) bucket.contentEvents += 1;
    if (aiEventNames.has(event.event_name)) bucket.aiEvents += 1;
    if (event.event_name === 'paywall_block') bucket.paywallEvents += 1;
    const properties = event.properties as Record<string, unknown> | null;
    if (properties && typeof properties.latency_ms === 'number' && Number.isFinite(properties.latency_ms)) {
      bucket.latencySum += properties.latency_ms;
      bucket.latencyCount += 1;
    }
  });

  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return Array.from(map.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  const buckets: DailyBucket[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const day = toDayKey(cursor);
    buckets.push(map.get(day) ?? ensureBucket(day));
  }
  return buckets;
};

const buildSeries = (buckets: DailyBucket[], accessor: (bucket: DailyBucket) => number) =>
  buckets.map((bucket) => ({ label: bucket.day, value: accessor(bucket) }));

const buildRollingUsersSeries = (buckets: DailyBucket[], windowDays: number) => {
  return buckets.map((bucket, index) => {
    const start = Math.max(0, index - windowDays + 1);
    const users = new Set<string>();
    for (let i = start; i <= index; i += 1) {
      buckets[i].users.forEach((user) => users.add(user));
    }
    return { label: bucket.day, value: users.size };
  });
};

const safeDivide = (value: number, divider: number) => (divider > 0 ? value / divider : 0);

const buildDailySessionDurationSeries = (events: UsageEvent[], range: DateRange) => {
  const sessions = new Map<string, { start: number; end: number }>();
  events.forEach((event) => {
    if (!event.session_id) return;
    const time = new Date(event.event_ts).getTime();
    if (!Number.isFinite(time)) return;
    const existing = sessions.get(event.session_id);
    if (!existing) {
      sessions.set(event.session_id, { start: time, end: time });
      return;
    }
    existing.start = Math.min(existing.start, time);
    existing.end = Math.max(existing.end, time);
  });

  const dailyMap = new Map<string, { total: number; count: number }>();
  sessions.forEach((session) => {
    const day = toDayKey(new Date(session.start));
    const duration = Math.max(0, session.end - session.start) / 1000;
    if (!dailyMap.has(day)) dailyMap.set(day, { total: 0, count: 0 });
    const bucket = dailyMap.get(day);
    if (!bucket) return;
    bucket.total += duration;
    bucket.count += 1;
  });

  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const series: { label: string; value: number }[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const day = toDayKey(cursor);
    const bucket = dailyMap.get(day);
    series.push({ label: day, value: bucket ? safeDivide(bucket.total, bucket.count) : 0 });
  }
  return series;
};

const buildDailyDistinctSeries = (
  events: UsageEvent[],
  range: DateRange,
  predicate: (event: UsageEvent) => boolean
) => {
  const dailyMap = new Map<string, Set<string>>();
  events.forEach((event) => {
    if (!predicate(event) || !event.user_id) return;
    const time = new Date(event.event_ts);
    if (Number.isNaN(time.getTime())) return;
    const day = toDayKey(time);
    if (!dailyMap.has(day)) dailyMap.set(day, new Set());
    dailyMap.get(day)?.add(event.user_id);
  });

  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const series: { label: string; value: number }[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const day = toDayKey(cursor);
    series.push({ label: day, value: dailyMap.get(day)?.size ?? 0 });
  }
  return series;
};

const buildAiProductSeries = (
  events: UsageEvent[],
  range: DateRange
): { key: string; label: string; accent: string; total: number; series: { label: string; value: number }[] }[] => {
  const dailyMap = new Map<string, Record<string, number>>();
  const totals = new Map<string, number>();

  events.forEach((event) => {
    if (!AI_PRODUCT_KEYS.has(event.event_name)) return;
    const time = new Date(event.event_ts);
    if (Number.isNaN(time.getTime())) return;
    const day = toDayKey(time);
    const dayCounts = dailyMap.get(day) ?? {};
    dayCounts[event.event_name] = (dayCounts[event.event_name] ?? 0) + 1;
    dailyMap.set(day, dayCounts);
    totals.set(event.event_name, (totals.get(event.event_name) ?? 0) + 1);
  });

  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return AI_PRODUCT_DEFS.map((item) => ({
      ...item,
      total: totals.get(item.key) ?? 0,
      series: [],
    }));
  }

  return AI_PRODUCT_DEFS.map((item) => {
    const series: { label: string; value: number }[] = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      const day = toDayKey(cursor);
      const dayCounts = dailyMap.get(day);
      series.push({ label: day, value: dayCounts ? dayCounts[item.key] ?? 0 : 0 });
    }
    return {
      ...item,
      total: totals.get(item.key) ?? 0,
      series,
    };
  });
};

const getUniqueValues = (events: UsageEvent[], key: keyof UsageEvent) => {
  const set = new Set<string>();
  events.forEach((event) => {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) set.add(value);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

const buildEventOptions = (events: UsageEvent[]) => getUniqueValues(events, 'event_name');

const buildFilterLabel = (value: string) => (value ? value : 'All');

const LineChart = ({
  data,
  accent = '#f4a259',
  showLabels = true,
  onExpand,
}: {
  data: { label: string; value: number }[];
  accent?: string;
  showLabels?: boolean;
  onExpand?: () => void;
}) => {
  if (!data.length) {
    return <div className="chart-wrap">No data in range</div>;
  }
  const isClickable = Boolean(onExpand);
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const points = data.map((d, index) => {
    const x = (index / Math.max(1, data.length - 1)) * 100;
    const y = 100 - (d.value / max) * 100;
    return `${x},${y}`;
  });
  const path = points.join(' ');

  return (
    <div
      className={`chart-wrap${showLabels ? '' : ' chart-compact'}${isClickable ? ' chart-clickable' : ''}`}
      onClick={onExpand}
      onKeyDown={
        isClickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onExpand?.();
              }
            }
          : undefined
      }
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="rgba(93, 183, 165, 0.2)"
          strokeWidth="1"
          points={`0,100 100,100`}
        />
        <polyline
          fill="none"
          stroke={accent}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={path}
        />
      </svg>
      {showLabels ? (
        <div className="hero-metadata" style={{ marginTop: '8px' }}>
          <span className="meta-pill">{data[0]?.label}</span>
          <span className="meta-pill">{data[data.length - 1]?.label}</span>
        </div>
      ) : null}
    </div>
  );
};

const BarList = ({ title, data }: { title: string; data: BarDatum[] }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="section-card">
      <div className="section-subtitle">{title}</div>
      <div className="bar-list">
        {data.map((item) => (
          <div key={item.label} className="bar-item">
            <div>{item.label}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
            <div>{formatNumber(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MetricCard = ({
  label,
  value,
  hint,
  series,
  accent,
  onExpand,
}: {
  label: string;
  value: string;
  hint?: string;
  series: { label: string; value: number }[];
  accent?: string;
  onExpand?: (chart: ExpandedChart) => void;
}) => (
  <div className="metric-card">
    <div className="metric-header">
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {hint ? <div className="metric-hint">{hint}</div> : null}
      </div>
    </div>
    <LineChart
      data={series}
      accent={accent}
      showLabels={false}
      onExpand={
        onExpand
          ? () =>
              onExpand({
                title: label,
                subtitle: hint,
                series,
                accent,
              })
          : undefined
      }
    />
  </div>
);

const FiltersPanel = ({
  range,
  filters,
  options,
  onRangeChange,
  onFilterChange,
  onRefresh,
  refreshing,
  lastUpdated,
}: {
  range: DateRange;
  filters: Filters;
  options: Record<string, string[]>;
  onRangeChange: (next: DateRange) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdated: Date | null;
}) => (
  <div className="section-card">
    <div className="filters-header">
      <div>
        <div className="section-title">Filters</div>
        <div className="section-subtitle">Scope metrics by time and segment</div>
      </div>
      <div className="filters-actions">
        <button className="button" type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh data'}
        </button>
        <div className="filters-meta">Last refresh: {formatTimestamp(lastUpdated)}</div>
      </div>
    </div>
    <div className="filters">
      <label className="filter-control">
        Start
        <input
          type="date"
          value={range.start}
          onChange={(event) => onRangeChange({ ...range, start: event.target.value })}
        />
      </label>
      <label className="filter-control">
        End
        <input
          type="date"
          value={range.end}
          onChange={(event) => onRangeChange({ ...range, end: event.target.value })}
        />
      </label>
      <label className="filter-control">
        Plan
        <select value={filters.plan} onChange={(event) => onFilterChange('plan', event.target.value)}>
          <option value="">All</option>
          {options.plan.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Subscription
        <select
          value={filters.subscriptionStatus}
          onChange={(event) => onFilterChange('subscriptionStatus', event.target.value)}
        >
          <option value="">All</option>
          {options.subscriptionStatus.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Billing
        <select
          value={filters.billingPeriod}
          onChange={(event) => onFilterChange('billingPeriod', event.target.value)}
        >
          <option value="">All</option>
          {options.billingPeriod.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Action
        <select value={filters.action} onChange={(event) => onFilterChange('action', event.target.value)}>
          <option value="">All</option>
          {options.action.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Feature
        <select value={filters.feature} onChange={(event) => onFilterChange('feature', event.target.value)}>
          <option value="">All</option>
          {options.feature.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Event
        <select value={filters.eventName} onChange={(event) => onFilterChange('eventName', event.target.value)}>
          <option value="">All</option>
          {options.eventName.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Route
        <select value={filters.route} onChange={(event) => onFilterChange('route', event.target.value)}>
          <option value="">All</option>
          {options.route.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Section
        <select value={filters.section} onChange={(event) => onFilterChange('section', event.target.value)}>
          <option value="">All</option>
          {options.section.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Device
        <select value={filters.deviceType} onChange={(event) => onFilterChange('deviceType', event.target.value)}>
          <option value="">All</option>
          {options.deviceType.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        OS
        <select value={filters.os} onChange={(event) => onFilterChange('os', event.target.value)}>
          <option value="">All</option>
          {options.os.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Browser
        <select value={filters.browser} onChange={(event) => onFilterChange('browser', event.target.value)}>
          <option value="">All</option>
          {options.browser.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Referrer
        <select value={filters.referrer} onChange={(event) => onFilterChange('referrer', event.target.value)}>
          <option value="">All</option>
          {options.referrer.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        Landing page
        <select value={filters.landingPage} onChange={(event) => onFilterChange('landingPage', event.target.value)}>
          <option value="">All</option>
          {options.landingPage.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        UTM Source
        <select value={filters.utmSource} onChange={(event) => onFilterChange('utmSource', event.target.value)}>
          <option value="">All</option>
          {options.utmSource.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        UTM Medium
        <select value={filters.utmMedium} onChange={(event) => onFilterChange('utmMedium', event.target.value)}>
          <option value="">All</option>
          {options.utmMedium.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        UTM Campaign
        <select value={filters.utmCampaign} onChange={(event) => onFilterChange('utmCampaign', event.target.value)}>
          <option value="">All</option>
          {options.utmCampaign.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        UTM Term
        <select value={filters.utmTerm} onChange={(event) => onFilterChange('utmTerm', event.target.value)}>
          <option value="">All</option>
          {options.utmTerm.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-control">
        UTM Content
        <select value={filters.utmContent} onChange={(event) => onFilterChange('utmContent', event.target.value)}>
          <option value="">All</option>
          {options.utmContent.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  </div>
);

export default function Dashboard() {
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [filters, setFilters] = useState<Filters>({
    plan: '',
    subscriptionStatus: '',
    billingPeriod: '',
    action: '',
    route: '',
    section: '',
    feature: '',
    eventName: '',
    deviceType: '',
    os: '',
    browser: '',
    referrer: '',
    landingPage: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmTerm: '',
    utmContent: '',
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const wasLoading = useRef(false);
  const [expandedChart, setExpandedChart] = useState<ExpandedChart | null>(null);

  const { events, loading, error, truncated } = useUsageEvents(range, filters, true, refreshTick);

  useEffect(() => {
    if (wasLoading.current && !loading && !error) {
      setLastUpdated(new Date());
    }
    wasLoading.current = loading;
  }, [loading, error]);

  useEffect(() => {
    if (!expandedChart) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedChart(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedChart]);

  const dailyBuckets = useMemo(() => buildDailyBuckets(events, range), [events, range]);
  const dailyUsersSeries = useMemo(() => buildSeries(dailyBuckets, (b) => b.users.size), [dailyBuckets]);
  const dailySessionsSeries = useMemo(() => buildSeries(dailyBuckets, (b) => b.sessions.size), [dailyBuckets]);
  const dailyEventsSeries = useMemo(() => buildSeries(dailyBuckets, (b) => b.events), [dailyBuckets]);
  const dailySuccessRateSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.successCount, b.successTotal)),
    [dailyBuckets]
  );
  const dailyErrorRateSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.errorEvents, b.successTotal)),
    [dailyBuckets]
  );
  const dailyLatencySeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.latencySum, b.latencyCount)),
    [dailyBuckets]
  );
  const dailyEventsPerUserSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.events, b.users.size)),
    [dailyBuckets]
  );
  const dailySessionsPerUserSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.sessions.size, b.users.size)),
    [dailyBuckets]
  );
  const dailyEventsPerSessionSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.events, b.sessions.size)),
    [dailyBuckets]
  );
  const dailyAnonShareSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.anonEvents, b.events)),
    [dailyBuckets]
  );
  const dailyContentEventsSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => b.contentEvents),
    [dailyBuckets]
  );
  const dailyContentShareSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.contentEvents, b.events)),
    [dailyBuckets]
  );
  const dailyAiEventsSeries = useMemo(() => buildSeries(dailyBuckets, (b) => b.aiEvents), [dailyBuckets]);
  const dailyAiShareSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.aiEvents, b.events)),
    [dailyBuckets]
  );
  const dailyPaywallSeries = useMemo(() => buildSeries(dailyBuckets, (b) => b.paywallEvents), [dailyBuckets]);
  const dailyPaywallRateSeries = useMemo(
    () => buildSeries(dailyBuckets, (b) => safeDivide(b.paywallEvents, b.events)),
    [dailyBuckets]
  );
  const dailySessionDurationSeries = useMemo(
    () => buildDailySessionDurationSeries(events, range),
    [events, range]
  );
  const dailyLoginUsersSeries = useMemo(
    () => buildDailyDistinctSeries(events, range, isLoginSuccess),
    [events, range]
  );
  const aiProductSeries = useMemo(() => buildAiProductSeries(events, range), [events, range]);

  const endDate = useMemo(() => new Date(`${range.end}T23:59:59.999Z`), [range.end]);
  const rangeStartDate = useMemo(() => new Date(`${range.start}T00:00:00.000Z`), [range.start]);
  const last7Start = useMemo(() => new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000), [endDate]);
  const last30Start = useMemo(() => new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000), [endDate]);
  const wauPartial = rangeStartDate > last7Start;
  const mauPartial = rangeStartDate > last30Start;

  const rollingWauSeries = useMemo(() => buildRollingUsersSeries(dailyBuckets, 7), [dailyBuckets]);
  const rollingMauSeries = useMemo(() => buildRollingUsersSeries(dailyBuckets, 30), [dailyBuckets]);

  const lastBucket = dailyBuckets[dailyBuckets.length - 1];
  const dau = lastBucket?.users.size || 0;
  const wau = distinctCount(filterByDateRange(events, last7Start, endDate), 'user_id');
  const mau = distinctCount(filterByDateRange(events, last30Start, endDate), 'user_id');
  const totalUsers = distinctCount(events, 'user_id');
  const loginEvents = useMemo(() => events.filter((event) => event.event_name === LOGIN_EVENT_NAME), [events]);
  const loginSuccessEvents = useMemo(() => loginEvents.filter(isLoginSuccess), [loginEvents]);
  const loginUsers = distinctCount(loginSuccessEvents, 'user_id');

  const sessionStats = computeSessionStats(events);
  const totalSessions = sessionStats.sessionCount;
  const sessionsPerUser = safeDivide(totalSessions, totalUsers);
  const eventsPerUser = safeDivide(events.length, totalUsers);
  const eventsPerSession = safeDivide(events.length, totalSessions);
  const totalAnonEvents = dailyBuckets.reduce((sum, bucket) => sum + bucket.anonEvents, 0);
  const totalPaywallEvents = dailyBuckets.reduce((sum, bucket) => sum + bucket.paywallEvents, 0);

  const successRate = computeSuccessRate(events).successRate;
  const errorRate = computeSuccessRate(events).errorRate;
  const avgLatency = extractNumericProperty(events, 'latency_ms');

  const featureUsage = buildDistinctUserBarList(events, 'feature', 6);
  const planUsage = buildDistinctUserBarList(events, 'plan', 6);
  const subscriptionStatusUsage = buildDistinctUserBarList(events, 'subscription_status', 6);
  const billingPeriodUsage = buildDistinctUserBarList(events, 'billing_period', 6);
  const sectionUsage = buildDistinctUserBarList(events, 'section', 6);
  const deviceUsage = buildDistinctUserBarList(events, 'device_type', 6);
  const osUsage = buildDistinctUserBarList(events, 'os', 6);
  const browserUsage = buildDistinctUserBarList(events, 'browser', 6);
  const eventCounts = buildBarList(events, 'event_name', 6);
  const routeCounts = buildBarList(events, 'route', 6);
  const actionCounts = buildBarList(events, 'action', 5);
  const utmSources = buildBarList(events, 'utm_source', 5);
  const utmMediums = buildBarList(events, 'utm_medium', 5);
  const utmCampaigns = buildBarList(events, 'utm_campaign', 5);
  const utmTerms = buildBarList(events, 'utm_term', 5);
  const utmContents = buildBarList(events, 'utm_content', 5);
  const referrers = buildBarList(events, 'referrer', 5);
  const landingPages = buildBarList(events, 'landing_page', 5);
  const errorCodes = extractTopProperty(events, 'error_code', 5);

  const contentEvents = events.filter((event) => CONTENT_EVENT_NAMES.includes(event.event_name));
  const aiEvents = events.filter((event) => AI_PRODUCT_KEYS.has(event.event_name));

  const aiSuccessRate = computeSuccessRate(aiEvents).successRate;
  const aiShare = safeDivide(aiEvents.length, events.length);
  const contentShare = safeDivide(contentEvents.length, events.length);
  const anonShare = safeDivide(totalAnonEvents, events.length);
  const paywallRate = safeDivide(totalPaywallEvents, events.length);
  const aiTopModules = buildBarList(aiEvents, 'feature', 5);

  const options = useMemo(
    () => ({
      plan: getUniqueValues(events, 'plan'),
      subscriptionStatus: getUniqueValues(events, 'subscription_status'),
      billingPeriod: getUniqueValues(events, 'billing_period'),
      action: getUniqueValues(events, 'action'),
      route: getUniqueValues(events, 'route'),
      section: getUniqueValues(events, 'section'),
      feature: getUniqueValues(events, 'feature'),
      eventName: buildEventOptions(events),
      deviceType: getUniqueValues(events, 'device_type'),
      os: getUniqueValues(events, 'os'),
      browser: getUniqueValues(events, 'browser'),
      referrer: getUniqueValues(events, 'referrer'),
      landingPage: getUniqueValues(events, 'landing_page'),
      utmSource: getUniqueValues(events, 'utm_source'),
      utmMedium: getUniqueValues(events, 'utm_medium'),
      utmCampaign: getUniqueValues(events, 'utm_campaign'),
      utmTerm: getUniqueValues(events, 'utm_term'),
      utmContent: getUniqueValues(events, 'utm_content'),
    }),
    [events]
  );

  const rangeLabel = `${range.start} to ${range.end}`;
  const openChart = (chart: ExpandedChart) => setExpandedChart(chart);

  return (
    <div className="app-content">
      <div className="container">
        <div className="hero">
          <div className="hero-card">
            <div className="hero-title">Usage control tower</div>
            <div className="hero-metadata">
              <span className="meta-pill">{buildFilterLabel(filters.plan)} plan</span>
              <span className="meta-pill">{buildFilterLabel(filters.feature)} feature</span>
              <span className="meta-pill">{rangeLabel}</span>
            </div>
          </div>
          <div className="hero-card">
            <div className="section-subtitle">Daily actives</div>
            <LineChart
              data={dailyUsersSeries}
              onExpand={() =>
                openChart({
                  title: 'Daily actives',
                  subtitle: rangeLabel,
                  series: dailyUsersSeries,
                })
              }
            />
          </div>
        </div>

        <FiltersPanel
          range={range}
          filters={filters}
          options={options}
          onRangeChange={setRange}
          onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onRefresh={() => setRefreshTick((prev) => prev + 1)}
          refreshing={loading}
          lastUpdated={lastUpdated}
        />

        {loading ? <div className="loading">Loading usage events</div> : null}
        {truncated ? (
          <div className="notice">
            Too many rows in range. Narrow the filters to avoid partial metrics.
          </div>
        ) : null}
        {error ? <div className="notice">{error}</div> : null}

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">Activity trends</div>
          <div className="section-subtitle">DAU, WAU, MAU, sessions and event volume</div>
          <div className="metric-grid">
            <MetricCard
              label="DAU (Daily Active Users)"
              value={formatNumber(dau)}
              hint="Last day"
              series={dailyUsersSeries}
              onExpand={openChart}
            />
            <MetricCard
              label="WAU (7d rolling users)"
              value={formatNumber(wau)}
              hint={wauPartial ? 'Trailing 7 days (partial)' : 'Trailing 7 days'}
              series={rollingWauSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="MAU (30d rolling users)"
              value={formatNumber(mau)}
              hint={mauPartial ? 'Trailing 30 days (partial)' : 'Trailing 30 days'}
              series={rollingMauSeries}
              accent="#f28f79"
              onExpand={openChart}
            />
            <MetricCard
              label="Sessions"
              value={formatNumber(totalSessions)}
              hint={`Per user: ${sessionsPerUser.toFixed(2)}`}
              series={dailySessionsSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="Login users"
              value={formatNumber(loginUsers)}
              hint="Unique users with login success"
              series={dailyLoginUsersSeries}
              accent="#f2c14e"
              onExpand={openChart}
            />
            <MetricCard
              label="Avg session duration"
              value={formatDuration(sessionStats.avgDurationSeconds)}
              hint="Based on session_id"
              series={dailySessionDurationSeries}
              accent="#f4a259"
              onExpand={openChart}
            />
            <MetricCard
              label="Events"
              value={formatNumber(events.length)}
              hint="All events"
              series={dailyEventsSeries}
              onExpand={openChart}
            />
            <MetricCard
              label="Events/User"
              value={eventsPerUser.toFixed(2)}
              hint="Average per user"
              series={dailyEventsPerUserSeries}
              accent="#f28f79"
              onExpand={openChart}
            />
            <MetricCard
              label="Sessions/User"
              value={sessionsPerUser.toFixed(2)}
              hint="Average per user"
              series={dailySessionsPerUserSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="Events/Session"
              value={eventsPerSession.toFixed(2)}
              hint="Average per session"
              series={dailyEventsPerSessionSeries}
              accent="#f4a259"
              onExpand={openChart}
            />
          </div>
        </div>

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">Quality trends</div>
          <div className="section-subtitle">Success, errors, latency, paywall, anon share</div>
          <div className="metric-grid">
            <MetricCard
              label="Success rate"
              value={formatPercent(successRate)}
              hint="All events"
              series={dailySuccessRateSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="Error rate"
              value={formatPercent(errorRate)}
              hint="All events"
              series={dailyErrorRateSeries}
              accent="#f28f79"
              onExpand={openChart}
            />
            <MetricCard
              label="Avg latency (ms)"
              value={avgLatency ? `${Math.round(avgLatency)} ms` : 'n/a'}
              hint="From latency_ms"
              series={dailyLatencySeries}
              accent="#f4a259"
              onExpand={openChart}
            />
            <MetricCard
              label="Paywall rate"
              value={formatPercent(paywallRate)}
              hint="paywall_block / events"
              series={dailyPaywallRateSeries}
              accent="#f28f79"
              onExpand={openChart}
            />
            <MetricCard
              label="Anon share"
              value={formatPercent(anonShare)}
              hint="anon_id events / total"
              series={dailyAnonShareSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
          </div>
        </div>

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">Product trends</div>
          <div className="section-subtitle">Content and AI usage</div>
          <div className="metric-grid">
            <MetricCard
              label="Content events"
              value={formatNumber(contentEvents.length)}
              hint="Reports + content"
              series={dailyContentEventsSeries}
              onExpand={openChart}
            />
            <MetricCard
              label="AI events"
              value={formatNumber(aiEvents.length)}
              hint="analysis_run + validator_run"
              series={dailyAiEventsSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="Content share"
              value={formatPercent(contentShare)}
              hint="content / all events"
              series={dailyContentShareSeries}
              accent="#f4a259"
              onExpand={openChart}
            />
            <MetricCard
              label="AI share"
              value={formatPercent(aiShare)}
              hint="AI / all events"
              series={dailyAiShareSeries}
              accent="#5db7a5"
              onExpand={openChart}
            />
            <MetricCard
              label="Paywall blocks"
              value={formatNumber(totalPaywallEvents)}
              hint="Event count"
              series={dailyPaywallSeries}
              accent="#f28f79"
              onExpand={openChart}
            />
          </div>
        </div>

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">AI product trends</div>
          <div className="section-subtitle">One chart per AI module</div>
          <div className="metric-grid">
            {aiProductSeries.map((product) => {
              const share = safeDivide(product.total, aiEvents.length);
              return (
                <MetricCard
                  key={product.key}
                  label={product.label}
                  value={formatNumber(product.total)}
                  hint={`event_name: ${product.key} | AI share: ${formatPercent(share)}`}
                  series={product.series}
                  accent={product.accent}
                  onExpand={openChart}
                />
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Behavior & modules</div>
          <div className="section-subtitle">Event mix, features, and sections</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList title="Top events" data={eventCounts} />
          <BarList title="Action mix" data={actionCounts} />
          <BarList title="Active users by feature" data={featureUsage} />
          <BarList title="Active users by section" data={sectionUsage} />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Plans & subscription</div>
          <div className="section-subtitle">Access distribution and billing</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList title="Active users by plan" data={planUsage} />
          <BarList title="Active users by status" data={subscriptionStatusUsage} />
          <BarList title="Active users by billing period" data={billingPeriodUsage} />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Traffic & attribution</div>
          <div className="section-subtitle">Routes, landing pages, and UTM parameters</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList title="Top routes" data={routeCounts} />
          <BarList title="Landing pages" data={landingPages} />
          <BarList title="Referrers" data={referrers} />
          <BarList title="UTM source" data={utmSources} />
          <BarList title="UTM medium" data={utmMediums} />
          <BarList title="UTM campaign" data={utmCampaigns} />
          <BarList title="UTM term" data={utmTerms} />
          <BarList title="UTM content" data={utmContents} />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Devices & platform</div>
          <div className="section-subtitle">Distribution by device, OS, and browser</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList title="Device type" data={deviceUsage} />
          <BarList title="OS" data={osUsage} />
          <BarList title="Browser" data={browserUsage} />
        </div>

        <div className="section-grid" style={{ marginTop: '20px' }}>
          <div className="section-card">
            <div className="section-title">Quality signals</div>
            <div className="section-subtitle">Latency, success and errors</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>Average latency</td>
                  <td>{avgLatency ? `${Math.round(avgLatency)} ms` : 'n/a'}</td>
                </tr>
                <tr>
                  <td>Success rate</td>
                  <td>{formatPercent(successRate)}</td>
                </tr>
                <tr>
                  <td>Error rate</td>
                  <td>{formatPercent(errorRate)}</td>
                </tr>
                <tr>
                  <td>Paywall rate</td>
                  <td>{formatPercent(paywallRate)}</td>
                </tr>
              </tbody>
            </table>
            {errorCodes.length ? (
              <div style={{ marginTop: '12px' }}>
                <div className="section-subtitle">Top error codes</div>
                <div className="bar-list">
                  {errorCodes.map((item) => (
                    <div key={item.label} className="bar-item">
                      <div>{item.label}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(item.value / errorCodes[0].value) * 100}%` }} />
                      </div>
                      <div>{formatNumber(item.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Content & AI</div>
          <div className="section-subtitle">Research consumption and AI usage</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <div className="section-card">
            <div className="section-title">Research content</div>
            <div className="section-subtitle">Reports and content usage</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>Content events</td>
                  <td>{formatNumber(contentEvents.length)}</td>
                </tr>
                <tr>
                  <td>Content unique users</td>
                  <td>{formatNumber(distinctCount(contentEvents, 'user_id'))}</td>
                </tr>
                <tr>
                  <td>Content share</td>
                  <td>{formatPercent(contentShare)}</td>
                </tr>
              </tbody>
            </table>
            <LineChart
              data={dailyContentEventsSeries}
              accent="#f4a259"
              showLabels={false}
              onExpand={() =>
                openChart({
                  title: 'Content events',
                  subtitle: rangeLabel,
                  series: dailyContentEventsSeries,
                  accent: '#f4a259',
                })
              }
            />
          </div>
          <div className="section-card">
            <div className="section-title">AI modules</div>
            <div className="section-subtitle">Analyses and success rate</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>AI events</td>
                  <td>{formatNumber(aiEvents.length)}</td>
                </tr>
                <tr>
                  <td>AI success</td>
                  <td>{formatPercent(aiSuccessRate)}</td>
                </tr>
                <tr>
                  <td>AI share</td>
                  <td>{formatPercent(aiShare)}</td>
                </tr>
              </tbody>
            </table>
            <LineChart
              data={dailyAiEventsSeries}
              accent="#5db7a5"
              showLabels={false}
              onExpand={() =>
                openChart({
                  title: 'AI events',
                  subtitle: rangeLabel,
                  series: dailyAiEventsSeries,
                  accent: '#5db7a5',
                })
              }
            />
            {aiTopModules.length ? (
              <div style={{ marginTop: '12px' }}>
                <div className="section-subtitle">Top modules</div>
                <div className="bar-list">
                  {aiTopModules.map((item) => (
                    <div key={item.label} className="bar-item">
                      <div>{item.label}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(item.value / aiTopModules[0].value) * 100}%` }} />
                      </div>
                      <div>{formatNumber(item.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="section-card">
            <div className="section-title">Derived metrics</div>
            <div className="section-subtitle">Ratios from the selected range</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>Total users</td>
                  <td>{formatNumber(totalUsers)}</td>
                </tr>
                <tr>
                  <td>Total sessions</td>
                  <td>{formatNumber(totalSessions)}</td>
                </tr>
                <tr>
                  <td>Total events</td>
                  <td>{formatNumber(events.length)}</td>
                </tr>
                <tr>
                  <td>Events per user</td>
                  <td>{eventsPerUser.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Events per session</td>
                  <td>{eventsPerSession.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Anon share</td>
                  <td>{formatPercent(anonShare)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">Glossary</div>
          <div className="section-subtitle">Acronyms used in this dashboard</div>
          <table className="table">
            <tbody>
              <tr>
                <td>DAU</td>
                <td>Daily Active Users - unique users in a day</td>
              </tr>
              <tr>
                <td>WAU</td>
                <td>Weekly Active Users - unique users in the last 7 days</td>
              </tr>
              <tr>
                <td>MAU</td>
                <td>Monthly Active Users - unique users in the last 30 days</td>
              </tr>
              <tr>
                <td>UTM</td>
                <td>Urchin Tracking Module parameters for campaign attribution</td>
              </tr>
              <tr>
                <td>AI</td>
                <td>Artificial Intelligence modules (analysis and validation)</td>
              </tr>
              <tr>
                <td>Avg</td>
                <td>Average value for the selected metric</td>
              </tr>
              <tr>
                <td>ms</td>
                <td>Milliseconds, used for latency measurements</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {expandedChart ? (
        <div className="chart-modal" role="dialog" aria-modal="true" onClick={() => setExpandedChart(null)}>
          <div className="chart-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="chart-modal-header">
              <div>
                <div className="section-title">{expandedChart.title}</div>
                <div className="chart-modal-meta">{expandedChart.subtitle || rangeLabel}</div>
              </div>
              <button className="button" type="button" onClick={() => setExpandedChart(null)}>
                Close
              </button>
            </div>
            <LineChart data={expandedChart.series} accent={expandedChart.accent} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
