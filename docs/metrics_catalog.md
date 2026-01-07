# Metrics catalog

This list is derived from `usage_events` and is grouped by dashboard sections.

## Overview
- DAU / WAU / MAU (distinct user_id per day/week/month)
- Stickiness (DAU / MAU)
- Active users by plan and subscription_status
- Sessions total, sessions per user
- Avg session duration (based on session_id)
- Events per user, actions per session

## Acquisition
- Sessions by utm_source / utm_medium / utm_campaign
- Landing page distribution
- New vs returning users
- Conversion from landing to key event

## Activation
- Time to first key event (signup_complete -> first analysis_run)
- Users who reached key event within N days
- Activation funnel (session_start -> signup_complete -> analysis_run)

## Engagement
- Feature usage (distinct users by feature)
- Event usage (top event_name)
- Recency (active in last 1/7/30 days)
- Repeat usage (users with N+ sessions)

## Retention
- Cohort retention D1 / D7 / D30
- Reactivation rate
- Churn (no activity in trailing window)

## Monetization
- Trial to paid conversion
- Upgrade / downgrade events
- Subscription cancel rate
- Paywall block rate

## Research + content
- Report views, downloads, unique users
- Content views, downloads
- Search -> content view conversion
- Top report_id / content_id by engagement

## AI modules
- analysis_run volume by feature
- Success rate by model or module
- Avg latency_ms
- Error rate and top error_code

## IAlocador
- portfolio_create / update / delete
- optimizer_run volume and success rate
- portfolio_simulate usage

## Tech + quality
- API error rate
- Latency_ms percentiles
- Data freshness (event_ts vs ingested_at)

## Segmentations (dimensions)
- plan
- subscription_status
- billing_period
- feature
- event_name
- route
- section
- utm_source / utm_medium / utm_campaign / utm_term / utm_content
- device_type
- os
- browser
- day / week / month
