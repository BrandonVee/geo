CREATE TYPE "public"."pricing_tier" AS ENUM('retail', 'bronze', 'silver', 'gold');--> statement-breakpoint
CREATE TABLE "pricing_tier_rules" (
	"tier" "pricing_tier" PRIMARY KEY NOT NULL,
	"display_name" varchar(32) NOT NULL,
	"publication_markup_bps" integer NOT NULL,
	"point_multiplier_bps" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_tier_rules_markup_ck" CHECK ("pricing_tier_rules"."publication_markup_bps" >= 0 AND "pricing_tier_rules"."publication_markup_bps" <= 100000),
	CONSTRAINT "pricing_tier_rules_point_multiplier_ck" CHECK ("pricing_tier_rules"."point_multiplier_bps" >= 0 AND "pricing_tier_rules"."point_multiplier_bps" <= 100000)
);
--> statement-breakpoint
CREATE TABLE "publication_channel_price_overrides" (
	"channel_id" uuid NOT NULL,
	"tier" "pricing_tier" NOT NULL,
	"price_amount" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_channel_price_overrides_channel_id_tier_pk" PRIMARY KEY("channel_id","tier"),
	CONSTRAINT "publication_channel_price_overrides_price_ck" CHECK ("publication_channel_price_overrides"."price_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "publication_channels" DROP CONSTRAINT "publication_channels_price_ck";--> statement-breakpoint
ALTER TABLE "publication_channels" ADD COLUMN "provider_cost_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_channels" ADD COLUMN "provider_status" "publication_channel_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pricing_tier" "pricing_tier" DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_tier_rules" ADD CONSTRAINT "pricing_tier_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_channel_price_overrides" ADD CONSTRAINT "publication_channel_price_overrides_channel_id_publication_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."publication_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_channel_price_overrides" ADD CONSTRAINT "publication_channel_price_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_channel_price_overrides_tier_idx" ON "publication_channel_price_overrides" USING btree ("tier");--> statement-breakpoint
ALTER TABLE "publication_channels" ADD CONSTRAINT "publication_channels_price_ck" CHECK ("publication_channels"."price_amount" >= 0 and "publication_channels"."provider_cost_amount" >= 0 and "publication_channels"."currency" = 'CNY');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pricing_tier_type_ck" CHECK ("users"."account_type" = 'agent' OR "users"."pricing_tier" = 'retail');--> statement-breakpoint
UPDATE public.publication_channels
SET provider_cost_amount = price_amount;
--> statement-breakpoint
INSERT INTO public.pricing_tier_rules
  (tier, display_name, publication_markup_bps, point_multiplier_bps)
VALUES
  ('retail', '普通用户', 3000, 10000),
  ('bronze', '铜牌代理', 2000, 9000),
  ('silver', '银牌代理', 1500, 8000),
  ('gold', '金牌代理', 1000, 7000)
ON CONFLICT (tier) DO NOTHING;
--> statement-breakpoint
GRANT SELECT ON TABLE public.pricing_tier_rules TO geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pricing_tier_rules TO geo_platform_app;
GRANT SELECT ON TABLE public.publication_channel_price_overrides TO geo_tenant_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.publication_channel_price_overrides TO geo_platform_app;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v3')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
