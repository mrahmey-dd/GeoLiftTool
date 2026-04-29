-- Development seed data
-- Runs after schema.sql on first container start.
-- Safe to re-run (all inserts use ON CONFLICT DO NOTHING).

-- ── Seed organisation ─────────────────────────────────────────────
INSERT INTO organisations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Acme Brand Co.', 'acme')
ON CONFLICT DO NOTHING;

-- ── Seed user ─────────────────────────────────────────────────────
INSERT INTO users (id, org_id, email, name, role)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'analyst@acme.com',
  'Demo Analyst',
  'admin'
)
ON CONFLICT DO NOTHING;

-- ── Seed experiments (mirrors MOCK_EXPS in GeoLiftApp.jsx) ────────

INSERT INTO experiments (
  id, org_id, name, kpi, test_type, geo_level, data_granularity,
  channel, pre_start, test_start, test_end, spend, status,
  dataset_id, selection_id, power_id, result_id, bp_score
) VALUES
-- Complete single-cell
(
  'exp-00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Q4 Meta Paid Social — US DMA Lift Test',
  'Revenue', 'single', 'DMA', 'daily', 'Meta',
  '2024-09-01', '2024-11-03', '2024-11-23',
  325000, 'complete',
  'ds-aaa1', 'sel-bbb2', 'pow-ccc3', 'res-ddd4', 13
),
-- Complete multi-cell
(
  'exp-00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Q4 Budget Calibration — Multi-Cell DMA',
  'Revenue', 'multi', 'DMA', 'daily', 'Meta',
  '2024-09-01', '2024-11-03', '2024-11-23',
  650000, 'complete',
  'ds-aaa2', 'sel-bbb3', 'pow-ccc4', 'res-ddd5', 14
),
-- Active single-cell
(
  'exp-00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Q1 Brand Awareness — Social Upper Funnel',
  'Reach', 'single', 'City', 'daily', 'Meta',
  '2024-11-01', '2025-01-06', '2025-02-02',
  210000, 'active',
  'ds-aaa3', 'sel-bbb4', 'pow-ccc5', NULL, 12
),
-- Active multi-cell
(
  'exp-00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'TikTok vs Meta Incrementality — Apparel',
  'Conversions', 'multi', 'DMA', 'daily', 'Multi-Channel',
  '2024-10-15', '2025-01-13', '2025-02-09',
  480000, 'active',
  'ds-aaa4', 'sel-bbb5', 'pow-ccc6', NULL, 13
),
-- Draft single-cell
(
  'exp-00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'Q2 Spring Campaign — City-Level Test',
  'Orders', 'single', 'City', 'daily', 'Meta',
  '2025-01-01', '2025-03-17', '2025-04-13',
  175000, 'draft',
  'ds-aaa5', NULL, NULL, NULL, 8
),
-- Draft multi-cell
(
  'exp-00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000001',
  'EU Expansion — Germany & France Markets',
  'Revenue', 'multi', 'Region', 'daily', 'Meta',
  '2024-12-01', '2025-03-03', '2025-03-30',
  290000, 'draft',
  NULL, NULL, NULL, NULL, 5
)
ON CONFLICT DO NOTHING;

-- ── Seed cells ────────────────────────────────────────────────────
INSERT INTO experiment_cells (experiment_id, label, channel, spend, color) VALUES
('exp-00000000-0000-0000-0000-000000000001', 'Treatment',       'Meta',            325000, '#00c9a7'),
('exp-00000000-0000-0000-0000-000000000002', 'Cell A — $150K',  'Meta',            150000, '#00c9a7'),
('exp-00000000-0000-0000-0000-000000000002', 'Cell B — $325K',  'Meta',            325000, '#f5a623'),
('exp-00000000-0000-0000-0000-000000000002', 'Cell C — $500K',  'Meta',            500000, '#a78bfa'),
('exp-00000000-0000-0000-0000-000000000003', 'Treatment',       'Meta',            210000, '#00c9a7'),
('exp-00000000-0000-0000-0000-000000000004', 'Meta Only',       'Meta',            160000, '#4e9eff'),
('exp-00000000-0000-0000-0000-000000000004', 'TikTok Only',     'TikTok',          160000, '#a78bfa'),
('exp-00000000-0000-0000-0000-000000000004', 'Meta + TikTok',   'Multi-Channel',   160000, '#f5a623'),
('exp-00000000-0000-0000-0000-000000000005', 'Treatment',       'Meta',            175000, '#00c9a7'),
('exp-00000000-0000-0000-0000-000000000006', 'Germany',         'Meta',            145000, '#00c9a7'),
('exp-00000000-0000-0000-0000-000000000006', 'France',          'Meta',            145000, '#f5a623')
ON CONFLICT DO NOTHING;
