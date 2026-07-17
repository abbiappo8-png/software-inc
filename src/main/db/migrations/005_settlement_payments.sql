-- Abonos (pagos parciales) de la liquidación mensual de profesores.
-- Cada abono genera además un gasto (expenses) a nombre del profesor, para que
-- el dinero salga en el balance diario — igual que en el Excel, donde el pago
-- del salario se registraba en la hoja Outcome. expense_id enlaza ese gasto
-- para poder eliminarlo junto con el abono.

CREATE TABLE settlement_payments (
  id            INTEGER PRIMARY KEY,
  professor_id  INTEGER NOT NULL REFERENCES persons(id),
  period_year   INTEGER NOT NULL,
  period_month  INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  pay_date      TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  comment       TEXT,
  expense_id    INTEGER REFERENCES expenses(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX ix_settlement_payments_period
  ON settlement_payments(professor_id, period_year, period_month);
