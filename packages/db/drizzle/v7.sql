ALTER TABLE public.pricing_tier_rules
  DROP CONSTRAINT pricing_tier_rules_point_markup_ck;
--> statement-breakpoint
ALTER TABLE public.article_generation_jobs
  ADD COLUMN pricing_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE public.pricing_tier_rules
  ADD CONSTRAINT pricing_tier_rules_point_markup_ck
  CHECK (point_markup_bps >= -10000 AND point_markup_bps <= 100000);
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v7')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
