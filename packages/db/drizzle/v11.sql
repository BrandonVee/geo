-- Restricted historical actor projection: no email, credentials or arbitrary user lookup.
CREATE FUNCTION public.tenant_balance_actors(search_pattern text DEFAULT NULL, selected_user_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.name, u.username::text
  FROM public.users u
  WHERE EXISTS (
    SELECT 1 FROM public.balance_transactions t
    WHERE t.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
      AND t.actor_user_id = u.id
  )
  AND EXISTS (
    SELECT 1 FROM public.organization_members m
    JOIN public.member_roles mr ON mr.member_id = m.id
    JOIN public.roles r ON r.id = mr.role_id
    JOIN public.users caller ON caller.id = m.user_id
    WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.status = 'active' AND caller.status = 'active' AND r.code = 'tenant_admin'
  )
  AND (selected_user_id IS NULL OR u.id = selected_user_id)
  AND (search_pattern IS NULL OR u.name ILIKE search_pattern OR u.username ILIKE search_pattern)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_balance_actors(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_balance_actors(text, uuid) TO geo_tenant_app;
--> statement-breakpoint
INSERT INTO public.system_release_state (component, version) VALUES ('schema', 'v11')
ON CONFLICT (component) DO UPDATE SET version = excluded.version, updated_at = now();
