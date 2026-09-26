CREATE TABLE public.answerbit_read_cache (
  cache_key varchar(64) PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  brand_id varchar(128),
  operation varchar(128) NOT NULL,
  response jsonb NOT NULL,
  response_hash varchar(64) NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX answerbit_read_cache_expiry_idx ON public.answerbit_read_cache (expires_at);
--> statement-breakpoint
ALTER TABLE public.answerbit_read_cache ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_organization_isolation ON public.answerbit_read_cache
  TO geo_tenant_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.answerbit_read_cache
  TO geo_platform_app USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answerbit_read_cache TO geo_tenant_app, geo_platform_app;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v5')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
