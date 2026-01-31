# CLAUDE.md - BH Tracker

Este arquivo fornece contexto para o Claude Code ao trabalhar com o BH Tracker.

---

## Visão Geral

Dashboard de analytics que consome dados da tabela `usage_events` do Supabase.
Exibe métricas de uso, funis de conversão e segmentações para a plataforma Brasil Horizonte.

---

## Stack

- **Frontend:** React + Vite + TypeScript
- **Estilo:** CSS vanilla (sem Tailwind)
- **Backend:** Supabase (leitura via anon key + RLS)
- **Auth:** Supabase Auth (admin-only)

---

## Estrutura

```
src/
├── App.tsx              # Auth flow + shell
├── main.tsx             # Entry point
├── types.ts             # Tipos compartilhados
├── lib/
│   ├── supabase.ts      # Cliente Supabase
│   └── metrics.ts       # Funções de cálculo de métricas
├── hooks/
│   └── useUsageEvents.ts # Hook para buscar eventos
└── components/
    └── Dashboard.tsx    # Dashboard principal (cards, gráficos, tabelas)

docs/
├── event_catalog.md     # Catálogo de eventos e propriedades
├── metrics_catalog.md   # Catálogo de métricas e segmentações
└── query_templates.md   # Templates SQL para análises

sql/
└── usage_events.sql     # DDL da tabela + RLS policies
```

---

## Comandos

```bash
npm install      # Instalar dependências
npm run dev      # Dev server (localhost:5173)
npm run build    # Build para dist/
npm run preview  # Preview do build
```

---

## Ambiente

Criar `.env.local` com:

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

O dashboard requer login como admin (RLS policy `is_admin()`).

---

## Fonte de Dados

A tabela `usage_events` é populada pelo projeto **dashbrasilhorizonte**.

### Eventos Implementados (21 eventos)

| Categoria | Eventos |
|-----------|---------|
| **Core** | `page_view`, `session_start`, `feature_open` |
| **Auth** | `auth_login`, `auth_logout`, `auth_signup_start`, `auth_signup_complete`, `auth_password_reset_request`, `auth_password_reset_complete` |
| **Billing** | `checkout_start`, `checkout_complete`, `subscription_start`, `subscription_cancel`, `payment_succeeded`, `payment_failed` |
| **Research** | `report_view`, `report_download`, `asset_download` |
| **IA** | `analysis_run` (validador, qualitativo_ai) |

### Campos Principais

- `event_ts` - Timestamp do evento
- `event_name` - Nome do evento (snake_case)
- `feature` - Módulo (core, auth, billing, validador, etc.)
- `action` - Estágio (start, success, error)
- `user_id` - ID do usuário
- `session_id` - ID da sessão
- `plan`, `subscription_status`, `billing_period` - Dados de assinatura
- `properties` - JSON com dados customizados

---

## Métricas Principais

O Dashboard exibe:

1. **Overview Cards**
   - Total de eventos
   - Usuários únicos
   - Sessões
   - Taxa de sucesso

2. **Event Distribution**
   - Eventos por tipo
   - Eventos por feature
   - Eventos por dia

3. **User Segmentation**
   - Por plano
   - Por device
   - Por UTM source

4. **Funnel Analysis**
   - Signup → Login → Feature → Subscription

---

## Convenções

### Nomenclatura de Eventos

```
{entidade}_{ação}
```

Exemplos:
- `report_view` - Visualização de relatório
- `analysis_run` - Execução de análise
- `subscription_start` - Início de assinatura

### Properties

- Chaves em `snake_case`
- `*_id` para identificadores
- `*_count` para contagens
- `*_ms` para durações em milissegundos

---

## Documentação

- **Catálogo de eventos:** `docs/event_catalog.md`
- **Catálogo de métricas:** `docs/metrics_catalog.md`
- **Templates SQL:** `docs/query_templates.md`

---

## Relacionamento com dashbrasilhorizonte

O BH_Tracker **lê** dados que o dashbrasilhorizonte **escreve**.

```
dashbrasilhorizonte          BH_Tracker
       │                          │
       │  trackUsageEvent()       │
       ▼                          │
┌─────────────────┐               │
│  usage_events   │◄──────────────┘
│   (Supabase)    │    SELECT via RLS
└─────────────────┘
```

Qualquer novo evento implementado no dashbrasilhorizonte aparecerá automaticamente no BH_Tracker.
