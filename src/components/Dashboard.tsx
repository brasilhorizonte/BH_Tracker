import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
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
import { EMPTY_FILTER_VALUE, LOVABLE_FILTER_VALUE } from '../types';
import type { BarDatum, DateRange, Filters, UsageEvent } from '../types';

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const formatPercent = (value: number | null) =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatDecimal = (value: number) => value.toFixed(2);

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

const formatFilterValue = (value: string) => {
  if (value === EMPTY_FILTER_VALUE) return 'Not set';
  if (value === LOVABLE_FILTER_VALUE) return LOVABLE_LABEL;
  return value;
};

const shortenLabel = (value: string, maxLength = MAX_URL_LABEL_LENGTH) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
};

const parseUrlParts = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || !/[./]/.test(trimmed)) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return {
      host: url.hostname.replace(/^www\./i, ''),
      path: url.pathname,
    };
  } catch {
    return null;
  }
};

const formatUrlLabel = (value: string) => {
  const parts = parseUrlParts(value);
  let label = value.trim();
  if (parts) {
    const segments = parts.path.split('/').filter(Boolean);
    if (!segments.length) {
      label = parts.host;
    } else if (segments.length === 1) {
      label = `${parts.host}/${segments[0]}`;
    } else {
      label = `${parts.host}/${segments[0]}/...`;
    }
  } else {
    label = label.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    label = label.split(/[?#]/)[0];
  }
  return shortenLabel(label);
};

const isLovableValue = (value: string) => {
  const lower = value.toLowerCase();
  const parts = parseUrlParts(value);
  if (parts?.host) return parts.host.includes('lovable');
  return lower.includes('lovable');
};

const formatFilterValueByKey = (key: keyof Filters, value: string) => {
  if (value === LOVABLE_FILTER_VALUE) return LOVABLE_LABEL;
  if (value === EMPTY_FILTER_VALUE) {
    if (key === 'referrer') return DIRECT_LABEL;
    if (key === 'landingPage') return UNKNOWN_LABEL;
    return 'Not set';
  }
  if (key === 'referrer' || key === 'landingPage') return formatUrlLabel(value);
  return value;
};

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const getDefaultRange = (): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { start: toDateKey(start), end: toDateKey(end) };
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
  formatValue?: (value: number) => string;
};

type FocusPoint = {
  label: string;
  value: number;
  formattedValue: string;
  metricLabel: string;
  accent?: string;
};

type InsightItem = {
  title: string;
  value: string;
  caption: string;
  day?: string;
  accent?: string;
};

const toDayKey = toDateKey;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const DAY_MS = 24 * 60 * 60 * 1000;

const buildPresetRange = (days: number): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { start: toDateKey(start), end: toDateKey(end) };
};

const CONTENT_EVENT_NAMES = ['report_view', 'report_download', 'content_view', 'content_download'];
const AI_MODULE_DEFS = [
  { key: 'analysis_run', label: 'Analysis', accent: '#f4a259' },
  { key: 'validator_run', label: 'Validator', accent: '#5db7a5' },
  { key: 'qualitativo_run', label: 'Qualitativo', accent: '#f28f79' },
  { key: 'valuai_run', label: 'ValuAI', accent: '#f2c14e' },
];
const AI_MODULE_KEYS = new Set(AI_MODULE_DEFS.map((item) => item.key));
const AI_FEATURE_ALIASES: Record<string, string> = {
  validador: 'validador',
  validador_ai: 'validador',
  qualitativo: 'qualitativo',
  qualitativo_ai: 'qualitativo',
  valuai: 'valuai',
  valuai_ai: 'valuai',
};
const LOGIN_EVENT_NAME = 'login';
const DIRECT_LABEL = 'Direct';
const UNKNOWN_LABEL = 'Unknown';
const LOVABLE_LABEL = 'Lovable';
const MAX_URL_LABEL_LENGTH = 42;
const REFERRER_PRESETS = ['instagram', 'twitter', 'reddit'];
const REFERRER_LIST_LIMIT = 10;

const normalizeAiFeature = (feature: string | null) => {
  if (!feature) return null;
  const normalized = feature.trim().toLowerCase();
  return AI_FEATURE_ALIASES[normalized] ?? normalized;
};

const getAiModuleKey = (event: UsageEvent) => {
  if (event.event_name === 'analysis_run') {
    const feature = normalizeAiFeature(event.feature);
    if (feature === 'qualitativo') return 'qualitativo_run';
    if (feature === 'valuai') return 'valuai_run';
    if (feature === 'validador') return 'analysis_run';
    return 'analysis_run';
  }
  if (AI_MODULE_KEYS.has(event.event_name)) return event.event_name;
  return null;
};

const isAiEvent = (event: UsageEvent) => getAiModuleKey(event) !== null;

const isLoginSuccess = (event: UsageEvent) =>
  event.event_name === LOGIN_EVENT_NAME && (event.action === 'success' || event.success === true);

const buildDailyBuckets = (events: UsageEvent[], range: DateRange): DailyBucket[] => {
  const contentEventNames = new Set(CONTENT_EVENT_NAMES);
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
    if (isAiEvent(event)) bucket.aiEvents += 1;
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
const computeDelta = (current: number, previous: number) => (previous > 0 ? (current - previous) / previous : null);
const computeRate = (count: number, total: number) => (total > 0 ? count / total : null);

const formatDeltaPercent = (delta: number | null) =>
  delta === null || !Number.isFinite(delta) ? 'n/a' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;

const formatDeltaPoints = (delta: number | null) =>
  delta === null || !Number.isFinite(delta) ? 'n/a' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`;

const formatSignedNumber = (value: number) => `${value >= 0 ? '+' : '-'}${formatNumber(Math.abs(value))}`;

const findPeak = (buckets: DailyBucket[], accessor: (bucket: DailyBucket) => number) => {
  let best: { day: string; value: number } | null = null;
  buckets.forEach((bucket) => {
    const value = accessor(bucket);
    if (!Number.isFinite(value)) return;
    if (!best || value > best.value) {
      best = { day: bucket.day, value };
    }
  });
  return best;
};

const findChangeExtremes = (series: { label: string; value: number }[]) => {
  let increase: { day: string; value: number } | null = null;
  let decrease: { day: string; value: number } | null = null;
  for (let i = 1; i < series.length; i += 1) {
    const delta = series[i].value - series[i - 1].value;
    if (!increase || delta > increase.value) increase = { day: series[i].label, value: delta };
    if (!decrease || delta < decrease.value) decrease = { day: series[i].label, value: delta };
  }
  return { increase, decrease };
};

const computeSeriesStats = (series: { label: string; value: number }[]) => {
  if (!series.length) return null;
  let min = series[0];
  let max = series[0];
  let total = 0;
  series.forEach((point) => {
    if (point.value < min.value) min = point;
    if (point.value > max.value) max = point;
    total += point.value;
  });
  return {
    min,
    max,
    avg: total / series.length,
  };
};

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
    const moduleKey = getAiModuleKey(event);
    if (!moduleKey) return;
    const time = new Date(event.event_ts);
    if (Number.isNaN(time.getTime())) return;
    const day = toDayKey(time);
    const dayCounts = dailyMap.get(day) ?? {};
    dayCounts[moduleKey] = (dayCounts[moduleKey] ?? 0) + 1;
    dailyMap.set(day, dayCounts);
    totals.set(moduleKey, (totals.get(moduleKey) ?? 0) + 1);
  });

  const start = new Date(`${range.start}T00:00:00.000Z`);
  const end = new Date(`${range.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return AI_MODULE_DEFS.map((item) => ({
      ...item,
      total: totals.get(item.key) ?? 0,
      series: [],
    }));
  }

  return AI_MODULE_DEFS.map((item) => {
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
  let hasEmpty = false;
  events.forEach((event) => {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) {
      set.add(value);
    } else if (value == null) {
      hasEmpty = true;
    }
  });
  const values = Array.from(set).sort((a, b) => a.localeCompare(b));
  if (hasEmpty) values.unshift(EMPTY_FILTER_VALUE);
  return values;
};

const buildUrlBarList = (
  events: UsageEvent[],
  key: 'referrer' | 'landing_page',
  limit: number,
  emptyLabel: string
): BarDatum[] => {
  const counts = new Map<string, { value: number; label: string; title: string; isFallback: boolean }>();
  events.forEach((event) => {
    const raw = event[key];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    let valueKey = EMPTY_FILTER_VALUE;
    let label = emptyLabel;
    let title = emptyLabel;
    let isFallback = true;

    if (trimmed) {
      if (isLovableValue(trimmed)) {
        valueKey = LOVABLE_FILTER_VALUE;
        label = LOVABLE_LABEL;
        title = LOVABLE_LABEL;
        isFallback = false;
      } else {
        valueKey = trimmed;
        label = formatUrlLabel(trimmed);
        title = trimmed;
        isFallback = false;
      }
    }

    const entry = counts.get(valueKey);
    if (entry) {
      entry.value += 1;
      return;
    }
    counts.set(valueKey, { value: 1, label, title, isFallback });
  });

  return Array.from(counts.entries())
    .map(([valueKey, entry]) => ({
      key: valueKey,
      label: entry.label,
      title: entry.title,
      value: entry.value,
      isFallback: entry.isFallback,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

const buildUrlFilterOptions = (
  events: UsageEvent[],
  eventKey: 'referrer' | 'landing_page',
  filterKey: 'referrer' | 'landingPage',
  presets: string[] = []
) => {
  const values = getUniqueValues(events, eventKey);
  const hasEmpty = values[0] === EMPTY_FILTER_VALUE;
  const baseValues = hasEmpty ? values.slice(1) : values;
  const set = new Set(baseValues.filter((value) => !isLovableValue(value)));
  presets.forEach((preset) => {
    if (preset) set.add(preset);
  });
  if (baseValues.some((value) => isLovableValue(value))) {
    set.add(LOVABLE_FILTER_VALUE);
  }
  const sorted = Array.from(set).sort((a, b) =>
    formatFilterValueByKey(filterKey, a).localeCompare(formatFilterValueByKey(filterKey, b))
  );
  return hasEmpty ? [EMPTY_FILTER_VALUE, ...sorted] : sorted;
};

const buildEventOptions = (events: UsageEvent[]) => getUniqueValues(events, 'event_name');

const buildFilterLabel = (value: string) => (value ? formatFilterValue(value) : 'All');

const LineChart = ({
  data,
  accent = '#f4a259',
  showLabels = true,
  onExpand,
  onFocus,
  formatValue,
}: {
  data: { label: string; value: number }[];
  accent?: string;
  showLabels?: boolean;
  onExpand?: () => void;
  onFocus?: (point: { label: string; value: number } | null) => void;
  formatValue?: (value: number) => string;
}) => {
  if (!data.length) {
    return <div className="chart-wrap">No data in range</div>;
  }
  const isClickable = Boolean(onExpand);
  const formatChartValue = formatValue ?? formatNumber;
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const coords = data.map((d, index) => {
    const x = (index / Math.max(1, data.length - 1)) * 100;
    const y = 100 - (d.value / max) * 100;
    return { x, y };
  });
  const path = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const setActivePoint = (index: number | null, notify = true) => {
    setActiveIndex(index);
    if (notify) onFocus?.(index === null ? null : data[index]);
  };

  const handleMove = (event: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0]?.clientX : event.clientX;
    if (clientX === undefined) return;
    const percent = (clientX - rect.left) / rect.width;
    const clamped = Math.min(Math.max(percent, 0), 1);
    const index = Math.round(clamped * (data.length - 1));
    if (index !== activeIndex) {
      setActivePoint(index);
    }
  };

  const handleLeave = () => setActivePoint(null, false);

  const activePoint = activeIndex === null ? null : coords[activeIndex];
  const activeDatum = activeIndex === null ? null : data[activeIndex];

  return (
    <div
      className={`chart-wrap${showLabels ? '' : ' chart-compact'}${isClickable ? ' chart-clickable' : ''}`}
      onClick={onExpand}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onTouchStart={handleMove}
      onTouchMove={handleMove}
      onTouchEnd={handleLeave}
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
        {activePoint ? (
          <>
            <line className="chart-guide" x1={activePoint.x} y1="0" x2={activePoint.x} y2="100" />
            <circle className="chart-dot" cx={activePoint.x} cy={activePoint.y} r="2.8" fill={accent} />
          </>
        ) : null}
      </svg>
      {activePoint && activeDatum ? (
        <div className="chart-tooltip" style={{ left: `${activePoint.x}%` }}>
          <div className="chart-tooltip-value">{formatChartValue(activeDatum.value)}</div>
          <div className="chart-tooltip-label">{activeDatum.label}</div>
        </div>
      ) : null}
      {showLabels ? (
        <div className="hero-metadata" style={{ marginTop: '8px' }}>
          <span className="meta-pill">{data[0]?.label}</span>
          <span className="meta-pill">{data[data.length - 1]?.label}</span>
        </div>
      ) : null}
    </div>
  );
};

const BarList = ({
  title,
  data,
  onSelect,
  activeValue,
  filterLabel,
}: {
  title: string;
  data: BarDatum[];
  onSelect?: (value: string) => void;
  activeValue?: string;
  filterLabel?: string;
}) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="section-card">
      <div className="section-subtitle">{title}</div>
      <div className="bar-list">
        {data.map((item) => {
          const valueKey = item.key ?? item.label;
          const isActive = activeValue === valueKey;
          const isInteractive = Boolean(onSelect);
          if (isInteractive) {
            return (
              <button
                key={valueKey}
                className={`bar-item bar-item-button${isActive ? ' is-active' : ''}`}
                type="button"
                onClick={() => onSelect?.(valueKey)}
                aria-pressed={isActive}
              >
                <div className="bar-label" title={item.title ?? item.label}>
                  {item.label}
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
                </div>
                <div>{formatNumber(item.value)}</div>
              </button>
            );
          }
          return (
            <div key={valueKey} className="bar-item">
              <div className="bar-label" title={item.title ?? item.label}>
                {item.label}
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
              </div>
              <div>{formatNumber(item.value)}</div>
            </div>
          );
        })}
      </div>
      {onSelect ? (
        <div className="bar-hint">Click a row to filter by {filterLabel ?? 'this segment'}.</div>
      ) : null}
    </div>
  );
};

const UtmCard = ({
  items,
  onSelect,
}: {
  items: { key: keyof Filters; label: string; data: BarDatum[]; activeValue: string }[];
  onSelect: (key: keyof Filters, value: string) => void;
}) => (
  <div className="section-card">
    <div className="section-subtitle">UTM parameters</div>
    <div className="utm-grid">
      {items.map((item) => {
        const max = Math.max(...item.data.map((datum) => datum.value), 1);
        return (
          <div key={item.key} className="utm-block">
            <div className="utm-title">{item.label}</div>
            <div className="bar-list">
              {item.data.length ? (
                item.data.map((datum) => {
                  const valueKey = datum.key ?? datum.label;
                  const isActive = item.activeValue === valueKey;
                  return (
                    <button
                      key={valueKey}
                      className={`bar-item bar-item-button${isActive ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => onSelect(item.key, valueKey)}
                      aria-pressed={isActive}
                    >
                      <div className="bar-label" title={datum.title ?? datum.label}>
                        {datum.label}
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(datum.value / max) * 100}%` }} />
                      </div>
                      <div>{formatNumber(datum.value)}</div>
                    </button>
                  );
                })
              ) : (
                <div className="utm-empty">No data</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    <div className="bar-hint">Click a row to filter by UTM field.</div>
  </div>
);

const MetricCard = ({
  label,
  value,
  hint,
  series,
  accent,
  onExpand,
  onFocus,
  formatValue,
}: {
  label: string;
  value: string;
  hint?: string;
  series: { label: string; value: number }[];
  accent?: string;
  onExpand?: (chart: ExpandedChart) => void;
  onFocus?: (point: FocusPoint | null) => void;
  formatValue?: (value: number) => string;
}) => (
  <div className="metric-card">
    <div className="metric-header">
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {hint ? <div className="metric-hint">{hint}</div> : null}
      </div>
      {onExpand ? (
        <button
          className="button button-ghost button-small"
          type="button"
          onClick={() =>
            onExpand({
              title: label,
              subtitle: hint,
              series,
              accent,
              formatValue,
            })
          }
        >
          Explore
        </button>
      ) : null}
    </div>
    <LineChart
      data={series}
      accent={accent}
      showLabels={false}
      onExpand={onExpand ? () => onExpand({ title: label, subtitle: hint, series, accent, formatValue }) : undefined}
      onFocus={
        onFocus
          ? (point) =>
              onFocus(
                point
                  ? {
                      label: point.label,
                      value: point.value,
                      formattedValue: formatValue ? formatValue(point.value) : formatNumber(point.value),
                      metricLabel: label,
                      accent,
                    }
                  : null
              )
          : undefined
      }
      formatValue={formatValue}
    />
  </div>
);

const defaultFilters: Filters = {
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
};

const FILTER_LABELS: Record<keyof Filters, string> = {
  plan: 'Plan',
  subscriptionStatus: 'Subscription',
  billingPeriod: 'Billing',
  action: 'Action',
  route: 'Route',
  section: 'Section',
  feature: 'Feature',
  eventName: 'Event',
  deviceType: 'Device',
  os: 'OS',
  browser: 'Browser',
  referrer: 'Referrer',
  landingPage: 'Landing page',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  utmTerm: 'UTM term',
  utmContent: 'UTM content',
};

const RANGE_PRESETS = [
  { label: 'Last 7d', days: 7 },
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
];

const FiltersPanel = ({
  range,
  filters,
  options,
  onRangeChange,
  onFilterChange,
  onClearFilters,
  activeFilters,
  onPresetRange,
  presets,
  onRefresh,
  refreshing,
  lastUpdated,
}: {
  range: DateRange;
  filters: Filters;
  options: Record<string, string[]>;
  onRangeChange: (next: DateRange) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
  onClearFilters: () => void;
  activeFilters: { key: keyof Filters; label: string; value: string }[];
  onPresetRange: (days: number) => void;
  presets: { label: string; days: number }[];
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
    <div className="filters-presets">
      <div className="filters-meta">Quick range</div>
      <div className="filters-pills">
        {presets.map((preset) => (
          <button
            key={preset.label}
            className="button button-ghost button-small"
            type="button"
            onClick={() => onPresetRange(preset.days)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
    <div className="filters-chips">
      <div className="filters-meta">Active segments</div>
      {activeFilters.length ? (
        <div className="chips">
          {activeFilters.map((item) => (
            <button
              key={item.key}
              className="chip"
              type="button"
              onClick={() => onFilterChange(item.key, '')}
            >
              {item.label}: {item.value}
              <span className="chip-close" aria-hidden="true">
                x
              </span>
            </button>
          ))}
          <button className="button button-ghost button-small" type="button" onClick={onClearFilters}>
            Clear all
          </button>
        </div>
      ) : (
        <div className="filters-empty">No active filters</div>
      )}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValueByKey('referrer', option)}
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
              {formatFilterValueByKey('landingPage', option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
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
              {formatFilterValue(option)}
            </option>
          ))}
        </select>
      </label>
    </div>
  </div>
);

export default function Dashboard() {
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const wasLoading = useRef(false);
  const [expandedChart, setExpandedChart] = useState<ExpandedChart | null>(null);
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);

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

  useEffect(() => {
    if (!focusPoint) return;
    if (focusPoint.label < range.start || focusPoint.label > range.end) {
      setFocusPoint(null);
    }
  }, [focusPoint, range.start, range.end]);

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
  const referrers = buildUrlBarList(events, 'referrer', REFERRER_LIST_LIMIT, DIRECT_LABEL);
  const landingPages = buildUrlBarList(events, 'landing_page', 5, UNKNOWN_LABEL);
  const errorCodes = extractTopProperty(events, 'error_code', 5);

  const contentEvents = events.filter((event) => CONTENT_EVENT_NAMES.includes(event.event_name));
  const aiEvents = events.filter(isAiEvent);
  const aiEventsNormalized = aiEvents.map((event) => ({
    ...event,
    feature: normalizeAiFeature(event.feature) ?? event.feature,
  }));

  const aiSuccessRate = computeSuccessRate(aiEvents).successRate;
  const aiShare = safeDivide(aiEvents.length, events.length);
  const contentShare = safeDivide(contentEvents.length, events.length);
  const anonShare = safeDivide(totalAnonEvents, events.length);
  const paywallRate = safeDivide(totalPaywallEvents, events.length);
  const aiTopModules = buildBarList(aiEventsNormalized, 'feature', 5);

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
      referrer: buildUrlFilterOptions(events, 'referrer', 'referrer', REFERRER_PRESETS),
      landingPage: buildUrlFilterOptions(events, 'landing_page', 'landingPage'),
      utmSource: getUniqueValues(events, 'utm_source'),
      utmMedium: getUniqueValues(events, 'utm_medium'),
      utmCampaign: getUniqueValues(events, 'utm_campaign'),
      utmTerm: getUniqueValues(events, 'utm_term'),
      utmContent: getUniqueValues(events, 'utm_content'),
    }),
    [events]
  );

  const activeFilters = useMemo(
    () =>
      (Object.entries(filters) as [keyof Filters, string][])
        .filter(([, value]) => value)
        .map(([key, value]) => ({
          key,
          label: FILTER_LABELS[key],
          value: formatFilterValueByKey(key, value),
        })),
    [filters]
  );

  const focusBucket = useMemo(() => {
    if (!focusPoint) return null;
    return dailyBuckets.find((bucket) => bucket.day === focusPoint.label) ?? null;
  }, [dailyBuckets, focusPoint]);

  const focusStats = useMemo(() => {
    if (!focusBucket) return [];
    const successRate = computeRate(focusBucket.successCount, focusBucket.successTotal);
    const paywallRate = computeRate(focusBucket.paywallEvents, focusBucket.events);
    const avgLatency = safeDivide(focusBucket.latencySum, focusBucket.latencyCount);
    return [
      { label: 'Users', value: formatNumber(focusBucket.users.size) },
      { label: 'Sessions', value: formatNumber(focusBucket.sessions.size) },
      { label: 'Events', value: formatNumber(focusBucket.events) },
      { label: 'Success rate', value: formatPercent(successRate) },
      { label: 'Paywall rate', value: formatPercent(paywallRate) },
      { label: 'Avg latency', value: focusBucket.latencyCount ? `${Math.round(avgLatency)} ms` : 'n/a' },
    ];
  }, [focusBucket]);

  const handlePresetRange = (days: number) => setRange(buildPresetRange(days));
  const clearFilters = () => setFilters(defaultFilters);
  const zoomToDay = (day: string) => setRange({ start: day, end: day });
  const handleFilterSelect = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? '' : value }));
  };

  const dailyEventsChange = useMemo(() => findChangeExtremes(dailyEventsSeries), [dailyEventsSeries]);
  const peakEvents = useMemo(() => findPeak(dailyBuckets, (bucket) => bucket.events), [dailyBuckets]);
  const peakUsers = useMemo(() => findPeak(dailyBuckets, (bucket) => bucket.users.size), [dailyBuckets]);
  const peakLatency = useMemo(
    () => findPeak(dailyBuckets, (bucket) => safeDivide(bucket.latencySum, bucket.latencyCount)),
    [dailyBuckets]
  );
  const peakPaywallRate = useMemo(
    () => findPeak(dailyBuckets, (bucket) => safeDivide(bucket.paywallEvents, bucket.events)),
    [dailyBuckets]
  );

  const insightItems = useMemo(() => {
    const items: InsightItem[] = [];
    if (peakEvents) {
      items.push({
        title: 'Peak events',
        value: formatNumber(peakEvents.value),
        caption: `Events on ${peakEvents.day}`,
        day: peakEvents.day,
        accent: '#f4a259',
      });
    }
    if (peakUsers) {
      items.push({
        title: 'Peak users',
        value: formatNumber(peakUsers.value),
        caption: `Active users on ${peakUsers.day}`,
        day: peakUsers.day,
        accent: '#5db7a5',
      });
    }
    if (dailyEventsChange.increase) {
      items.push({
        title: 'Biggest lift',
        value: formatSignedNumber(dailyEventsChange.increase.value),
        caption: `Events vs prior day on ${dailyEventsChange.increase.day}`,
        day: dailyEventsChange.increase.day,
        accent: '#f2c14e',
      });
    }
    if (dailyEventsChange.decrease) {
      items.push({
        title: 'Biggest drop',
        value: formatSignedNumber(dailyEventsChange.decrease.value),
        caption: `Events vs prior day on ${dailyEventsChange.decrease.day}`,
        day: dailyEventsChange.decrease.day,
        accent: '#f28f79',
      });
    }
    if (peakPaywallRate && peakPaywallRate.value > 0) {
      items.push({
        title: 'Paywall spike',
        value: formatPercent(peakPaywallRate.value),
        caption: `Rate on ${peakPaywallRate.day}`,
        day: peakPaywallRate.day,
        accent: '#f28f79',
      });
    }
    if (peakLatency && peakLatency.value > 0) {
      items.push({
        title: 'Latency high',
        value: `${Math.round(peakLatency.value)} ms`,
        caption: `Avg latency on ${peakLatency.day}`,
        day: peakLatency.day,
        accent: '#f4a259',
      });
    }
    return items.slice(0, 6);
  }, [dailyEventsChange, peakEvents, peakUsers, peakPaywallRate, peakLatency]);

  const pulseStart = useMemo(() => new Date(endDate.getTime() - 6 * DAY_MS), [endDate]);
  const prevPulseEnd = useMemo(() => new Date(pulseStart.getTime() - DAY_MS), [pulseStart]);
  const prevPulseStart = useMemo(() => new Date(prevPulseEnd.getTime() - 6 * DAY_MS), [prevPulseEnd]);
  const hasPrevPulse = rangeStartDate <= prevPulseStart;
  const pulseEvents = useMemo(() => filterByDateRange(events, pulseStart, endDate), [events, pulseStart, endDate]);
  const prevPulseEvents = useMemo(
    () => (hasPrevPulse ? filterByDateRange(events, prevPulseStart, prevPulseEnd) : []),
    [events, hasPrevPulse, prevPulseStart, prevPulseEnd]
  );
  const pulseUsers = distinctCount(pulseEvents, 'user_id');
  const pulseSessions = distinctCount(pulseEvents, 'session_id');
  const pulseSuccessRate = computeSuccessRate(pulseEvents).successRate;
  const pulsePaywallRate = computeRate(
    pulseEvents.filter((event) => event.event_name === 'paywall_block').length,
    pulseEvents.length
  );
  const prevPulseUsers = hasPrevPulse ? distinctCount(prevPulseEvents, 'user_id') : 0;
  const prevPulseSessions = hasPrevPulse ? distinctCount(prevPulseEvents, 'session_id') : 0;
  const prevPulseSuccessRate = hasPrevPulse ? computeSuccessRate(prevPulseEvents).successRate : null;
  const prevPulsePaywallRate = hasPrevPulse
    ? computeRate(
        prevPulseEvents.filter((event) => event.event_name === 'paywall_block').length,
        prevPulseEvents.length
      )
    : null;

  const pulseCards = [
    {
      label: 'Active users (7d)',
      value: formatNumber(pulseUsers),
      deltaValue: hasPrevPulse ? computeDelta(pulseUsers, prevPulseUsers) : null,
      deltaText: formatDeltaPercent(hasPrevPulse ? computeDelta(pulseUsers, prevPulseUsers) : null),
    },
    {
      label: 'Sessions (7d)',
      value: formatNumber(pulseSessions),
      deltaValue: hasPrevPulse ? computeDelta(pulseSessions, prevPulseSessions) : null,
      deltaText: formatDeltaPercent(hasPrevPulse ? computeDelta(pulseSessions, prevPulseSessions) : null),
    },
    {
      label: 'Events (7d)',
      value: formatNumber(pulseEvents.length),
      deltaValue: hasPrevPulse ? computeDelta(pulseEvents.length, prevPulseEvents.length) : null,
      deltaText: formatDeltaPercent(hasPrevPulse ? computeDelta(pulseEvents.length, prevPulseEvents.length) : null),
    },
    {
      label: 'Success rate (7d)',
      value: formatPercent(pulseSuccessRate),
      deltaValue:
        pulseSuccessRate !== null && prevPulseSuccessRate !== null ? pulseSuccessRate - prevPulseSuccessRate : null,
      deltaText:
        pulseSuccessRate !== null && prevPulseSuccessRate !== null
          ? formatDeltaPoints(pulseSuccessRate - prevPulseSuccessRate)
          : 'n/a',
    },
    {
      label: 'Paywall rate (7d)',
      value: formatPercent(pulsePaywallRate),
      deltaValue:
        pulsePaywallRate !== null && prevPulsePaywallRate !== null ? pulsePaywallRate - prevPulsePaywallRate : null,
      deltaText:
        pulsePaywallRate !== null && prevPulsePaywallRate !== null
          ? formatDeltaPoints(pulsePaywallRate - prevPulsePaywallRate)
          : 'n/a',
    },
  ];

  const rangeLabel = `${range.start} to ${range.end}`;
  const openChart = (chart: ExpandedChart) => setExpandedChart(chart);
  const pulseComparisonLabel = hasPrevPulse ? 'vs prev 7d' : 'prev 7d not in range';
  const buildFocusHandler =
    (metricLabel: string, formatter?: (value: number) => string, accent?: string) =>
    (point: { label: string; value: number } | null) =>
      setFocusPoint(
        point
          ? {
              label: point.label,
              value: point.value,
              formattedValue: formatter ? formatter(point.value) : formatNumber(point.value),
              metricLabel,
              accent,
            }
          : null
      );
  const expandedStats = expandedChart ? computeSeriesStats(expandedChart.series) : null;
  const expandedFormatter = expandedChart?.formatValue ?? formatNumber;

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
          <div className="hero-card hero-chart">
            <div className="section-subtitle">Daily actives</div>
            <LineChart
              data={dailyUsersSeries}
              onExpand={() =>
                openChart({
                  title: 'Daily actives',
                  subtitle: rangeLabel,
                  series: dailyUsersSeries,
                  formatValue: formatNumber,
                })
              }
              onFocus={buildFocusHandler('Daily actives', formatNumber)}
              formatValue={formatNumber}
            />
          </div>
        </div>

        <FiltersPanel
          range={range}
          filters={filters}
          options={options}
          onRangeChange={setRange}
          onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClearFilters={clearFilters}
          activeFilters={activeFilters}
          onPresetRange={handlePresetRange}
          presets={RANGE_PRESETS}
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

        <div className="insights-grid" style={{ marginTop: '20px' }}>
          <div className="section-card focus-card">
            <div className="section-title">Focus day</div>
            <div className="section-subtitle">Hover any chart to inspect daily details</div>
            {focusPoint ? (
              <>
                <div className="focus-header">
                  <div>
                    <div className="focus-metric">{focusPoint.metricLabel}</div>
                    <div className="focus-value" style={{ color: focusPoint.accent || 'var(--accent)' }}>
                      {focusPoint.formattedValue}
                    </div>
                    <div className="focus-date">{focusPoint.label}</div>
                  </div>
                  <div className="focus-actions">
                    <button className="button button-ghost button-small" type="button" onClick={() => zoomToDay(focusPoint.label)}>
                      Zoom to day
                    </button>
                    <button className="button button-ghost button-small" type="button" onClick={() => setFocusPoint(null)}>
                      Clear
                    </button>
                  </div>
                </div>
                {focusStats.length ? (
                  <div className="focus-grid">
                    {focusStats.map((stat) => (
                      <div key={stat.label} className="focus-stat">
                        <div className="focus-stat-label">{stat.label}</div>
                        <div className="focus-stat-value">{stat.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="focus-empty">No daily bucket found for this date.</div>
                )}
              </>
            ) : (
              <div className="focus-empty">
                Hover a chart to inspect a day. The last point stays here until you clear it.
              </div>
            )}
          </div>
          <div className="section-card">
            <div className="section-title">Highlights</div>
            <div className="section-subtitle">Peaks and shifts inside the selected range</div>
            {insightItems.length ? (
              <div className="insight-list">
                {insightItems.map((item) => (
                  <div key={item.title} className="insight-item">
                    <div className="insight-value" style={{ color: item.accent || 'var(--accent)' }}>
                      {item.value}
                    </div>
                    <div className="insight-body">
                      <div className="insight-title">{item.title}</div>
                      <div className="insight-caption">{item.caption}</div>
                    </div>
                    {item.day ? (
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        onClick={() => zoomToDay(item.day)}
                      >
                        Zoom day
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="focus-empty">No highlights detected for this range yet.</div>
            )}
          </div>
        </div>

        <div className="section-card" style={{ marginTop: '20px' }}>
          <div className="section-title">Pulse</div>
          <div className="section-subtitle">Last 7 days snapshot, {pulseComparisonLabel}</div>
          <div className="kpi-grid">
            {pulseCards.map((card) => {
              const deltaClass =
                card.deltaValue === null ? 'neutral' : card.deltaValue >= 0 ? 'up' : 'down';
              return (
                <div key={card.label} className="kpi-card">
                  <div className="kpi-label">{card.label}</div>
                  <div className="kpi-value">{card.value}</div>
                  <div className={`kpi-delta ${deltaClass}`}>{card.deltaText}</div>
                </div>
              );
            })}
          </div>
        </div>

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
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="WAU (7d rolling users)"
              value={formatNumber(wau)}
              hint={wauPartial ? 'Trailing 7 days (partial)' : 'Trailing 7 days'}
              series={rollingWauSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="MAU (30d rolling users)"
              value={formatNumber(mau)}
              hint={mauPartial ? 'Trailing 30 days (partial)' : 'Trailing 30 days'}
              series={rollingMauSeries}
              accent="#f28f79"
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="Sessions"
              value={formatNumber(totalSessions)}
              hint={`Per user: ${sessionsPerUser.toFixed(2)}`}
              series={dailySessionsSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="Login users"
              value={formatNumber(loginUsers)}
              hint="Unique users with login success"
              series={dailyLoginUsersSeries}
              accent="#f2c14e"
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="Avg session duration"
              value={formatDuration(sessionStats.avgDurationSeconds)}
              hint="Based on session_id"
              series={dailySessionDurationSeries}
              accent="#f4a259"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={formatDuration}
            />
            <MetricCard
              label="Events"
              value={formatNumber(events.length)}
              hint="All events"
              series={dailyEventsSeries}
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="Events/User"
              value={eventsPerUser.toFixed(2)}
              hint="Average per user"
              series={dailyEventsPerUserSeries}
              accent="#f28f79"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={formatDecimal}
            />
            <MetricCard
              label="Sessions/User"
              value={sessionsPerUser.toFixed(2)}
              hint="Average per user"
              series={dailySessionsPerUserSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={formatDecimal}
            />
            <MetricCard
              label="Events/Session"
              value={eventsPerSession.toFixed(2)}
              hint="Average per session"
              series={dailyEventsPerSessionSeries}
              accent="#f4a259"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={formatDecimal}
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
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
            />
            <MetricCard
              label="Error rate"
              value={formatPercent(errorRate)}
              hint="All events"
              series={dailyErrorRateSeries}
              accent="#f28f79"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
            />
            <MetricCard
              label="Avg latency (ms)"
              value={avgLatency ? `${Math.round(avgLatency)} ms` : 'n/a'}
              hint="From latency_ms"
              series={dailyLatencySeries}
              accent="#f4a259"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => `${Math.round(value)} ms`}
            />
            <MetricCard
              label="Paywall rate"
              value={formatPercent(paywallRate)}
              hint="paywall_block / events"
              series={dailyPaywallRateSeries}
              accent="#f28f79"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
            />
            <MetricCard
              label="Anon share"
              value={formatPercent(anonShare)}
              hint="anon_id events / total"
              series={dailyAnonShareSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
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
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="AI events"
              value={formatNumber(aiEvents.length)}
              hint="analysis_run + validator_run + module runs"
              series={dailyAiEventsSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
            />
            <MetricCard
              label="Content share"
              value={formatPercent(contentShare)}
              hint="content / all events"
              series={dailyContentShareSeries}
              accent="#f4a259"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
            />
            <MetricCard
              label="AI share"
              value={formatPercent(aiShare)}
              hint="AI / all events"
              series={dailyAiShareSeries}
              accent="#5db7a5"
              onExpand={openChart}
              onFocus={setFocusPoint}
              formatValue={(value) => formatPercent(value)}
            />
            <MetricCard
              label="Paywall blocks"
              value={formatNumber(totalPaywallEvents)}
              hint="Event count"
              series={dailyPaywallSeries}
              accent="#f28f79"
              onExpand={openChart}
              onFocus={setFocusPoint}
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
                  hint={`module_key: ${product.key} | AI share: ${formatPercent(share)}`}
                  series={product.series}
                  accent={product.accent}
                  onExpand={openChart}
                  onFocus={setFocusPoint}
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
          <BarList
            title="Top events"
            data={eventCounts}
            onSelect={(value) => handleFilterSelect('eventName', value)}
            activeValue={filters.eventName}
            filterLabel="event"
          />
          <BarList
            title="Action mix"
            data={actionCounts}
            onSelect={(value) => handleFilterSelect('action', value)}
            activeValue={filters.action}
            filterLabel="action"
          />
          <BarList
            title="Active users by feature"
            data={featureUsage}
            onSelect={(value) => handleFilterSelect('feature', value)}
            activeValue={filters.feature}
            filterLabel="feature"
          />
          <BarList
            title="Active users by section"
            data={sectionUsage}
            onSelect={(value) => handleFilterSelect('section', value)}
            activeValue={filters.section}
            filterLabel="section"
          />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Plans & subscription</div>
          <div className="section-subtitle">Access distribution and billing</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList
            title="Active users by plan"
            data={planUsage}
            onSelect={(value) => handleFilterSelect('plan', value)}
            activeValue={filters.plan}
            filterLabel="plan"
          />
          <BarList
            title="Active users by status"
            data={subscriptionStatusUsage}
            onSelect={(value) => handleFilterSelect('subscriptionStatus', value)}
            activeValue={filters.subscriptionStatus}
            filterLabel="status"
          />
          <BarList
            title="Active users by billing period"
            data={billingPeriodUsage}
            onSelect={(value) => handleFilterSelect('billingPeriod', value)}
            activeValue={filters.billingPeriod}
            filterLabel="billing period"
          />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Traffic & attribution</div>
          <div className="section-subtitle">Routes, landing pages, and UTM parameters</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList
            title="Top routes"
            data={routeCounts}
            onSelect={(value) => handleFilterSelect('route', value)}
            activeValue={filters.route}
            filterLabel="route"
          />
          <BarList
            title="Landing pages"
            data={landingPages}
            onSelect={(value) => handleFilterSelect('landingPage', value)}
            activeValue={filters.landingPage}
            filterLabel="landing page"
          />
          <BarList
            title="Referrers"
            data={referrers}
            onSelect={(value) => handleFilterSelect('referrer', value)}
            activeValue={filters.referrer}
            filterLabel="referrer"
          />
          <UtmCard
            items={[
              { key: 'utmSource', label: 'Source', data: utmSources, activeValue: filters.utmSource },
              { key: 'utmMedium', label: 'Medium', data: utmMediums, activeValue: filters.utmMedium },
              { key: 'utmCampaign', label: 'Campaign', data: utmCampaigns, activeValue: filters.utmCampaign },
              { key: 'utmTerm', label: 'Term', data: utmTerms, activeValue: filters.utmTerm },
              { key: 'utmContent', label: 'Content', data: utmContents, activeValue: filters.utmContent },
            ]}
            onSelect={handleFilterSelect}
          />
        </div>

        <div style={{ marginTop: '28px' }}>
          <div className="section-title">Devices & platform</div>
          <div className="section-subtitle">Distribution by device, OS, and browser</div>
        </div>
        <div className="section-grid" style={{ marginTop: '12px' }}>
          <BarList
            title="Device type"
            data={deviceUsage}
            onSelect={(value) => handleFilterSelect('deviceType', value)}
            activeValue={filters.deviceType}
            filterLabel="device"
          />
          <BarList
            title="OS"
            data={osUsage}
            onSelect={(value) => handleFilterSelect('os', value)}
            activeValue={filters.os}
            filterLabel="OS"
          />
          <BarList
            title="Browser"
            data={browserUsage}
            onSelect={(value) => handleFilterSelect('browser', value)}
            activeValue={filters.browser}
            filterLabel="browser"
          />
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
                  formatValue: formatNumber,
                })
              }
              onFocus={buildFocusHandler('Content events', formatNumber, '#f4a259')}
              formatValue={formatNumber}
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
                  formatValue: formatNumber,
                })
              }
              onFocus={buildFocusHandler('AI events', formatNumber, '#5db7a5')}
              formatValue={formatNumber}
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
            {expandedStats ? (
              <div className="chart-stats">
                <div className="chart-stat">
                  <div className="chart-stat-label">Avg</div>
                  <div className="chart-stat-value">{expandedFormatter(expandedStats.avg)}</div>
                </div>
                <div className="chart-stat">
                  <div className="chart-stat-label">Min</div>
                  <div className="chart-stat-value">{expandedFormatter(expandedStats.min.value)}</div>
                  <div className="chart-stat-meta">{expandedStats.min.label}</div>
                </div>
                <div className="chart-stat">
                  <div className="chart-stat-label">Max</div>
                  <div className="chart-stat-value">{expandedFormatter(expandedStats.max.value)}</div>
                  <div className="chart-stat-meta">{expandedStats.max.label}</div>
                </div>
              </div>
            ) : null}
            <LineChart
              data={expandedChart.series}
              accent={expandedChart.accent}
              formatValue={expandedChart.formatValue}
              onFocus={buildFocusHandler(expandedChart.title, expandedChart.formatValue, expandedChart.accent)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
