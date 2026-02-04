import { useMemo, useState } from 'react';
import { useTerminalEvents } from '../hooks/useTerminalEvents';
import {
  buildModeDistribution,
  buildTerminalBarList,
  buildTerminalErrorList,
  buildTickerDistribution,
  computeAgentPhaseStats,
  computeErrorRateByPhase,
  computeTerminalStats,
  groupTerminalDaily,
} from '../lib/metrics';
import type { BarDatum, DateRange, TerminalFilters } from '../types';

// ============================================================================
// Helpers
// ============================================================================

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const formatPercent = (value: number | null) =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
};

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const getDefaultRange = (): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { start: toDateKey(start), end: toDateKey(end) };
};

const DAY_MS = 24 * 60 * 60 * 1000;

const buildPresetRange = (days: number): DateRange => {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { start: toDateKey(start), end: toDateKey(end) };
};

const EMPTY_FILTERS: TerminalFilters = {
  ticker: '',
  responseMode: '',
  eventName: '',
  phase: '',
  deviceType: '',
  browser: '',
  os: '',
};

// ============================================================================
// Components
// ============================================================================

const StatCard = ({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: string;
}) => (
  <div className="stat-card">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={accent ? { color: accent } : undefined}>
      {value}
    </div>
    {subtitle && <div className="stat-subtitle">{subtitle}</div>}
  </div>
);

const BarChart = ({
  data,
  title,
  maxBars = 10,
  accent = '#5db7a5',
}: {
  data: BarDatum[];
  title: string;
  maxBars?: number;
  accent?: string;
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const displayData = data.slice(0, maxBars);

  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <div className="bar-chart">
        {displayData.map((item, idx) => (
          <div key={item.label + idx} className="bar-row">
            <div className="bar-label" title={item.title || item.label}>
              {item.label}
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
            <div className="bar-value">{formatNumber(item.value)}</div>
          </div>
        ))}
        {displayData.length === 0 && (
          <div className="empty-state">No data available</div>
        )}
      </div>
    </div>
  );
};

const LineChart = ({
  data,
  title,
  accent = '#5db7a5',
}: {
  data: { day: string; value: number }[];
  title: string;
  accent?: string;
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  if (data.length === 0) {
    return (
      <div className="chart-card">
        <div className="chart-title">{title}</div>
        <div className="empty-state">No data available</div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <div className="line-chart">
        <svg viewBox={`0 0 ${data.length * 30} 100`} preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={accent}
            strokeWidth="2"
            points={data
              .map((d, i) => `${i * 30 + 15},${100 - (d.value / maxValue) * 90}`)
              .join(' ')}
          />
          {data.map((d, i) => (
            <circle
              key={d.day}
              cx={i * 30 + 15}
              cy={100 - (d.value / maxValue) * 90}
              r="3"
              fill={accent}
            />
          ))}
        </svg>
        <div className="line-chart-labels">
          {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map((d) => (
            <span key={d.day}>{d.day.slice(5)}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

const FilterSelect = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) => (
  <div className="filter-group">
    <label className="filter-label">{label}</label>
    <select
      className="filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const TerminalDashboard = () => {
  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [filters, setFilters] = useState<TerminalFilters>(EMPTY_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);

  const { events, loading, error, truncated } = useTerminalEvents(
    range,
    filters,
    true,
    refreshKey
  );

  // Compute metrics
  const stats = useMemo(() => computeTerminalStats(events), [events]);
  const dailyData = useMemo(() => groupTerminalDaily(events), [events]);
  const tickerDistribution = useMemo(() => buildTickerDistribution(events, 10), [events]);
  const modeDistribution = useMemo(() => buildModeDistribution(events), [events]);
  const phaseStats = useMemo(() => computeAgentPhaseStats(events), [events]);
  const errorList = useMemo(() => buildTerminalErrorList(events, 10), [events]);
  const errorByPhase = useMemo(() => computeErrorRateByPhase(events), [events]);
  const eventNameDist = useMemo(
    () => buildTerminalBarList(events, 'event_name', 10),
    [events]
  );
  const deviceDist = useMemo(
    () => buildTerminalBarList(events, 'device_type', 6),
    [events]
  );
  const browserDist = useMemo(
    () => buildTerminalBarList(events, 'browser', 6),
    [events]
  );

  // Extract unique values for filters
  const uniqueTickers = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => e.ticker && set.add(e.ticker));
    return Array.from(set).sort();
  }, [events]);

  const uniqueModes = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => e.response_mode && set.add(e.response_mode));
    return Array.from(set).sort();
  }, [events]);

  const uniqueEventNames = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => e.event_name && set.add(e.event_name));
    return Array.from(set).sort();
  }, [events]);

  // Chart data
  const messagesPerDay = useMemo(
    () => dailyData.map((d) => ({ day: d.day, value: d.messages })),
    [dailyData]
  );

  const usersPerDay = useMemo(
    () => dailyData.map((d) => ({ day: d.day, value: d.users })),
    [dailyData]
  );

  const handlePreset = (days: number) => {
    setRange(buildPresetRange(days));
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const updateFilter = (key: keyof TerminalFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="terminal-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1>Terminal Analytics</h1>
        <div className="header-actions">
          <button onClick={handleRefresh} className="refresh-btn" disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Date Range & Filters */}
      <div className="filters-section">
        <div className="date-range-controls">
          <div className="preset-buttons">
            <button onClick={() => handlePreset(7)} className="preset-btn">
              7d
            </button>
            <button onClick={() => handlePreset(14)} className="preset-btn">
              14d
            </button>
            <button onClick={() => handlePreset(30)} className="preset-btn">
              30d
            </button>
            <button onClick={() => handlePreset(90)} className="preset-btn">
              90d
            </button>
          </div>
          <div className="date-inputs">
            <input
              type="date"
              value={range.start}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="date-input"
            />
            <span>to</span>
            <input
              type="date"
              value={range.end}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="date-input"
            />
          </div>
        </div>

        <div className="filter-controls">
          <FilterSelect
            label="Ticker"
            value={filters.ticker}
            options={uniqueTickers}
            onChange={(v) => updateFilter('ticker', v)}
          />
          <FilterSelect
            label="Mode"
            value={filters.responseMode}
            options={uniqueModes}
            onChange={(v) => updateFilter('responseMode', v)}
          />
          <FilterSelect
            label="Event"
            value={filters.eventName}
            options={uniqueEventNames}
            onChange={(v) => updateFilter('eventName', v)}
          />
        </div>
      </div>

      {/* Status Messages */}
      {error && <div className="error-banner">Error: {error}</div>}
      {truncated && (
        <div className="warning-banner">
          Results truncated to 200k events. Use filters to narrow down.
        </div>
      )}

      {/* Overview Stats */}
      <section className="section">
        <h2 className="section-title">Overview</h2>
        <div className="stats-grid">
          <StatCard
            label="Total Messages"
            value={formatNumber(stats.totalMessages)}
            accent="#5db7a5"
          />
          <StatCard
            label="Unique Users"
            value={formatNumber(stats.uniqueUsers)}
            accent="#f4a259"
          />
          <StatCard
            label="Unique Tickers"
            value={formatNumber(stats.uniqueTickers)}
            accent="#5d93b7"
          />
          <StatCard
            label="Avg Response Time"
            value={formatDuration(stats.avgDurationMs)}
            subtitle={`${formatNumber(stats.uniqueSessions)} sessions`}
            accent="#b75d93"
          />
          <StatCard
            label="Success Rate"
            value={formatPercent(stats.successRate)}
            accent={stats.successRate >= 0.95 ? '#5db7a5' : '#f28f79'}
          />
          <StatCard
            label="Total Events"
            value={formatNumber(events.length)}
            accent="#9b5db7"
          />
        </div>
      </section>

      {/* Message Distribution */}
      <section className="section">
        <h2 className="section-title">Message Distribution</h2>
        <div className="charts-grid">
          <LineChart
            data={messagesPerDay}
            title="Messages per Day"
            accent="#5db7a5"
          />
          <LineChart
            data={usersPerDay}
            title="Active Users per Day"
            accent="#f4a259"
          />
          <BarChart
            data={tickerDistribution}
            title="Top Tickers"
            accent="#5d93b7"
          />
          <BarChart
            data={modeDistribution}
            title="Response Modes"
            accent="#b75d93"
          />
        </div>
      </section>

      {/* Agent Performance */}
      <section className="section">
        <h2 className="section-title">Agent Performance</h2>
        <div className="stats-grid">
          <StatCard
            label="Planning Phase"
            value={formatDuration(phaseStats.planning.avg)}
            subtitle={`${formatNumber(phaseStats.planning.count)} plans`}
            accent="#f4a259"
          />
          <StatCard
            label="Execution Phase"
            value={formatDuration(phaseStats.execution.avg)}
            subtitle={`${formatNumber(phaseStats.execution.count)} tasks`}
            accent="#5db7a5"
          />
          <StatCard
            label="Answering Phase"
            value={formatDuration(phaseStats.answering.avg)}
            subtitle={`${formatNumber(phaseStats.answering.count)} answers`}
            accent="#5d93b7"
          />
        </div>
        <div className="charts-grid">
          <BarChart
            data={eventNameDist}
            title="Event Types"
            accent="#9b5db7"
          />
          <BarChart
            data={errorByPhase}
            title="Error Rate by Phase (%)"
            accent="#f28f79"
          />
        </div>
      </section>

      {/* Errors */}
      <section className="section">
        <h2 className="section-title">Errors</h2>
        <div className="charts-grid">
          <BarChart
            data={errorList}
            title="Top Errors"
            accent="#f28f79"
          />
        </div>
      </section>

      {/* Device & Browser */}
      <section className="section">
        <h2 className="section-title">Device & Browser</h2>
        <div className="charts-grid">
          <BarChart data={deviceDist} title="Device Types" accent="#5d93b7" />
          <BarChart data={browserDist} title="Browsers" accent="#b75d93" />
        </div>
      </section>
    </div>
  );
};

export default TerminalDashboard;
