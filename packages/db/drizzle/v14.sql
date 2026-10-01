DROP INDEX "content_folders_scope_name_ux";--> statement-breakpoint
ALTER TABLE "content_folders" ADD COLUMN "creation_key" varchar(128);--> statement-breakpoint
ALTER TABLE "content_folders" ADD COLUMN "creation_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "content_folders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "content_folders_org_creation_key_ux" ON "content_folders" USING btree ("organization_id","creation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_folders_scope_name_ux" ON "content_folders" USING btree ("organization_id","team_binding_id","brand_id","name") WHERE "content_folders"."deleted_at" is null;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v14')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
