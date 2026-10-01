ALTER TABLE "publication_orders" ADD COLUMN "provider_action" jsonb;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v12')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
