-- AnswerBit GEO database schema v1
-- Clean current-state baseline for PostgreSQL 18.
-- Contains only active tables, constraints, indexes, trigger functions, RLS policies and grants.
-- Existing databases must have completed the former 0044 schema before switching to v1.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_tenant_app') THEN
    CREATE ROLE geo_tenant_app NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geo_platform_app') THEN
    CREATE ROLE geo_platform_app NOLOGIN NOINHERIT;
  END IF;
  EXECUTE format('GRANT geo_tenant_app, geo_platform_app TO %I', current_user);
END $$;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'admin',
    'agent',
    'customer'
);


--
-- Name: answerbit_credential_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.answerbit_credential_scope AS ENUM (
    'team',
    'brand'
);


--
-- Name: api_call_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.api_call_status AS ENUM (
    'success',
    'failed',
    'timeout'
);


--
-- Name: balance_asset; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.balance_asset AS ENUM (
    'answerbit_points',
    'publication_cny'
);


--
-- Name: balance_operation; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.balance_operation AS ENUM (
    'grant',
    'allocate',
    'consume',
    'restore',
    'adjust'
);


--
-- Name: billing_cycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_cycle AS ENUM (
    'free',
    'month',
    'year'
);


--
-- Name: billing_plan_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_plan_status AS ENUM (
    'active',
    'archived'
);


--
-- Name: brand_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.brand_role AS ENUM (
    'brand_admin',
    'brand_editor',
    'brand_viewer'
);


--
-- Name: connection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connection_status AS ENUM (
    'active',
    'invalid',
    'disabled'
);


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled'
);


--
-- Name: member_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_status AS ENUM (
    'invited',
    'active',
    'disabled'
);


--
-- Name: notification_metric; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_metric AS ENUM (
    'exposure',
    'score',
    'avg_rank'
);


--
-- Name: notification_rule_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_rule_type AS ENUM (
    'low_credits',
    'connection_failure',
    'metric_anomaly'
);


--
-- Name: notification_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_severity AS ENUM (
    'info',
    'warning',
    'critical'
);


--
-- Name: operation_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.operation_result AS ENUM (
    'success',
    'failed'
);


--
-- Name: organization_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.organization_status AS ENUM (
    'active',
    'suspended',
    'closed'
);


--
-- Name: plan_version_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.plan_version_status AS ENUM (
    'draft',
    'published',
    'retired'
);


--
-- Name: platform_subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_subscription_status AS ENUM (
    'active',
    'expired',
    'cancelled'
);


--
-- Name: publication_channel_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.publication_channel_status AS ENUM (
    'active',
    'inactive'
);


--
-- Name: publication_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.publication_order_status AS ENUM (
    'submitted',
    'processing',
    'published',
    'failed',
    'cancelled'
);


--
-- Name: quota_operation; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quota_operation AS ENUM (
    'reserve',
    'commit',
    'release',
    'grant',
    'adjust',
    'expire'
);


--
-- Name: report_export_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_export_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed',
    'expired'
);


--
-- Name: report_export_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_export_type AS ENUM (
    'answers',
    'domain_rank',
    'article_rank'
);


--
-- Name: role_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_scope AS ENUM (
    'platform',
    'organization'
);


--
-- Name: runtime_task_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.runtime_task_state AS ENUM (
    'running',
    'succeeded',
    'failed'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'active',
    'disabled'
);


--
-- Name: enforce_platform_role_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_platform_role_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND scope = 'platform') THEN
    RAISE EXCEPTION 'platform_user_roles requires a platform-scoped role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_report_export_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_report_export_scope() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM answerbit_team_bindings t WHERE t.id = NEW.team_binding_id AND t.organization_id = NEW.organization_id) THEN RAISE EXCEPTION 'report export team binding belongs to another organization' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: notification_rule_scope_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_rule_scope_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE binding_org uuid;
BEGIN
  SELECT organization_id INTO binding_org FROM answerbit_team_bindings WHERE id = NEW.team_binding_id;
  IF binding_org IS NULL OR binding_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'notification rule team binding must belong to organization' USING ERRCODE = '23514';
  END IF;
  NEW.scope_key := NEW.team_binding_id::text || CASE WHEN NEW.brand_id IS NULL THEN '' ELSE ':' || NEW.brand_id END;
  RETURN NEW;
END;
$$;


--
-- Name: notification_scope_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notification_scope_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE binding_org uuid; rule_org uuid;
BEGIN
  IF NEW.team_binding_id IS NOT NULL THEN
    SELECT organization_id INTO binding_org FROM answerbit_team_bindings WHERE id = NEW.team_binding_id;
    IF binding_org IS NULL OR binding_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'notification team binding must belong to organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.rule_id IS NOT NULL THEN
    SELECT organization_id INTO rule_org FROM notification_rules WHERE id = NEW.rule_id;
    IF rule_org IS NULL OR rule_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'notification rule must belong to organization' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prevent_operation_log_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_operation_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'operation log is append-only' USING ERRCODE = '23514';
END;
$$;


--
-- Name: prevent_quota_ledger_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_quota_ledger_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'quota ledger is append-only' USING ERRCODE = '23514';
END;
$$;


--
-- Name: protect_published_plan_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_published_plan_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('published', 'retired') THEN
    RAISE EXCEPTION 'published plan versions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'retired') AND (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.version IS DISTINCT FROM OLD.version OR
    NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle OR NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.price_amount IS DISTINCT FROM OLD.price_amount OR NEW.entitlements IS DISTINCT FROM OLD.entitlements OR
    NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'published plan version contents are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'published plan versions cannot return to draft' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    RAISE EXCEPTION 'published_at is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_report_export(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_report_export() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'queued' THEN
      RAISE EXCEPTION 'started report exports are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.team_binding_id IS DISTINCT FROM OLD.team_binding_id
    OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.report_type IS DISTINCT FROM OLD.report_type
    OR NEW.filters IS DISTINCT FROM OLD.filters
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'report export scope and filters are immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed'))
    OR (
      OLD.status = 'running'
      AND NEW.status = 'queued'
      AND NEW.execution_id IS NULL
      AND NEW.started_at IS NULL
      AND NEW.completed_at IS NULL
      AND NEW.error_code IS NULL
    )
    OR (OLD.status = 'succeeded' AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'invalid report export state transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp without time zone,
    refresh_token_expires_at timestamp without time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: answerbit_api_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_api_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    request_id character varying(64) NOT NULL,
    operation character varying(128) NOT NULL,
    answerbit_code integer,
    status public.api_call_status NOT NULL,
    http_status integer,
    duration_ms integer NOT NULL,
    error_code character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid
);


--
-- Name: answerbit_article_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_article_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    article_id character varying(128) NOT NULL,
    title text NOT NULL,
    status integer NOT NULL,
    source integer NOT NULL,
    template_type integer NOT NULL,
    reference_count integer DEFAULT 0 NOT NULL,
    language character varying(16),
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: answerbit_brand_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_brand_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    brand_name character varying(255) NOT NULL,
    alias text,
    website text,
    description text,
    note text,
    website_auto_trace boolean,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: answerbit_competitor_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_competitor_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    competitor_id character varying(128) NOT NULL,
    competitor_name character varying(255) NOT NULL,
    competitor_alias character varying(255) DEFAULT ''::character varying NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: answerbit_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    encrypted_api_key text NOT NULL,
    api_key_fingerprint character varying(128) NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    status public.connection_status DEFAULT 'active'::public.connection_status NOT NULL,
    last_checked_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    api_key_hint character varying(32) NOT NULL,
    managed_by_platform boolean DEFAULT false NOT NULL
);


--
-- Name: answerbit_credential_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_credential_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    display_name character varying(128),
    scope_type public.answerbit_credential_scope NOT NULL,
    brand_id character varying(128),
    permissions text[] NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT answerbit_credential_assignments_permissions_ck CHECK ((cardinality(permissions) > 0)),
    CONSTRAINT answerbit_credential_assignments_priority_ck CHECK (((priority >= 1) AND (priority <= 1000))),
    CONSTRAINT answerbit_credential_assignments_scope_ck CHECK ((((scope_type = 'team'::public.answerbit_credential_scope) AND (brand_id IS NULL)) OR ((scope_type = 'brand'::public.answerbit_credential_scope) AND (brand_id IS NOT NULL))))
);


--
-- Name: answerbit_prompt_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_prompt_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    prompt_id character varying(128) NOT NULL,
    title_id character varying(128) NOT NULL,
    query text NOT NULL,
    status integer DEFAULT 1 NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: answerbit_team_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_team_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    team_id character varying(128) NOT NULL,
    display_name character varying(128),
    is_default boolean DEFAULT false NOT NULL,
    status public.connection_status DEFAULT 'active'::public.connection_status NOT NULL,
    last_synced_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    brand_count integer DEFAULT 0 NOT NULL,
    last_error_code character varying(128)
);


--
-- Name: answerbit_title_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answerbit_title_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    title_id character varying(128) NOT NULL,
    title_name character varying(255) NOT NULL,
    title_description text DEFAULT ''::text NOT NULL,
    prompt_count integer DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_generation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_generation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    requested_by uuid NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    status public.job_status DEFAULT 'queued'::public.job_status NOT NULL,
    answerbit_article_id character varying(128),
    attempt_count integer DEFAULT 0 NOT NULL,
    error_code character varying(128),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    queue_job_id character varying(128),
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    article_title text,
    article_body text,
    article_status integer,
    template_type integer,
    source integer,
    language character varying(16),
    tags jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quota_reservation_key character varying(160),
    execution_id uuid
);


--
-- Name: balance_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    brand_id character varying(128),
    asset public.balance_asset NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_accounts_nonnegative_ck CHECK ((balance >= 0))
);


--
-- Name: balance_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    asset public.balance_asset NOT NULL,
    operation public.balance_operation NOT NULL,
    amount integer NOT NULL,
    source_account_id uuid,
    target_account_id uuid,
    source_balance_after integer,
    target_balance_after integer,
    reference_type character varying(64) NOT NULL,
    reference_id character varying(128) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    reason text NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT balance_transactions_positive_ck CHECK ((amount > 0))
);


--
-- Name: billing_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    version integer NOT NULL,
    billing_cycle public.billing_cycle NOT NULL,
    currency character varying(3) DEFAULT 'CNY'::character varying NOT NULL,
    price_amount integer NOT NULL,
    entitlements jsonb NOT NULL,
    status public.plan_version_status DEFAULT 'draft'::public.plan_version_status NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_plan_versions_positive_ck CHECK (((version > 0) AND (price_amount >= 0)))
);


--
-- Name: billing_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(100) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status public.billing_plan_status DEFAULT 'active'::public.billing_plan_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: brand_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brand_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    user_id uuid NOT NULL,
    role public.brand_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feature_point_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_point_costs (
    feature_code character varying(128) CONSTRAINT answerbit_point_costs_operation_not_null NOT NULL,
    points integer DEFAULT 0 CONSTRAINT answerbit_point_costs_points_not_null NOT NULL,
    description text DEFAULT ''::text CONSTRAINT answerbit_point_costs_description_not_null NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT answerbit_point_costs_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT answerbit_point_costs_updated_at_not_null NOT NULL,
    CONSTRAINT feature_point_costs_nonnegative_ck CHECK ((points >= 0))
);


--
-- Name: member_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_roles (
    member_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: notification_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reads (
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128),
    type public.notification_rule_type NOT NULL,
    metric public.notification_metric,
    threshold integer NOT NULL,
    window_days integer,
    cooldown_minutes integer DEFAULT 1440 NOT NULL,
    scope_key character varying(300) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    last_evaluated_at timestamp with time zone,
    last_evaluation_error character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_rules_cooldown_ck CHECK (((cooldown_minutes >= 5) AND (cooldown_minutes <= 10080))),
    CONSTRAINT notification_rules_threshold_ck CHECK ((((type = 'low_credits'::public.notification_rule_type) AND (threshold >= 0) AND (brand_id IS NULL) AND (metric IS NULL) AND (window_days IS NULL)) OR ((type = 'connection_failure'::public.notification_rule_type) AND ((threshold >= 1) AND (threshold <= 20)) AND (brand_id IS NULL) AND (metric IS NULL) AND (window_days IS NULL)) OR ((type = 'metric_anomaly'::public.notification_rule_type) AND ((threshold >= 1) AND (threshold <= 100)) AND (brand_id IS NOT NULL) AND (metric IS NOT NULL) AND ((window_days >= 1) AND (window_days <= 90)))))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    rule_id uuid,
    team_binding_id uuid,
    brand_id character varying(128),
    type public.notification_rule_type NOT NULL,
    severity public.notification_severity DEFAULT 'warning'::public.notification_severity NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_key character varying(160) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    actor_user_id uuid NOT NULL,
    operation character varying(128) NOT NULL,
    resource_type character varying(64) NOT NULL,
    resource_id character varying(128),
    request_id character varying(64) NOT NULL,
    result public.operation_result NOT NULL,
    ip_address character varying(64),
    user_agent text,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status public.member_status DEFAULT 'invited'::public.member_status NOT NULL,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_user_feature_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_feature_scopes (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_user_feature_scopes_features_ck CHECK (((jsonb_typeof(features) = 'array'::text) AND (features <@ '["geo_insights", "content", "publication", "balance", "report", "notification", "member_management", "enterprise_settings"]'::jsonb)))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(64) NOT NULL,
    status public.organization_status DEFAULT 'active'::public.organization_status NOT NULL,
    plan_code character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(128) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_answerbit_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_answerbit_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id character varying(128) NOT NULL,
    brand_name character varying(255) NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    missing_sync_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT platform_answerbit_brands_missing_sync_count_ck CHECK ((missing_sync_count >= 0))
);


--
-- Name: platform_answerbit_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_answerbit_credentials (
    id smallint DEFAULT 1 NOT NULL,
    encrypted_api_key text NOT NULL,
    api_key_fingerprint character varying(128) NOT NULL,
    api_key_hint character varying(32) NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    status public.connection_status DEFAULT 'invalid'::public.connection_status NOT NULL,
    last_checked_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_id character varying(128),
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT platform_answerbit_credentials_singleton_ck CHECK ((id = 1))
);


--
-- Name: platform_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    plan_version_id uuid NOT NULL,
    status public.platform_subscription_status DEFAULT 'active'::public.platform_subscription_status NOT NULL,
    current_period_start timestamp with time zone NOT NULL,
    current_period_end timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: publication_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publication_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(160) NOT NULL,
    category character varying(64) NOT NULL,
    price_amount integer NOT NULL,
    currency character varying(3) DEFAULT 'CNY'::character varying NOT NULL,
    status public.publication_channel_status DEFAULT 'active'::public.publication_channel_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider character varying(32) DEFAULT 'manual'::character varying NOT NULL,
    provider_resource_id character varying(128),
    provider_media_type character varying(32),
    remarks text DEFAULT ''::text NOT NULL,
    case_link text,
    provider_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT publication_channels_price_ck CHECK (((price_amount >= 0) AND ((currency)::text = 'CNY'::text)))
);


--
-- Name: publication_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publication_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    channel_id uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status public.publication_order_status DEFAULT 'submitted'::public.publication_order_status NOT NULL,
    price_amount integer NOT NULL,
    currency character varying(3) DEFAULT 'CNY'::character varying NOT NULL,
    title character varying(255) NOT NULL,
    content_url text,
    result_url text,
    note text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    processed_by uuid,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_job_id uuid,
    provider_order_id character varying(128),
    provider_status integer,
    provider_message text,
    provider_synced_at timestamp with time zone,
    CONSTRAINT publication_orders_price_ck CHECK (((price_amount >= 0) AND ((currency)::text = 'CNY'::text)))
);


--
-- Name: quota_ledgers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_ledgers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    entitlement_id uuid NOT NULL,
    entitlement_key character varying(128) NOT NULL,
    operation public.quota_operation NOT NULL,
    amount integer NOT NULL,
    balance_after integer,
    reference_type character varying(64) NOT NULL,
    reference_id character varying(128) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    reason text,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    team_binding_id uuid NOT NULL,
    brand_id character varying(128) NOT NULL,
    requested_by uuid NOT NULL,
    report_type public.report_export_type NOT NULL,
    filters jsonb NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    quota_reservation_key character varying(160),
    queue_job_id character varying(128),
    status public.report_export_status DEFAULT 'queued'::public.report_export_status NOT NULL,
    filename character varying(255),
    mime_type character varying(100),
    file_content text,
    row_count integer,
    error_code character varying(128),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_id uuid
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(64) NOT NULL,
    scope public.role_scope NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runtime_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_heartbeats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    component character varying(64) NOT NULL,
    instance_id uuid NOT NULL,
    version character varying(128) DEFAULT 'unknown'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runtime_task_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_task_statuses (
    task_name character varying(64) NOT NULL,
    state public.runtime_task_state DEFAULT 'running'::public.runtime_task_state NOT NULL,
    run_id uuid NOT NULL,
    instance_id uuid NOT NULL,
    expected_interval_seconds integer NOT NULL,
    timeout_seconds integer NOT NULL,
    last_started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_succeeded_at timestamp with time zone,
    last_failed_at timestamp with time zone,
    last_duration_ms integer,
    last_error_code character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_task_statuses_duration_ck CHECK (((last_duration_ms IS NULL) OR (last_duration_ms >= 0))),
    CONSTRAINT runtime_task_statuses_intervals_ck CHECK (((expected_interval_seconds > 0) AND (timeout_seconds > 0)))
);


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    page character varying(64) NOT NULL,
    filters jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    token text NOT NULL,
    ip_address text,
    user_agent text,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    entitlement_key character varying(128) NOT NULL,
    limit_amount integer,
    used_amount integer DEFAULT 0 NOT NULL,
    reserved_amount integer DEFAULT 0 NOT NULL,
    unit character varying(32) NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_entitlements_amounts_ck CHECK ((((limit_amount IS NULL) OR (limit_amount >= 0)) AND (used_amount >= 0) AND (reserved_amount >= 0))),
    CONSTRAINT subscription_entitlements_period_ck CHECK ((period_end > period_start))
);


--
-- Name: system_release_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_release_state (
    component character varying(32) NOT NULL,
    version character varying(128) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status public.user_status DEFAULT 'active'::public.user_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    account_type public.account_type DEFAULT 'customer'::public.account_type NOT NULL,
    username character varying(32),
    agent_valid_from timestamp with time zone,
    agent_expires_at timestamp with time zone,
    agent_enterprise_limit integer,
    agent_brand_limit integer,
    agent_answerbit_points_limit integer,
    CONSTRAINT users_agent_limits_nonnegative_ck CHECK ((((agent_enterprise_limit IS NULL) OR (agent_enterprise_limit >= 0)) AND ((agent_brand_limit IS NULL) OR (agent_brand_limit >= 0)) AND ((agent_answerbit_points_limit IS NULL) OR (agent_answerbit_points_limit >= 0)))),
    CONSTRAINT users_agent_limits_type_ck CHECK (((account_type = 'agent'::public.account_type) OR ((agent_enterprise_limit IS NULL) AND (agent_brand_limit IS NULL) AND (agent_answerbit_points_limit IS NULL)))),
    CONSTRAINT users_agent_validity_range_ck CHECK (((agent_valid_from IS NULL) OR (agent_expires_at IS NULL) OR (agent_valid_from < agent_expires_at))),
    CONSTRAINT users_agent_validity_type_ck CHECK (((account_type = 'agent'::public.account_type) OR ((agent_valid_from IS NULL) AND (agent_expires_at IS NULL))))
);


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: answerbit_api_calls answerbit_api_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_api_calls
    ADD CONSTRAINT answerbit_api_calls_pkey PRIMARY KEY (id);


--
-- Name: answerbit_article_mappings answerbit_article_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_article_mappings
    ADD CONSTRAINT answerbit_article_mappings_pkey PRIMARY KEY (id);


--
-- Name: answerbit_brand_mappings answerbit_brand_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_brand_mappings
    ADD CONSTRAINT answerbit_brand_mappings_pkey PRIMARY KEY (id);


--
-- Name: answerbit_competitor_mappings answerbit_competitor_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_competitor_mappings
    ADD CONSTRAINT answerbit_competitor_mappings_pkey PRIMARY KEY (id);


--
-- Name: answerbit_connections answerbit_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_connections
    ADD CONSTRAINT answerbit_connections_pkey PRIMARY KEY (id);


--
-- Name: answerbit_credential_assignments answerbit_credential_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_credential_assignments
    ADD CONSTRAINT answerbit_credential_assignments_pkey PRIMARY KEY (id);


--
-- Name: feature_point_costs answerbit_point_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_point_costs
    ADD CONSTRAINT answerbit_point_costs_pkey PRIMARY KEY (feature_code);


--
-- Name: answerbit_prompt_mappings answerbit_prompt_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_prompt_mappings
    ADD CONSTRAINT answerbit_prompt_mappings_pkey PRIMARY KEY (id);


--
-- Name: answerbit_team_bindings answerbit_team_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_team_bindings
    ADD CONSTRAINT answerbit_team_bindings_pkey PRIMARY KEY (id);


--
-- Name: answerbit_title_mappings answerbit_title_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_title_mappings
    ADD CONSTRAINT answerbit_title_mappings_pkey PRIMARY KEY (id);


--
-- Name: article_generation_jobs article_generation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_generation_jobs
    ADD CONSTRAINT article_generation_jobs_pkey PRIMARY KEY (id);


--
-- Name: balance_accounts balance_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_accounts
    ADD CONSTRAINT balance_accounts_pkey PRIMARY KEY (id);


--
-- Name: balance_transactions balance_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_transactions
    ADD CONSTRAINT balance_transactions_pkey PRIMARY KEY (id);


--
-- Name: billing_plan_versions billing_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_plan_versions
    ADD CONSTRAINT billing_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: billing_plans billing_plans_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_plans
    ADD CONSTRAINT billing_plans_code_unique UNIQUE (code);


--
-- Name: billing_plans billing_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_plans
    ADD CONSTRAINT billing_plans_pkey PRIMARY KEY (id);


--
-- Name: brand_access brand_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_access
    ADD CONSTRAINT brand_access_pkey PRIMARY KEY (id);


--
-- Name: notification_rules notification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: operation_logs operation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_logs
    ADD CONSTRAINT operation_logs_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_unique UNIQUE (slug);


--
-- Name: permissions permissions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_unique UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: platform_answerbit_brands platform_answerbit_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_answerbit_brands
    ADD CONSTRAINT platform_answerbit_brands_pkey PRIMARY KEY (id);


--
-- Name: platform_answerbit_credentials platform_answerbit_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_answerbit_credentials
    ADD CONSTRAINT platform_answerbit_credentials_pkey PRIMARY KEY (id);


--
-- Name: platform_subscriptions platform_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_subscriptions
    ADD CONSTRAINT platform_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: publication_channels publication_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_channels
    ADD CONSTRAINT publication_channels_pkey PRIMARY KEY (id);


--
-- Name: publication_orders publication_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_orders
    ADD CONSTRAINT publication_orders_pkey PRIMARY KEY (id);


--
-- Name: quota_ledgers quota_ledgers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_ledgers
    ADD CONSTRAINT quota_ledgers_pkey PRIMARY KEY (id);


--
-- Name: report_exports report_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_pkey PRIMARY KEY (id);


--
-- Name: roles roles_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_code_unique UNIQUE (code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: runtime_heartbeats runtime_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_heartbeats
    ADD CONSTRAINT runtime_heartbeats_pkey PRIMARY KEY (id);


--
-- Name: runtime_task_statuses runtime_task_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_task_statuses
    ADD CONSTRAINT runtime_task_statuses_pkey PRIMARY KEY (task_name);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_unique UNIQUE (token);


--
-- Name: subscription_entitlements subscription_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_entitlements
    ADD CONSTRAINT subscription_entitlements_pkey PRIMARY KEY (id);


--
-- Name: system_release_state system_release_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_release_state
    ADD CONSTRAINT system_release_state_pkey PRIMARY KEY (component);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: accounts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_user_id_idx ON public.accounts USING btree (user_id);


--
-- Name: answerbit_api_calls_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_api_calls_actor_created_idx ON public.answerbit_api_calls USING btree (actor_user_id, created_at);


--
-- Name: answerbit_api_calls_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_api_calls_created_idx ON public.answerbit_api_calls USING btree (created_at);


--
-- Name: answerbit_api_calls_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_api_calls_org_created_idx ON public.answerbit_api_calls USING btree (organization_id, created_at);


--
-- Name: answerbit_api_calls_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_api_calls_request_idx ON public.answerbit_api_calls USING btree (request_id);


--
-- Name: answerbit_article_mappings_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_article_mappings_brand_idx ON public.answerbit_article_mappings USING btree (organization_id, team_binding_id, brand_id);


--
-- Name: answerbit_article_mappings_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_article_mappings_scope_ux ON public.answerbit_article_mappings USING btree (organization_id, team_binding_id, brand_id, article_id);


--
-- Name: answerbit_brand_mappings_brand_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_brand_mappings_brand_ux ON public.answerbit_brand_mappings USING btree (brand_id);


--
-- Name: answerbit_brand_mappings_org_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_brand_mappings_org_team_idx ON public.answerbit_brand_mappings USING btree (organization_id, team_binding_id);


--
-- Name: answerbit_brand_mappings_org_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_brand_mappings_org_ux ON public.answerbit_brand_mappings USING btree (organization_id);


--
-- Name: answerbit_brand_mappings_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_brand_mappings_scope_ux ON public.answerbit_brand_mappings USING btree (organization_id, team_binding_id, brand_id);


--
-- Name: answerbit_competitor_mappings_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_competitor_mappings_brand_idx ON public.answerbit_competitor_mappings USING btree (organization_id, team_binding_id, brand_id);


--
-- Name: answerbit_competitor_mappings_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_competitor_mappings_scope_ux ON public.answerbit_competitor_mappings USING btree (organization_id, team_binding_id, brand_id, competitor_id);


--
-- Name: answerbit_connections_org_key_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_connections_org_key_ux ON public.answerbit_connections USING btree (organization_id, api_key_fingerprint);


--
-- Name: answerbit_credential_assignments_org_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_credential_assignments_org_team_idx ON public.answerbit_credential_assignments USING btree (organization_id, team_binding_id);


--
-- Name: answerbit_credential_assignments_team_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_credential_assignments_team_brand_idx ON public.answerbit_credential_assignments USING btree (team_binding_id, brand_id);


--
-- Name: answerbit_credential_assignments_team_connection_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_credential_assignments_team_connection_ux ON public.answerbit_credential_assignments USING btree (team_binding_id, connection_id);


--
-- Name: answerbit_prompt_mappings_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_prompt_mappings_scope_ux ON public.answerbit_prompt_mappings USING btree (organization_id, team_binding_id, brand_id, prompt_id);


--
-- Name: answerbit_prompt_mappings_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_prompt_mappings_title_idx ON public.answerbit_prompt_mappings USING btree (organization_id, team_binding_id, brand_id, title_id);


--
-- Name: answerbit_team_bindings_one_default_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_team_bindings_one_default_ux ON public.answerbit_team_bindings USING btree (organization_id) WHERE (is_default = true);


--
-- Name: answerbit_team_bindings_org_team_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_team_bindings_org_team_ux ON public.answerbit_team_bindings USING btree (organization_id, team_id);


--
-- Name: answerbit_title_mappings_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX answerbit_title_mappings_brand_idx ON public.answerbit_title_mappings USING btree (organization_id, team_binding_id, brand_id);


--
-- Name: answerbit_title_mappings_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX answerbit_title_mappings_scope_ux ON public.answerbit_title_mappings USING btree (organization_id, team_binding_id, brand_id, title_id);


--
-- Name: article_jobs_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_jobs_org_created_idx ON public.article_generation_jobs USING btree (organization_id, created_at);


--
-- Name: article_jobs_org_idempotency_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX article_jobs_org_idempotency_ux ON public.article_generation_jobs USING btree (organization_id, idempotency_key);


--
-- Name: article_jobs_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_jobs_status_updated_idx ON public.article_generation_jobs USING btree (status, updated_at);


--
-- Name: balance_accounts_brand_asset_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX balance_accounts_brand_asset_ux ON public.balance_accounts USING btree (organization_id, brand_id, asset) WHERE (brand_id IS NOT NULL);


--
-- Name: balance_accounts_org_brand_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_accounts_org_brand_idx ON public.balance_accounts USING btree (organization_id, brand_id);


--
-- Name: balance_accounts_organization_asset_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX balance_accounts_organization_asset_ux ON public.balance_accounts USING btree (organization_id, asset) WHERE (brand_id IS NULL);


--
-- Name: balance_transactions_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_transactions_actor_created_idx ON public.balance_transactions USING btree (actor_user_id, created_at);


--
-- Name: balance_transactions_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_transactions_created_idx ON public.balance_transactions USING btree (created_at);


--
-- Name: balance_transactions_org_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_transactions_org_actor_created_idx ON public.balance_transactions USING btree (organization_id, actor_user_id, created_at);


--
-- Name: balance_transactions_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX balance_transactions_org_created_idx ON public.balance_transactions USING btree (organization_id, created_at);


--
-- Name: balance_transactions_org_idempotency_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX balance_transactions_org_idempotency_ux ON public.balance_transactions USING btree (organization_id, idempotency_key);


--
-- Name: billing_plan_versions_plan_version_cycle_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX billing_plan_versions_plan_version_cycle_ux ON public.billing_plan_versions USING btree (plan_id, version, billing_cycle);


--
-- Name: billing_plan_versions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_plan_versions_status_idx ON public.billing_plan_versions USING btree (status, published_at);


--
-- Name: brand_access_scope_user_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX brand_access_scope_user_ux ON public.brand_access USING btree (organization_id, team_binding_id, brand_id, user_id);


--
-- Name: member_roles_member_role_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_roles_member_role_ux ON public.member_roles USING btree (member_id, role_id);


--
-- Name: notification_reads_notification_user_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_reads_notification_user_ux ON public.notification_reads USING btree (notification_id, user_id);


--
-- Name: notification_reads_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_reads_user_idx ON public.notification_reads USING btree (user_id, read_at);


--
-- Name: notification_rules_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_rules_enabled_idx ON public.notification_rules USING btree (enabled, type, updated_at);


--
-- Name: notification_rules_org_type_scope_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_rules_org_type_scope_ux ON public.notification_rules USING btree (organization_id, type, scope_key);


--
-- Name: notifications_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_org_created_idx ON public.notifications USING btree (organization_id, created_at);


--
-- Name: notifications_org_event_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_org_event_ux ON public.notifications USING btree (organization_id, event_key);


--
-- Name: notifications_scope_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_scope_created_idx ON public.notifications USING btree (organization_id, team_binding_id, brand_id, created_at);


--
-- Name: operation_logs_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operation_logs_org_created_idx ON public.operation_logs USING btree (organization_id, created_at);


--
-- Name: organization_members_org_user_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_members_org_user_ux ON public.organization_members USING btree (organization_id, user_id);


--
-- Name: organization_user_feature_scopes_org_user_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_user_feature_scopes_org_user_ux ON public.organization_user_feature_scopes USING btree (organization_id, user_id);


--
-- Name: organization_user_feature_scopes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_feature_scopes_user_idx ON public.organization_user_feature_scopes USING btree (user_id);


--
-- Name: platform_answerbit_brands_brand_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_answerbit_brands_brand_ux ON public.platform_answerbit_brands USING btree (brand_id);


--
-- Name: platform_subscriptions_one_active_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_subscriptions_one_active_ux ON public.platform_subscriptions USING btree (organization_id) WHERE (status = 'active'::public.platform_subscription_status);


--
-- Name: platform_subscriptions_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_subscriptions_org_created_idx ON public.platform_subscriptions USING btree (organization_id, created_at);


--
-- Name: platform_user_roles_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_user_roles_user_idx ON public.platform_user_roles USING btree (user_id);


--
-- Name: platform_user_roles_user_role_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_user_roles_user_role_ux ON public.platform_user_roles USING btree (user_id, role_id);


--
-- Name: publication_channels_provider_resource_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX publication_channels_provider_resource_ux ON public.publication_channels USING btree (provider, provider_media_type, provider_resource_id);


--
-- Name: publication_orders_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publication_orders_org_created_idx ON public.publication_orders USING btree (organization_id, created_at);


--
-- Name: publication_orders_org_idempotency_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX publication_orders_org_idempotency_ux ON public.publication_orders USING btree (organization_id, idempotency_key);


--
-- Name: publication_orders_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publication_orders_status_created_idx ON public.publication_orders USING btree (status, created_at);


--
-- Name: quota_ledgers_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quota_ledgers_org_created_idx ON public.quota_ledgers USING btree (organization_id, created_at);


--
-- Name: quota_ledgers_org_idempotency_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quota_ledgers_org_idempotency_ux ON public.quota_ledgers USING btree (organization_id, idempotency_key);


--
-- Name: quota_ledgers_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quota_ledgers_reference_idx ON public.quota_ledgers USING btree (reference_type, reference_id);


--
-- Name: report_exports_org_idempotency_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_exports_org_idempotency_ux ON public.report_exports USING btree (organization_id, idempotency_key);


--
-- Name: report_exports_scope_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_scope_created_idx ON public.report_exports USING btree (organization_id, team_binding_id, brand_id, created_at);


--
-- Name: report_exports_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_status_created_idx ON public.report_exports USING btree (status, created_at);


--
-- Name: report_exports_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_exports_status_updated_idx ON public.report_exports USING btree (status, updated_at);


--
-- Name: role_permissions_role_permission_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_permissions_role_permission_ux ON public.role_permissions USING btree (role_id, permission_id);


--
-- Name: runtime_heartbeats_component_instance_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX runtime_heartbeats_component_instance_ux ON public.runtime_heartbeats USING btree (component, instance_id);


--
-- Name: runtime_heartbeats_component_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_heartbeats_component_seen_idx ON public.runtime_heartbeats USING btree (component, last_seen_at);


--
-- Name: runtime_task_statuses_state_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_task_statuses_state_updated_idx ON public.runtime_task_statuses USING btree (state, updated_at);


--
-- Name: saved_views_one_default_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saved_views_one_default_ux ON public.saved_views USING btree (organization_id, user_id, page) WHERE (is_default = true);


--
-- Name: saved_views_org_user_name_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX saved_views_org_user_name_ux ON public.saved_views USING btree (organization_id, user_id, name);


--
-- Name: saved_views_user_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_views_user_page_idx ON public.saved_views USING btree (user_id, page, updated_at);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: subscription_entitlements_org_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_entitlements_org_key_idx ON public.subscription_entitlements USING btree (organization_id, entitlement_key);


--
-- Name: subscription_entitlements_subscription_key_ux; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subscription_entitlements_subscription_key_ux ON public.subscription_entitlements USING btree (subscription_id, entitlement_key);


--
-- Name: verifications_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verifications_identifier_idx ON public.verifications USING btree (identifier);


--
-- Name: billing_plan_versions billing_plan_versions_immutable_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER billing_plan_versions_immutable_trg BEFORE DELETE OR UPDATE ON public.billing_plan_versions FOR EACH ROW EXECUTE FUNCTION public.protect_published_plan_version();


--
-- Name: notification_rules notification_rule_scope_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_rule_scope_guard_trigger BEFORE INSERT OR UPDATE ON public.notification_rules FOR EACH ROW EXECUTE FUNCTION public.notification_rule_scope_guard();


--
-- Name: notifications notification_scope_guard_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_scope_guard_trigger BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notification_scope_guard();


--
-- Name: operation_logs operation_logs_append_only_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operation_logs_append_only_trg BEFORE DELETE OR UPDATE ON public.operation_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_operation_log_mutation();


--
-- Name: platform_user_roles platform_user_roles_scope_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER platform_user_roles_scope_trg BEFORE INSERT OR UPDATE ON public.platform_user_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_platform_role_scope();


--
-- Name: quota_ledgers quota_ledgers_append_only_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quota_ledgers_append_only_trg BEFORE DELETE OR UPDATE ON public.quota_ledgers FOR EACH ROW EXECUTE FUNCTION public.prevent_quota_ledger_mutation();


--
-- Name: report_exports report_exports_scope_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER report_exports_scope_trg BEFORE INSERT OR UPDATE ON public.report_exports FOR EACH ROW EXECUTE FUNCTION public.enforce_report_export_scope();


--
-- Name: report_exports report_exports_state_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER report_exports_state_trg BEFORE DELETE OR UPDATE ON public.report_exports FOR EACH ROW EXECUTE FUNCTION public.protect_report_export();


--
-- Name: accounts accounts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: answerbit_api_calls answerbit_api_calls_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_api_calls
    ADD CONSTRAINT answerbit_api_calls_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: answerbit_api_calls answerbit_api_calls_connection_id_answerbit_connections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_api_calls
    ADD CONSTRAINT answerbit_api_calls_connection_id_answerbit_connections_id_fk FOREIGN KEY (connection_id) REFERENCES public.answerbit_connections(id);


--
-- Name: answerbit_api_calls answerbit_api_calls_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_api_calls
    ADD CONSTRAINT answerbit_api_calls_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_article_mappings answerbit_article_mappings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_article_mappings
    ADD CONSTRAINT answerbit_article_mappings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_article_mappings answerbit_article_mappings_team_binding_id_answerbit_team_bindi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_article_mappings
    ADD CONSTRAINT answerbit_article_mappings_team_binding_id_answerbit_team_bindi FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: answerbit_brand_mappings answerbit_brand_mappings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_brand_mappings
    ADD CONSTRAINT answerbit_brand_mappings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_brand_mappings answerbit_brand_mappings_team_binding_id_answerbit_team_binding; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_brand_mappings
    ADD CONSTRAINT answerbit_brand_mappings_team_binding_id_answerbit_team_binding FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: answerbit_competitor_mappings answerbit_competitor_mappings_organization_id_organizations_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_competitor_mappings
    ADD CONSTRAINT answerbit_competitor_mappings_organization_id_organizations_id_ FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_competitor_mappings answerbit_competitor_mappings_team_binding_id_answerbit_team_bi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_competitor_mappings
    ADD CONSTRAINT answerbit_competitor_mappings_team_binding_id_answerbit_team_bi FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: answerbit_connections answerbit_connections_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_connections
    ADD CONSTRAINT answerbit_connections_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: answerbit_connections answerbit_connections_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_connections
    ADD CONSTRAINT answerbit_connections_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_credential_assignments answerbit_credential_assignments_connection_id_answerbit_connec; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_credential_assignments
    ADD CONSTRAINT answerbit_credential_assignments_connection_id_answerbit_connec FOREIGN KEY (connection_id) REFERENCES public.answerbit_connections(id) ON DELETE CASCADE;


--
-- Name: answerbit_credential_assignments answerbit_credential_assignments_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_credential_assignments
    ADD CONSTRAINT answerbit_credential_assignments_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: answerbit_credential_assignments answerbit_credential_assignments_organization_id_organizations_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_credential_assignments
    ADD CONSTRAINT answerbit_credential_assignments_organization_id_organizations_ FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_credential_assignments answerbit_credential_assignments_team_binding_id_answerbit_team; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_credential_assignments
    ADD CONSTRAINT answerbit_credential_assignments_team_binding_id_answerbit_team FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: answerbit_prompt_mappings answerbit_prompt_mappings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_prompt_mappings
    ADD CONSTRAINT answerbit_prompt_mappings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_prompt_mappings answerbit_prompt_mappings_team_binding_id_answerbit_team_bindin; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_prompt_mappings
    ADD CONSTRAINT answerbit_prompt_mappings_team_binding_id_answerbit_team_bindin FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: answerbit_team_bindings answerbit_team_bindings_connection_id_answerbit_connections_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_team_bindings
    ADD CONSTRAINT answerbit_team_bindings_connection_id_answerbit_connections_id_ FOREIGN KEY (connection_id) REFERENCES public.answerbit_connections(id);


--
-- Name: answerbit_team_bindings answerbit_team_bindings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_team_bindings
    ADD CONSTRAINT answerbit_team_bindings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_title_mappings answerbit_title_mappings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_title_mappings
    ADD CONSTRAINT answerbit_title_mappings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: answerbit_title_mappings answerbit_title_mappings_team_binding_id_answerbit_team_binding; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answerbit_title_mappings
    ADD CONSTRAINT answerbit_title_mappings_team_binding_id_answerbit_team_binding FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: article_generation_jobs article_generation_jobs_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_generation_jobs
    ADD CONSTRAINT article_generation_jobs_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: article_generation_jobs article_generation_jobs_requested_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_generation_jobs
    ADD CONSTRAINT article_generation_jobs_requested_by_users_id_fk FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: article_generation_jobs article_generation_jobs_team_binding_id_answerbit_team_bindings; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_generation_jobs
    ADD CONSTRAINT article_generation_jobs_team_binding_id_answerbit_team_bindings FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id);


--
-- Name: balance_accounts balance_accounts_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_accounts
    ADD CONSTRAINT balance_accounts_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: balance_transactions balance_transactions_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_transactions
    ADD CONSTRAINT balance_transactions_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: balance_transactions balance_transactions_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_transactions
    ADD CONSTRAINT balance_transactions_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: balance_transactions balance_transactions_source_account_id_balance_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_transactions
    ADD CONSTRAINT balance_transactions_source_account_id_balance_accounts_id_fk FOREIGN KEY (source_account_id) REFERENCES public.balance_accounts(id);


--
-- Name: balance_transactions balance_transactions_target_account_id_balance_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_transactions
    ADD CONSTRAINT balance_transactions_target_account_id_balance_accounts_id_fk FOREIGN KEY (target_account_id) REFERENCES public.balance_accounts(id);


--
-- Name: billing_plan_versions billing_plan_versions_plan_id_billing_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_plan_versions
    ADD CONSTRAINT billing_plan_versions_plan_id_billing_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.billing_plans(id);


--
-- Name: brand_access brand_access_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_access
    ADD CONSTRAINT brand_access_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: brand_access brand_access_team_binding_id_answerbit_team_bindings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_access
    ADD CONSTRAINT brand_access_team_binding_id_answerbit_team_bindings_id_fk FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id);


--
-- Name: brand_access brand_access_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brand_access
    ADD CONSTRAINT brand_access_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: feature_point_costs feature_point_costs_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_point_costs
    ADD CONSTRAINT feature_point_costs_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: member_roles member_roles_member_id_organization_members_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_member_id_organization_members_id_fk FOREIGN KEY (member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;


--
-- Name: member_roles member_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: notification_reads notification_reads_notification_id_notifications_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_notifications_id_fk FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_reads notification_reads_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_rules notification_rules_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: notification_rules notification_rules_team_binding_id_answerbit_team_bindings_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_team_binding_id_answerbit_team_bindings_id_f FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id) ON DELETE CASCADE;


--
-- Name: notification_rules notification_rules_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_rule_id_notification_rules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_rule_id_notification_rules_id_fk FOREIGN KEY (rule_id) REFERENCES public.notification_rules(id);


--
-- Name: notifications notifications_team_binding_id_answerbit_team_bindings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_team_binding_id_answerbit_team_bindings_id_fk FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id);


--
-- Name: operation_logs operation_logs_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_logs
    ADD CONSTRAINT operation_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: operation_logs operation_logs_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_logs
    ADD CONSTRAINT operation_logs_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organization_members organization_members_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organization_members organization_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: organization_user_feature_scopes organization_user_feature_scopes_organization_id_organizations_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_feature_scopes
    ADD CONSTRAINT organization_user_feature_scopes_organization_id_organizations_ FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_user_feature_scopes organization_user_feature_scopes_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_feature_scopes
    ADD CONSTRAINT organization_user_feature_scopes_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_user_feature_scopes organization_user_feature_scopes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_feature_scopes
    ADD CONSTRAINT organization_user_feature_scopes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_answerbit_credentials platform_answerbit_credentials_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_answerbit_credentials
    ADD CONSTRAINT platform_answerbit_credentials_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: platform_subscriptions platform_subscriptions_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_subscriptions
    ADD CONSTRAINT platform_subscriptions_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: platform_subscriptions platform_subscriptions_plan_version_id_billing_plan_versions_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_subscriptions
    ADD CONSTRAINT platform_subscriptions_plan_version_id_billing_plan_versions_id FOREIGN KEY (plan_version_id) REFERENCES public.billing_plan_versions(id);


--
-- Name: platform_user_roles platform_user_roles_granted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_granted_by_users_id_fk FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: platform_user_roles platform_user_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: platform_user_roles platform_user_roles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: publication_orders publication_orders_channel_id_publication_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_orders
    ADD CONSTRAINT publication_orders_channel_id_publication_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.publication_channels(id);


--
-- Name: publication_orders publication_orders_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_orders
    ADD CONSTRAINT publication_orders_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: publication_orders publication_orders_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_orders
    ADD CONSTRAINT publication_orders_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: publication_orders publication_orders_processed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_orders
    ADD CONSTRAINT publication_orders_processed_by_users_id_fk FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: quota_ledgers quota_ledgers_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_ledgers
    ADD CONSTRAINT quota_ledgers_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: quota_ledgers quota_ledgers_entitlement_id_subscription_entitlements_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_ledgers
    ADD CONSTRAINT quota_ledgers_entitlement_id_subscription_entitlements_id_fk FOREIGN KEY (entitlement_id) REFERENCES public.subscription_entitlements(id);


--
-- Name: quota_ledgers quota_ledgers_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_ledgers
    ADD CONSTRAINT quota_ledgers_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: quota_ledgers quota_ledgers_subscription_id_platform_subscriptions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_ledgers
    ADD CONSTRAINT quota_ledgers_subscription_id_platform_subscriptions_id_fk FOREIGN KEY (subscription_id) REFERENCES public.platform_subscriptions(id);


--
-- Name: report_exports report_exports_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: report_exports report_exports_requested_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_requested_by_users_id_fk FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: report_exports report_exports_team_binding_id_answerbit_team_bindings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_exports
    ADD CONSTRAINT report_exports_team_binding_id_answerbit_team_bindings_id_fk FOREIGN KEY (team_binding_id) REFERENCES public.answerbit_team_bindings(id);


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscription_entitlements subscription_entitlements_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_entitlements
    ADD CONSTRAINT subscription_entitlements_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: subscription_entitlements subscription_entitlements_subscription_id_platform_subscription; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_entitlements
    ADD CONSTRAINT subscription_entitlements_subscription_id_platform_subscription FOREIGN KEY (subscription_id) REFERENCES public.platform_subscriptions(id) ON DELETE CASCADE;


--
-- Name: answerbit_api_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_api_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_article_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_article_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_brand_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_brand_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_competitor_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_competitor_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_credential_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_credential_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_prompt_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_prompt_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_team_bindings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_team_bindings ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_title_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answerbit_title_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: article_generation_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_generation_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brand_access ENABLE ROW LEVEL SECURITY;

--
-- Name: member_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: operation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_feature_scopes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_feature_scopes ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: answerbit_api_calls platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_api_calls TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_article_mappings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_article_mappings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_brand_mappings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_brand_mappings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_competitor_mappings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_competitor_mappings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_connections platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_connections TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_credential_assignments platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_credential_assignments TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_prompt_mappings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_prompt_mappings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_team_bindings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_team_bindings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: answerbit_title_mappings platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.answerbit_title_mappings TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: article_generation_jobs platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.article_generation_jobs TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: balance_accounts platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.balance_accounts TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: balance_transactions platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.balance_transactions TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: brand_access platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.brand_access TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: member_roles platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.member_roles TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: notification_reads platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.notification_reads TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: notification_rules platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.notification_rules TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: notifications platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.notifications TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: operation_logs platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.operation_logs TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: organization_members platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.organization_members TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: organization_user_feature_scopes platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.organization_user_feature_scopes TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: organizations platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.organizations TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: platform_subscriptions platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.platform_subscriptions TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: publication_orders platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.publication_orders TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: quota_ledgers platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.quota_ledgers TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: report_exports platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.report_exports TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: saved_views platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.saved_views TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: subscription_entitlements platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.subscription_entitlements TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: users platform_unrestricted; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_unrestricted ON public.users TO geo_platform_app USING (true) WITH CHECK (true);


--
-- Name: publication_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.publication_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: quota_ledgers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quota_ledgers ENABLE ROW LEVEL SECURITY;

--
-- Name: report_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: member_roles tenant_member_role_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_member_role_isolation ON public.member_roles TO geo_tenant_app USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.id = member_roles.member_id) AND (m.organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.id = member_roles.member_id) AND (m.organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)))));


--
-- Name: notification_reads tenant_notification_read_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_notification_read_isolation ON public.notification_reads TO geo_tenant_app USING ((EXISTS ( SELECT 1
   FROM public.notifications n
  WHERE ((n.id = notification_reads.notification_id) AND (n.organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.notifications n
  WHERE ((n.id = notification_reads.notification_id) AND (n.organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)))));


--
-- Name: answerbit_api_calls tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_api_calls TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_article_mappings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_article_mappings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_brand_mappings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_brand_mappings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_competitor_mappings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_competitor_mappings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_connections tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_connections TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_credential_assignments tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_credential_assignments TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_prompt_mappings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_prompt_mappings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_team_bindings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_team_bindings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: answerbit_title_mappings tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.answerbit_title_mappings TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: article_generation_jobs tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.article_generation_jobs TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: balance_accounts tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.balance_accounts TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: balance_transactions tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.balance_transactions TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: brand_access tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.brand_access TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: notification_rules tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.notification_rules TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: notifications tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.notifications TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: operation_logs tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.operation_logs TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: organization_members tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.organization_members TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: organization_user_feature_scopes tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.organization_user_feature_scopes TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: organizations tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.organizations TO geo_tenant_app USING ((id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: platform_subscriptions tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.platform_subscriptions TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: publication_orders tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.publication_orders TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: quota_ledgers tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.quota_ledgers TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: report_exports tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.report_exports TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: saved_views tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.saved_views TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: subscription_entitlements tenant_organization_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_organization_isolation ON public.subscription_entitlements TO geo_tenant_app USING ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid));


--
-- Name: users tenant_user_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_user_isolation ON public.users FOR SELECT TO geo_tenant_app USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.user_id = users.id) AND (m.organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid)))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO geo_tenant_app;
GRANT USAGE ON SCHEMA public TO geo_platform_app;


--
-- Name: TYPE answerbit_credential_scope; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TYPE public.answerbit_credential_scope TO geo_tenant_app;
GRANT ALL ON TYPE public.answerbit_credential_scope TO geo_platform_app;


--
-- Name: TABLE accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.accounts TO geo_platform_app;


--
-- Name: TABLE answerbit_api_calls; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_api_calls TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_api_calls TO geo_tenant_app;


--
-- Name: TABLE answerbit_article_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_article_mappings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_article_mappings TO geo_tenant_app;


--
-- Name: TABLE answerbit_brand_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_brand_mappings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_brand_mappings TO geo_tenant_app;


--
-- Name: TABLE answerbit_competitor_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_competitor_mappings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_competitor_mappings TO geo_tenant_app;


--
-- Name: TABLE answerbit_connections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_connections TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_connections TO geo_tenant_app;


--
-- Name: TABLE answerbit_credential_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.answerbit_credential_assignments TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_credential_assignments TO geo_platform_app;


--
-- Name: TABLE answerbit_prompt_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_prompt_mappings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_prompt_mappings TO geo_tenant_app;


--
-- Name: TABLE answerbit_team_bindings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_team_bindings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_team_bindings TO geo_tenant_app;


--
-- Name: TABLE answerbit_title_mappings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_title_mappings TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.answerbit_title_mappings TO geo_tenant_app;


--
-- Name: TABLE article_generation_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.article_generation_jobs TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.article_generation_jobs TO geo_tenant_app;


--
-- Name: TABLE balance_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.balance_accounts TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.balance_accounts TO geo_tenant_app;


--
-- Name: TABLE balance_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.balance_transactions TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.balance_transactions TO geo_tenant_app;


--
-- Name: TABLE billing_plan_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.billing_plan_versions TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.billing_plan_versions TO geo_platform_app;


--
-- Name: TABLE billing_plans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.billing_plans TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.billing_plans TO geo_platform_app;


--
-- Name: TABLE brand_access; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brand_access TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.brand_access TO geo_tenant_app;


--
-- Name: TABLE feature_point_costs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feature_point_costs TO geo_platform_app;
GRANT SELECT ON TABLE public.feature_point_costs TO geo_tenant_app;


--
-- Name: TABLE member_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_roles TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_roles TO geo_tenant_app;


--
-- Name: TABLE notification_reads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_reads TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_reads TO geo_tenant_app;


--
-- Name: TABLE notification_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_rules TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_rules TO geo_tenant_app;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO geo_tenant_app;


--
-- Name: TABLE operation_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.operation_logs TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.operation_logs TO geo_tenant_app;


--
-- Name: TABLE organization_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_members TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_members TO geo_tenant_app;


--
-- Name: TABLE organization_user_feature_scopes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_user_feature_scopes TO geo_platform_app;
GRANT SELECT ON TABLE public.organization_user_feature_scopes TO geo_tenant_app;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organizations TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organizations TO geo_tenant_app;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.permissions TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permissions TO geo_platform_app;


--
-- Name: TABLE platform_answerbit_brands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_answerbit_brands TO geo_platform_app;


--
-- Name: TABLE platform_answerbit_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_answerbit_credentials TO geo_platform_app;


--
-- Name: TABLE platform_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_subscriptions TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_subscriptions TO geo_tenant_app;


--
-- Name: TABLE platform_user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_user_roles TO geo_platform_app;


--
-- Name: TABLE publication_channels; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.publication_channels TO geo_platform_app;
GRANT SELECT ON TABLE public.publication_channels TO geo_tenant_app;


--
-- Name: TABLE publication_orders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.publication_orders TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.publication_orders TO geo_tenant_app;


--
-- Name: TABLE quota_ledgers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quota_ledgers TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quota_ledgers TO geo_tenant_app;


--
-- Name: TABLE report_exports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_exports TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_exports TO geo_tenant_app;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.role_permissions TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO geo_platform_app;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.roles TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO geo_platform_app;


--
-- Name: TABLE runtime_heartbeats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_heartbeats TO geo_platform_app;


--
-- Name: TABLE runtime_task_statuses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.runtime_task_statuses TO geo_platform_app;


--
-- Name: TABLE saved_views; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_views TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_views TO geo_tenant_app;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO geo_platform_app;


--
-- Name: TABLE subscription_entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscription_entitlements TO geo_platform_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscription_entitlements TO geo_tenant_app;


--
-- Name: TABLE system_release_state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.system_release_state TO geo_platform_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.users TO geo_tenant_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO geo_platform_app;


--
-- Name: TABLE verifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.verifications TO geo_platform_app;

INSERT INTO public.system_release_state (component, version)
VALUES ('schema', 'v1')
ON CONFLICT (component) DO UPDATE
SET version = excluded.version, updated_at = now();
