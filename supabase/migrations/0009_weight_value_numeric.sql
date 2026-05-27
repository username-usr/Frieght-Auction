-- Migration 0009: Change weight_value from integer to numeric
--
-- The new-load form in Part C accepts decimal weight values (e.g., 12.5
-- kg, 200.75 liters). The existing weight_value column is integer (it
-- was renamed from weight_kg in 0008 without a type change). Change to
-- numeric to match quantity_value and allow decimals.
--
-- The CHECK constraint (weight_value > 0) is preserved automatically;
-- numeric > 0 works the same as integer > 0.
--
-- Idempotent against partial application: ALTER TYPE is safe to re-run
-- if the column is already numeric.

alter table loads
  alter column weight_value type numeric using weight_value::numeric;
