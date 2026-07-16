-- =====================================================================
-- Migración 004 — Respuestas de Google Forms (página "Reservas Web").
-- Cada fila de la hoja publicada se guarda una sola vez (row_hash UNIQUE)
-- con su contenido completo en JSON; el estado registra la revisión.
-- =====================================================================

CREATE TABLE form_responses (
  id                 INTEGER PRIMARY KEY,
  form_key           TEXT NOT NULL,            -- clave del formulario configurado (settings google_forms)
  row_hash           TEXT NOT NULL UNIQUE,     -- sha256 de la fila -> dedupe entre sincronizaciones
  submitted_at       TEXT,                     -- Marca temporal del form (ISO), si se pudo parsear
  raw_json           TEXT NOT NULL,            -- objeto { encabezado: valor } con la fila completa
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','imported','ignored')),
  imported_person_id INTEGER REFERENCES persons(id),
  imported_tx_id     INTEGER REFERENCES transactions(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX ix_form_responses_form   ON form_responses(form_key, status);
CREATE INDEX ix_form_responses_status ON form_responses(status);
