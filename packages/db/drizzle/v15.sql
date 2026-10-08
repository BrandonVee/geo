CREATE TABLE "publication_order_contents" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_binding_id" uuid NOT NULL,
	"brand_id" varchar(128) NOT NULL,
	"title" varchar(255) NOT NULL,
	"source_kind" varchar(24) NOT NULL,
	"content_html" text,
	"content_url" text,
	"submission_note" text NOT NULL,
	"source_document_id" uuid,
	"source_document_version" integer,
	"source_job_id" uuid,
	"creation_fingerprint" varchar(64) NOT NULL,
	"fingerprint_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_order_contents_fingerprint_ck" CHECK ("publication_order_contents"."fingerprint_version" = 1 and "publication_order_contents"."creation_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "publication_order_contents_body_ck" CHECK ("publication_order_contents"."content_html" is null or (char_length(btrim("publication_order_contents"."content_html")) > 0 and char_length("publication_order_contents"."content_html") <= 500000)),
	CONSTRAINT "publication_order_contents_url_ck" CHECK ("publication_order_contents"."content_url" is null or (char_length("publication_order_contents"."content_url") <= 2000 and "publication_order_contents"."content_url" ~* '^https?://')),
	CONSTRAINT "publication_order_contents_note_ck" CHECK (char_length("publication_order_contents"."submission_note") <= 2000),
	CONSTRAINT "publication_order_contents_source_ck" CHECK (
      ("publication_order_contents"."source_kind" = 'url' and "publication_order_contents"."content_html" is null and "publication_order_contents"."content_url" is not null and "publication_order_contents"."source_document_id" is null and "publication_order_contents"."source_document_version" is null and "publication_order_contents"."source_job_id" is null)
      or ("publication_order_contents"."source_kind" = 'inline_html' and "publication_order_contents"."content_html" is not null and "publication_order_contents"."source_document_id" is null and "publication_order_contents"."source_document_version" is null and "publication_order_contents"."source_job_id" is null)
      or ("publication_order_contents"."source_kind" = 'document' and "publication_order_contents"."content_html" is not null and "publication_order_contents"."source_document_id" is not null and "publication_order_contents"."source_document_version" is not null and "publication_order_contents"."source_document_version" > 0 and "publication_order_contents"."source_job_id" is null)
      or ("publication_order_contents"."source_kind" = 'generated' and "publication_order_contents"."content_html" is not null and "publication_order_contents"."source_job_id" is not null and "publication_order_contents"."source_document_id" is null and "publication_order_contents"."source_document_version" is null)
    )
);
--> statement-breakpoint
ALTER TABLE "article_generation_jobs" ADD COLUMN "create_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publication_order_contents" ADD CONSTRAINT "publication_order_contents_order_id_publication_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."publication_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_order_contents" ADD CONSTRAINT "publication_order_contents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_order_contents" ADD CONSTRAINT "publication_order_contents_team_binding_id_answerbit_team_bindings_id_fk" FOREIGN KEY ("team_binding_id") REFERENCES "public"."answerbit_team_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_order_contents_org_idx" ON "publication_order_contents" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE public.publication_order_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_organization_isolation ON public.publication_order_contents
  TO geo_tenant_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY platform_unrestricted ON public.publication_order_contents
  TO geo_platform_app USING (true) WITH CHECK (true);
REVOKE ALL ON public.publication_order_contents FROM PUBLIC;
GRANT SELECT, INSERT ON public.publication_order_contents TO geo_tenant_app, geo_platform_app;
--> statement-breakpoint
CREATE FUNCTION public.protect_publication_order_content() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'PUBLICATION_CONTENT_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER publication_order_contents_immutable_trg
  BEFORE UPDATE OR DELETE ON public.publication_order_contents
  FOR EACH ROW EXECUTE FUNCTION public.protect_publication_order_content();
--> statement-breakpoint
CREATE FUNCTION public.check_publication_order_content_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.publication_orders o
    JOIN public.answerbit_team_bindings b
      ON b.id = NEW.team_binding_id AND b.organization_id = o.organization_id
    JOIN public.answerbit_brand_mappings m
      ON m.organization_id = o.organization_id AND m.team_binding_id = b.id
      AND m.brand_id = o.brand_id
    WHERE o.id = NEW.order_id
      AND o.organization_id = NEW.organization_id AND o.brand_id = NEW.brand_id
      AND o.title = NEW.title
      AND o.content_url IS NOT DISTINCT FROM NEW.content_url
      AND o.source_document_id IS NOT DISTINCT FROM NEW.source_document_id
      AND o.source_job_id IS NOT DISTINCT FROM NEW.source_job_id
      AND o.note = NEW.submission_note
  ) THEN
    RAISE EXCEPTION 'PUBLICATION_CONTENT_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_order_contents_scope_trg
  BEFORE INSERT ON public.publication_order_contents
  FOR EACH ROW EXECUTE FUNCTION public.check_publication_order_content_scope();
--> statement-breakpoint
UPDATE public.article_generation_jobs
SET create_dispatched_at = coalesce(started_at, updated_at, created_at)
WHERE answerbit_article_id IS NULL
  AND (status = 'running' OR (status = 'queued' AND attempt_count > 0));
--> statement-breakpoint
CREATE FUNCTION public.protect_article_create_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.create_dispatched_at IS NOT NULL
    AND NEW.create_dispatched_at IS DISTINCT FROM OLD.create_dispatched_at THEN
    RAISE EXCEPTION 'ARTICLE_CREATE_DISPATCH_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER article_generation_jobs_dispatch_immutable_trg
  BEFORE UPDATE OF create_dispatched_at ON public.article_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_article_create_dispatch();
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v15')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
