import { useMemo, useState } from 'react';
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
  groupDaily,
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

const getDefaultRange = (): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const toKey = (date: Date) => date.toISOString().slice(0, 10);
  return { start: toKey(start), end: toKey(end) };
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

const LineChart = ({ data, accent = '#f4a259' }: { data: { label: string; value: number }[]; accent?: string }) => {
  if (!data.length) {
    return <div className="chart-wrap">No data in range</div>;
  }
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const points = data.map((d, index) => {
    const x = (index / Math.max(1, data.length - 1)) * 100;
    const y = 100 - (d.value / max) * 100;
    return `${x},${y}`;
  });
  const path = points.join(' ');

  return (
    <div className="chart-wrap">
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
      <div className="hero-metadata" style={{ marginTop: '8px' }}>
        <span className="meta-pill">{data[0]?.label}</span>
        <span className="meta-pill">{data[data.length - 1]?.label}</span>
      </div>
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

const KpiCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="kpi-card">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {hint ? <div className="kpi-delta">{hint}</div> : null}
  </div>
);

const FiltersPanel = ({
  range,
  filters,
  options,
  onRangeChange,
  onFilterChange,
}: {
  range: DateRange;
  filters: Filters;
  options: Record<string, string[]>;
  onRangeChange: (next: DateRange) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
}) => (
  <div className="section-card">
    <div className="section-title">Filters</div>
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
    </div>
  </div>
);

export default function Dashboard() {
  const [range, setRange] = useState<DateRange>(() => getDefaultRange());
  const [filters, setFilters] = useState<Filters>({
    plan: '',
    subscriptionStatus: '',
    billingPeriod: '',
    route: '',
    section: '',
    feature: '',
    eventName: '',
    deviceType: '',
    os: '',
    browser: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
  });

  const { events, loading, error, truncated } = useUsageEvents(range, filters, true);

  const dailySeries = useMemo(() => groupDaily(events), [events]);
  const dailyChart = useMemo(
    () => dailySeries.map((point) => ({ label: point.day, value: point.users })),
    [dailySeries]
  );

  const endDate = useMemo(() => new Date(`${range.end}T23:59:59.999Z`), [range.end]);
  const rangeStartDate = useMemo(() => new Date(`${range.start}T00:00:00.000Z`), [range.start]);
  const last7Start = useMemo(() => new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000), [endDate]);
  const last30Start = useMemo(() => new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000), [endDate]);
  const wauPartial = rangeStartDate > last7Start;
  const mauPartial = rangeStartDate > last30Start;

  const dauDayKey = endDate.toISOString().slice(0, 10);
  const dauPoint = dailySeries.find((point) => point.day === dauDayKey);
  const dau = dauPoint?.users || 0;
  const wau = distinctCount(filterByDateRange(events, last7Start, endDate), 'user_id');
  const mau = distinctCount(filterByDateRange(events, last30Start, endDate), 'user_id');
  const totalUsers = distinctCount(events, 'user_id');

  const sessionStats = computeSessionStats(events);
  const sessionsPerUser = totalUsers ? sessionStats.sessionCount / totalUsers : 0;

  const successRate = computeSuccessRate(events).successRate;
  const avgLatency = extractNumericProperty(events, 'latency_ms');

  const featureUsage = buildDistinctUserBarList(events, 'feature', 6);
  const planUsage = buildDistinctUserBarList(events, 'plan', 6);
  const eventCounts = buildBarList(events, 'event_name', 6);
  const routeCounts = buildBarList(events, 'route', 6);
  const utmSources = buildBarList(events, 'utm_source', 5);
  const errorCodes = extractTopProperty(events, 'error_code', 5);

  const contentEvents = events.filter((event) =>
    ['report_view', 'report_download', 'content_view', 'content_download'].includes(event.event_name)
  );
  const aiEvents = events.filter((event) =>
    ['analysis_run', 'validator_run', 'qualitativo_run'].includes(event.event_name)
  );

  const aiSuccessRate = computeSuccessRate(aiEvents).successRate;
  const aiTopModules = buildBarList(aiEvents, 'feature', 5);

  const options = useMemo(
    () => ({
      plan: getUniqueValues(events, 'plan'),
      subscriptionStatus: getUniqueValues(events, 'subscription_status'),
      billingPeriod: getUniqueValues(events, 'billing_period'),
      route: getUniqueValues(events, 'route'),
      section: getUniqueValues(events, 'section'),
      feature: getUniqueValues(events, 'feature'),
      eventName: buildEventOptions(events),
      deviceType: getUniqueValues(events, 'device_type'),
      os: getUniqueValues(events, 'os'),
      browser: getUniqueValues(events, 'browser'),
      utmSource: getUniqueValues(events, 'utm_source'),
      utmMedium: getUniqueValues(events, 'utm_medium'),
      utmCampaign: getUniqueValues(events, 'utm_campaign'),
    }),
    [events]
  );

  const rangeLabel = `${range.start} to ${range.end}`;

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
            <LineChart data={dailyChart} />
          </div>
        </div>

        <FiltersPanel
          range={range}
          filters={filters}
          options={options}
          onRangeChange={setRange}
          onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        />

        {loading ? <div className="loading">Loading usage events</div> : null}
        {truncated ? (
          <div className="notice">
            Too many rows in range. Narrow the filters to avoid partial metrics.
          </div>
        ) : null}
        {error ? <div className="notice">{error}</div> : null}

        <div className="kpi-grid">
          <KpiCard label="DAU" value={formatNumber(dau)} hint="Last day" />
          <KpiCard label="WAU" value={formatNumber(wau)} hint={wauPartial ? 'Trailing 7 days (partial)' : 'Trailing 7 days'} />
          <KpiCard label="MAU" value={formatNumber(mau)} hint={mauPartial ? 'Trailing 30 days (partial)' : 'Trailing 30 days'} />
          <KpiCard label="Sessions" value={formatNumber(sessionStats.sessionCount)} hint={`Per user: ${sessionsPerUser.toFixed(2)}`} />
          <KpiCard label="Avg session" value={formatDuration(sessionStats.avgDurationSeconds)} hint="Based on session_id" />
          <KpiCard label="Success rate" value={formatPercent(successRate)} hint="All events" />
        </div>

        <div className="section-grid" style={{ marginTop: '20px' }}>
          <BarList title="Active users by feature" data={featureUsage} />
          <BarList title="Active users by plan" data={planUsage} />
          <BarList title="Top events" data={eventCounts} />
        </div>

        <div className="section-grid" style={{ marginTop: '20px' }}>
          <BarList title="Top routes" data={routeCounts} />
          <BarList title="Acquisition sources" data={utmSources} />
          <div className="section-card">
            <div className="section-title">Quality signals</div>
            <div className="section-subtitle">Latency and errors</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>Average latency</td>
                  <td>{avgLatency ? `${Math.round(avgLatency)} ms` : 'n/a'}</td>
                </tr>
                <tr>
                  <td>Error rate</td>
                  <td>{formatPercent(computeSuccessRate(events).errorRate)}</td>
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

        <div className="section-grid" style={{ marginTop: '20px' }}>
          <div className="section-card">
            <div className="section-title">Research</div>
            <div className="section-subtitle">Report and content usage</div>
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
              </tbody>
            </table>
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
              </tbody>
            </table>
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
            <div className="section-title">Segmentation snapshot</div>
            <div className="section-subtitle">Quick lens of the current range</div>
            <table className="table">
              <tbody>
                <tr>
                  <td>Distinct users</td>
                  <td>{formatNumber(totalUsers)}</td>
                </tr>
                <tr>
                  <td>Distinct sessions</td>
                  <td>{formatNumber(sessionStats.sessionCount)}</td>
                </tr>
                <tr>
                  <td>Selected filters</td>
                  <td>
                    {buildFilterLabel(filters.plan)} / {buildFilterLabel(filters.feature)} / {buildFilterLabel(filters.route)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
