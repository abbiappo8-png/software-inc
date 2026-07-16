-- =====================================================================
-- Migración 003 — El salario del profesor persistido debe REDONDEAR
-- (como roundCOP/Math.round en el preview y el demo), no truncar.
-- CAST(x AS INTEGER) trunca hacia cero; para valores >= 0, CAST(x + 0.5)
-- reproduce el redondeo half-up. NULL se preserva (NULL + 0.5 = NULL).
-- =====================================================================

ALTER TABLE transactions DROP COLUMN professor_salary;

ALTER TABLE transactions ADD COLUMN professor_salary INTEGER GENERATED ALWAYS AS (
  CAST(COALESCE(price_override, price_snapshot) * COALESCE(professor_pct_snapshot, 0) + 0.5 AS INTEGER)
) VIRTUAL;
