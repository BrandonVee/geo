CREATE TABLE "platform_frog_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_fingerprint" varchar(128) NOT NULL,
	"api_key_hint" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" "connection_status" DEFAULT 'invalid' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_frog_credentials_singleton_ck" CHECK ("platform_frog_credentials"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "platform_frog_credentials" ADD CONSTRAINT "platform_frog_credentials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON TABLE public.platform_frog_credentials FROM geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_frog_credentials TO geo_platform_app;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v2')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
