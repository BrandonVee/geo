CREATE TYPE "public"."content_document_source" AS ENUM('manual', 'imported', 'ai_generated');--> statement-breakpoint
CREATE TYPE "public"."content_document_status" AS ENUM('draft', 'ready', 'archived');--> statement-breakpoint
CREATE TABLE "content_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "content_document_status" NOT NULL,
	"language" varchar(16) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_summary" varchar(500) DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_document_versions_version_ck" CHECK ("content_document_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_binding_id" uuid NOT NULL,
	"brand_id" varchar(128) NOT NULL,
	"folder_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"source" "content_document_source" DEFAULT 'manual' NOT NULL,
	"source_job_id" uuid,
	"source_url" text,
	"title" varchar(500) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "content_document_status" DEFAULT 'draft' NOT NULL,
	"language" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_documents_current_version_ck" CHECK ("content_documents"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_binding_id" uuid NOT NULL,
	"brand_id" varchar(128) NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publication_orders" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "content_document_versions" ADD CONSTRAINT "content_document_versions_document_id_content_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."content_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_document_versions" ADD CONSTRAINT "content_document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_document_versions" ADD CONSTRAINT "content_document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_team_binding_id_answerbit_team_bindings_id_fk" FOREIGN KEY ("team_binding_id") REFERENCES "public"."answerbit_team_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_folder_id_content_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."content_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_folders" ADD CONSTRAINT "content_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_folders" ADD CONSTRAINT "content_folders_team_binding_id_answerbit_team_bindings_id_fk" FOREIGN KEY ("team_binding_id") REFERENCES "public"."answerbit_team_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_folders" ADD CONSTRAINT "content_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_document_versions_document_version_ux" ON "content_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "content_document_versions_org_created_idx" ON "content_document_versions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_documents_source_job_ux" ON "content_documents" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "content_documents_scope_updated_idx" ON "content_documents" USING btree ("organization_id","team_binding_id","brand_id","updated_at");--> statement-breakpoint
CREATE INDEX "content_documents_folder_idx" ON "content_documents" USING btree ("folder_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_folders_scope_name_ux" ON "content_folders" USING btree ("organization_id","team_binding_id","brand_id","name");--> statement-breakpoint
CREATE INDEX "content_folders_scope_idx" ON "content_folders" USING btree ("organization_id","team_binding_id","brand_id","created_at");--> statement-breakpoint
ALTER TABLE "publication_orders" ADD CONSTRAINT "publication_orders_source_document_id_content_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."content_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.content_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_document_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_organization_isolation ON public.content_folders
  TO geo_tenant_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.content_folders
  TO geo_platform_app USING (true) WITH CHECK (true);
CREATE POLICY tenant_organization_isolation ON public.content_documents
  TO geo_tenant_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.content_documents
  TO geo_platform_app USING (true) WITH CHECK (true);
CREATE POLICY tenant_organization_isolation ON public.content_document_versions
  TO geo_tenant_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.content_document_versions
  TO geo_platform_app USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_folders TO geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_documents TO geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_document_versions TO geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_folders TO geo_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_documents TO geo_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_document_versions TO geo_platform_app;
--> statement-breakpoint
INSERT INTO public.content_documents (
  organization_id, team_binding_id, brand_id, created_by, updated_by,
  source, source_job_id, title, body, status, language, tags,
  current_version, created_at, updated_at
)
SELECT
  j.organization_id,
  j.team_binding_id,
  j.brand_id,
  j.requested_by,
  j.requested_by,
  'ai_generated'::public.content_document_source,
  j.id,
  j.article_title,
  j.article_body,
  'ready'::public.content_document_status,
  coalesce(j.language, 'zh-CN'),
  CASE
    WHEN jsonb_typeof(j.tags) = 'array' THEN coalesce(
      (
        SELECT jsonb_agg(tag_item->>'tagName')
        FROM jsonb_array_elements(j.tags) AS tag_item
        WHERE coalesce(tag_item->>'tagName', '') <> ''
      ),
      '[]'::jsonb
    )
    ELSE '[]'::jsonb
  END,
  1,
  j.created_at,
  coalesce(j.completed_at, j.updated_at)
FROM public.article_generation_jobs AS j
WHERE j.status = 'succeeded'
  AND j.article_title IS NOT NULL
  AND j.article_body IS NOT NULL
ON CONFLICT (source_job_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.content_document_versions (
  document_id, organization_id, version, title, body, status,
  language, tags, change_summary, created_by, created_at
)
SELECT
  d.id,
  d.organization_id,
  1,
  d.title,
  d.body,
  d.status,
  d.language,
  d.tags,
  '迁移已有 AI 生成内容',
  d.created_by,
  d.created_at
FROM public.content_documents AS d
LEFT JOIN public.content_document_versions AS v
  ON v.document_id = d.id AND v.version = 1
WHERE d.source = 'ai_generated'
  AND v.id IS NULL;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v4')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
