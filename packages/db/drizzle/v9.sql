ALTER TABLE "content_documents" ADD COLUMN "creation_key" varchar(128);--> statement-breakpoint
ALTER TABLE "content_documents" ADD COLUMN "creation_fingerprint" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "content_documents_org_creation_key_ux" ON "content_documents" USING btree ("organization_id","creation_key");
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v9')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
