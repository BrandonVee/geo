CREATE TABLE "article_tracking_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_binding_id" uuid NOT NULL,
	"brand_id" varchar(128) NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"request_payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'submitting' NOT NULL,
	"points" integer NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"article_id" varchar(128),
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_tracking_submissions_status_ck" CHECK ("article_tracking_submissions"."status" in ('submitting', 'succeeded', 'failed', 'uncertain')),
	CONSTRAINT "article_tracking_submissions_points_ck" CHECK ("article_tracking_submissions"."points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "article_tracking_submissions" ADD CONSTRAINT "article_tracking_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tracking_submissions" ADD CONSTRAINT "article_tracking_submissions_team_binding_id_answerbit_team_bindings_id_fk" FOREIGN KEY ("team_binding_id") REFERENCES "public"."answerbit_team_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tracking_submissions" ADD CONSTRAINT "article_tracking_submissions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_tracking_submissions_org_key_ux" ON "article_tracking_submissions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "article_tracking_submissions_scope_idx" ON "article_tracking_submissions" USING btree ("organization_id","team_binding_id","brand_id","requested_by","created_at");
--> statement-breakpoint
ALTER TABLE public.article_tracking_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_organization_isolation ON public.article_tracking_submissions
TO geo_tenant_app USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.article_tracking_submissions
TO geo_platform_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_tracking_submissions TO geo_tenant_app, geo_platform_app;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v10')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
