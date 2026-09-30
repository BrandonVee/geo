"use client";
import { Alert, Button, Flex, Select, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import type { Permission, OrganizationFeature } from "@geo/core";
import { useWorkspaceAccess, workspacePermission } from "./workspace-access";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  storeBrandId,
  storeOrganizationId,
  selectScopeId,
} from "./scope-storage";
export type ScopeOrganization = {
  id: string;
  name: string;
  role: string | null;
  teamBindingId: string;
};
export type ScopeBrand = {
  id: string;
  name: string;
  accessRole: "tenant_admin" | "brand_admin" | "brand_editor" | "brand_viewer";
};
const query = (input: Record<string, string>) =>
  new URLSearchParams(input).toString();
export function useAnswerBitScope(organizations: ScopeOrganization[]) {
  const workspace = useWorkspaceAccess();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const searchParams = useSearchParams();
  const requestedOrganizationId = searchParams.get("organizationId");
  const requestedBrandId = searchParams.get("brandId");
  const [organizationId, setOrganizationIdState] = useState(
    organizations[0]?.id ?? "",
  );
  const organizationIdRef = useRef(organizationId);
  const [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<ScopeBrand[]>([]);
  const [error, setError] = useState("");
  const [scopeRestored, setScopeRestored] = useState(false);
  const [brandLoadVersion, setBrandLoadVersion] = useState(0);
  const setOrganizationId = useCallback((nextOrganizationId: string) => {
    if (organizationIdRef.current === nextOrganizationId) return;
    organizationIdRef.current = nextOrganizationId;
    setBrands([]);
    setBrandId("");
    setError("");
    setOrganizationIdState(nextOrganizationId);
  }, []);
  const teamBindingId =
    organizations.find((item) => item.id === organizationId)?.teamBindingId ??
    "";
  const reloadBrands = useCallback(() => {
    setError("");
    setBrandLoadVersion((current) => current + 1);
  }, []);
  useEffect(() => {
    const availableIds = organizations.map((item) => item.id);
    setOrganizationId(
      selectScopeId(
        requestedOrganizationId,
        readStoredOrganizationId(availableIds),
        availableIds,
      ),
    );
    setScopeRestored(true);
  }, [organizations, requestedOrganizationId, setOrganizationId]);
  useEffect(() => {
    if (!scopeRestored) return;
    if (!organizationId) {
      setBrands([]);
      setBrandId("");
      return;
    }
    storeOrganizationId(organizationId);
  }, [organizationId, scopeRestored]);
  useEffect(() => {
    if (!scopeRestored || !teamBindingId) {
      setBrands([]);
      setBrandId("");
      return;
    }
    const controller = new AbortController();
    setError("");
    setBrands([]);
    setBrandId("");
    fetch(
      `/api/v1/answerbit/brands?${query({ organizationId, teamBindingId })}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message);
        if (controller.signal.aborted) return;
        const next = body.data ?? [];
        setBrands(next);
        const availableIds = next.map((item: ScopeBrand) => item.id);
        setBrandId(
          selectScopeId(
            !requestedOrganizationId ||
              requestedOrganizationId === organizationId
              ? requestedBrandId
              : null,
            readStoredBrandId(organizationId, availableIds),
            availableIds,
          ),
        );
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "品牌加载失败");
      });
    return () => controller.abort();
  }, [
    brandLoadVersion,
    organizationId,
    scopeRestored,
    teamBindingId,
    requestedOrganizationId,
    requestedBrandId,
  ]);
  useEffect(() => {
    if (organizationId && brandId) storeBrandId(organizationId, brandId);
  }, [organizationId, brandId]);
  const brand = brands.find((item) => item.id === brandId);
  const organization = workspace.organizations.find(
    (item) => item.id === organizationId,
  );
  const serviceExpired = Boolean(
    organization?.serviceExpiresAt &&
      new Date(organization.serviceExpiresAt).getTime() <= now,
  );
  const pointsExpired = Boolean(
    organization?.pointsExpiresAt &&
      new Date(organization.pointsExpiresAt).getTime() <= now,
  );
  const serviceUnavailable =
    serviceExpired || Boolean(organization && organization.status !== "active");
  const can = (permission: Permission, feature?: OrganizationFeature) =>
    !serviceUnavailable &&
    workspacePermission(organization, brand?.accessRole, permission, feature);
  const canWrite = can("resource.create");
  const canDelete = Boolean(can("resource.delete"));
  return {
    organizationId,
    setOrganizationId,
    teamBindingId,
    brandId,
    setBrandId,
    brands,
    brand,
    canWrite,
    canDelete,
    can,
    organization,
    serviceExpired,
    pointsExpired,
    serviceUnavailable,
    error,
    setError,
    reloadBrands,
  };
}
export function ScopeFields({
  organizations,
  scope,
  showBrand = true,
}: {
  organizations: ScopeOrganization[];
  scope: ReturnType<typeof useAnswerBitScope>;
  showBrand?: boolean;
}) {
  return (
    <Flex gap={12} style={{ width: "100%" }} wrap>
      {scope.organization &&
      (scope.serviceUnavailable || scope.pointsExpired) ? (
        <Alert
          type="warning"
          showIcon
          style={{ width: "100%" }}
          message={
            scope.serviceExpired
              ? "企业服务已到期"
              : scope.serviceUnavailable
                ? "企业已被冻结"
                : "企业积分已到期"
          }
          description={
            scope.serviceUnavailable
              ? "请联系平台管理员处理。您可以切换到其他已授权企业继续操作。"
              : "积分余额会保留，请联系平台管理员续期；人民币发布业务可继续使用。"
          }
        />
      ) : null}
      {!organizations.length ? (
        <Alert
          message="尚未分配企业"
          description="请联系平台管理员分配企业与品牌权限，完成后刷新页面。"
          showIcon
          type="info"
          style={{ width: "100%" }}
        />
      ) : null}
      {scope.error ? (
        <Alert
          message={scope.error}
          showIcon
          type="error"
          style={{ width: "100%" }}
          action={<Button onClick={scope.reloadBrands}>重试加载品牌</Button>}
        />
      ) : null}
      <Flex style={{ flex: "1 1 200px", minWidth: 180 }} vertical>
        <label htmlFor="answerbit-scope-organization">
          <Typography.Text type="secondary">企业</Typography.Text>
        </label>
        <Select
          disabled={!organizations.length}
          id="answerbit-scope-organization"
          onChange={scope.setOrganizationId}
          options={organizations.map((item) => ({
            label: item.name,
            value: item.id,
          }))}
          showSearch
          optionFilterProp="label"
          placeholder="尚未分配企业"
          value={scope.organizationId || undefined}
        />
      </Flex>
      {showBrand ? (
        <Flex style={{ flex: "1 1 200px", minWidth: 180 }} vertical>
          <label htmlFor="answerbit-scope-brand">
            <Typography.Text type="secondary">品牌</Typography.Text>
          </label>
          <Select
            disabled={!scope.teamBindingId || !scope.brands.length}
            id="answerbit-scope-brand"
            onChange={scope.setBrandId}
            options={scope.brands.map((item) => ({
              label: item.name,
              value: item.id,
            }))}
            placeholder="选择品牌"
            value={scope.brandId || undefined}
          />
        </Flex>
      ) : null}
    </Flex>
  );
}
export const scopeQuery = query;
