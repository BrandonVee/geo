ALTER TABLE public.organizations ADD COLUMN service_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.organizations ADD COLUMN points_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.organizations ALTER COLUMN service_expires_at SET DEFAULT (now() + interval '1 month');
--> statement-breakpoint
ALTER TABLE public.organizations ALTER COLUMN points_expires_at SET DEFAULT (now() + interval '1 year');
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v8')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
