-- =====================================================================
-- Migración 002 — Tipo de transacción (Clase/Préstamo/Servicio/Otro) y
-- marca de entrada (check-in) para el modelo entrada/salida por minuto.
--
-- "Abierta" (checked-in, sin salida) = end_min IS NULL. Las columnas
-- generadas (duration_min, price_effective, professor_salary) ya devuelven
-- NULL en ese caso, así que no se requiere más DDL para representar la sesión
-- abierta; solo añadimos la etiqueta de tipo y el timestamp de entrada.
-- =====================================================================

ALTER TABLE transactions ADD COLUMN tx_type TEXT NOT NULL DEFAULT 'service'
  CHECK (tx_type IN ('class','loan','service','other'));

ALTER TABLE transactions ADD COLUMN check_in_at TEXT;

-- Etiquetar lo ya importado: las filas marcadas como clase pasan a 'class';
-- el resto queda como 'service' (valor por defecto).
UPDATE transactions SET tx_type='class' WHERE is_class=1;
