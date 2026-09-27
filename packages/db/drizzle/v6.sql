ALTER TABLE public.pricing_tier_rules
  RENAME COLUMN point_multiplier_bps TO point_markup_bps;
--> statement-breakpoint
ALTER TABLE public.pricing_tier_rules
  DROP CONSTRAINT pricing_tier_rules_point_multiplier_ck;
--> statement-breakpoint
UPDATE public.pricing_tier_rules
SET point_markup_bps = CASE
  WHEN updated_by IS NULL AND point_markup_bps = CASE tier
    WHEN 'retail' THEN 10000
    WHEN 'bronze' THEN 9000
    WHEN 'silver' THEN 8000
    WHEN 'gold' THEN 7000
  END THEN publication_markup_bps
  ELSE point_markup_bps - 10000
END;
--> statement-breakpoint
ALTER TABLE public.pricing_tier_rules
  ADD CONSTRAINT pricing_tier_rules_point_markup_ck
  CHECK (point_markup_bps >= -10000 AND point_markup_bps <= 100000);
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v6')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
