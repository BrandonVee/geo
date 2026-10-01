DROP INDEX "saved_views_org_user_name_ux";--> statement-breakpoint
DROP INDEX "saved_views_one_default_ux";--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "creation_key" varchar(200);--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "creation_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_org_creation_key_ux" ON "saved_views" USING btree ("organization_id","user_id","creation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_org_user_name_ux" ON "saved_views" USING btree ("organization_id","user_id","name") WHERE "saved_views"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_one_default_ux" ON "saved_views" USING btree ("organization_id","user_id","page") WHERE "saved_views"."is_default" = true and "saved_views"."deleted_at" is null;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v13')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
