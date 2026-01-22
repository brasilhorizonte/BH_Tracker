# Usage events catalog

This catalog follows:
- event_name in snake_case with verb at end (report_download, analysis_run)
- feature is the module name (research_reports, validador, ialocador)
- action is the stage (start | success | error)
- properties is JSON and uses snake_case keys

## Common fields

Required in every event:
- event_ts
- event_name
- feature
- action
- success (true for success, false for error, null for start)
- user_id (nullable for anon)
- session_id
- plan, subscription_status, billing_period
- route, section
- device_type, os, browser
- utm_source, utm_medium, utm_campaign, utm_term, utm_content
- properties (jsonb)

## Core session + navigation

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| session_start | core | start | landing_page | referrer, timezone, locale | fire once per session |
| session_end | core | success | duration_ms | page_count | optional, based on idle timeout |
| page_view | core | success | page_title | referrer, scroll_depth | fire on route change |

## Auth + profile

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| login | auth | start | method |  |  |
| login | auth | success | method |  |  |
| login | auth | error | method, error_code | error |  |
| signup_complete | auth | success | method | invite_code |  |
| password_reset | auth | start |  |  |  |
| password_reset | auth | success |  |  |  |
| profile_update | auth | success | field_count | fields |  |

## Billing + access

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| paywall_block | access | success | required_plan | reason |  |
| plan_view | billing | success | plan |  |  |
| checkout_start | billing | start | plan | coupon |  |
| checkout_complete | billing | success | plan | coupon, price_id |  |
| subscription_cancel | billing | success | plan | reason |  |
| subscription_change | billing | success | from_plan, to_plan |  |  |

## Research + content

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| report_view | research_reports | success | report_id | company_id, sector_id, analyst_id, report_title | report_title optional; otherwise resolve via report_catalog |
| report_download | research_reports | success | report_id | company_id, sector_id, analyst_id, report_title | report_title optional; otherwise resolve via report_catalog |
| content_view | research_content | success | content_id | company_id, sector_id, analyst_id, content_name | content_name for file/video name |
| content_download | research_content | success | content_id | content_name | content_name for file/video name |
| filter_apply | research | success | filter_count | filters |  |
| search_run | research | start | query |  |  |
| search_run | research | success | query | result_count |  |
| search_run | research | error | query, error_code | error |  |

## IAnalista (AI)

Notes:
- The database normalizes `analysis_run` with feature `qualitativo`/`valuai` into `qualitativo_run`/`valuai_run`.
- Keep `feature` aligned to the module name even when the event_name is normalized.

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| analysis_run | validador | start | ticker | prompt_length |  |
| analysis_run | validador | success | ticker | model, latency_ms, token_count |  |
| analysis_run | validador | error | ticker, error_code | error, latency_ms |  |
| qualitativo_run | qualitativo | start | ticker |  |  |
| qualitativo_run | qualitativo | success | ticker | score, latency_ms |  |
| qualitativo_run | qualitativo | error | ticker, error_code |  |  |
| valuai_run | valuai | start | ticker |  |  |
| valuai_run | valuai | success | ticker | valuation, latency_ms |  |
| valuai_run | valuai | error | ticker, error_code |  |  |
| validator_run | validador | success | ticker | issues_count |  |

## IAlocador

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| portfolio_create | portfolio | success | portfolio_id | asset_count |  |
| portfolio_update | portfolio | success | portfolio_id | asset_count, change_count |  |
| portfolio_delete | portfolio | success | portfolio_id |  |  |
| portfolio_simulate | portfolio | success | portfolio_id | mode, asset_count |  |
| portfolio_export | portfolio | success | portfolio_id | target |  |
| optimizer_run | optimization | start | portfolio_id | constraints |  |
| optimizer_run | optimization | success | portfolio_id | latency_ms, sharpe |  |
| optimizer_run | optimization | error | portfolio_id, error_code | error |  |
| compare_add | comparator | success | ticker |  |  |
| compare_remove | comparator | success | ticker |  |  |
| watchlist_add | watchlist | success | ticker |  |  |
| watchlist_remove | watchlist | success | ticker |  |  |

## Admin + ops

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| admin_user_update | admin | success | target_user_id | fields |  |
| admin_user_disable | admin | success | target_user_id | reason |  |
| content_publish | admin | success | content_id |  |  |
| report_upload | admin | success | report_id | file_size |  |
| report_delete | admin | success | report_id |  |  |

## Tech + reliability

| event_name | feature | action | properties (required) | properties (optional) | notes |
| --- | --- | --- | --- | --- | --- |
| api_call | tech | start | endpoint | method |  |
| api_call | tech | success | endpoint, latency_ms | status_code |  |
| api_call | tech | error | endpoint, error_code | latency_ms, status_code |  |
| data_refresh | tech | success | source | rows, latency_ms |  |
