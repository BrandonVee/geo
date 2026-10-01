"use client";
import { Alert, Button, Flex, Select, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
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
  scopedDashboardPath,
} from "./scope-storage";
import { useDirectoryRead } from "./directory-read";
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
const emptyBrands: ScopeBrand[] = [];
const emptyQueryKeys: readonly string[] = [];
// @project-doc docs/domains/geo_operations.md#workspace_scope
export function useAnswerBitScope(
  organizations: ScopeOrganization[],
  resetQueryKeys: readonly string[] = emptyQueryKeys,
) {
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
  const [selection, setSelection] = useState<{
    key: string;
    id: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [scopeRestored, setScopeRestored] = useState(false);
  const teamBindingId =
    organizations.find((item) => item.id === organizationId)?.teamBindingId ??
    "";
  const scopeKey = `${organizationId}:${teamBindingId}`;
  const brandRead = useDirectoryRead<ScopeBrand[]>(
    scopeRestored && teamBindingId
      ? `/api/v1/answerbit/brands?${query({ organizationId, teamBindingId })}`
      : null,
  );
  const brands = brandRead.data ?? emptyBrands;
  const brandId =
    selection?.key === scopeKey &&
    brands.some((item) => item.id === selection.id)
      ? selection.id
      : "";
  const replaceScopeUrl = useCallback(
    (nextOrganizationId: string, nextBrandId?: string) => {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const next = scopedDashboardPath(
        current,
        nextOrganizationId,
        nextBrandId,
        resetQueryKeys,
      );
      if (next !== current) window.history.replaceState(null, "", next);
    },
    [resetQueryKeys],
  );
  const setOrganizationId = useCallback(
    (nextOrganizationId: string) => {
      if (organizationIdRef.current === nextOrganizationId) return;
      if (
        nextOrganizationId &&
        !organizations.some((item) => item.id === nextOrganizationId)
      )
        return;
      organizationIdRef.current = nextOrganizationId;
      setSelection(null);
      setError("");
      setOrganizationIdState(nextOrganizationId);
    },
    [organizations],
  );
  function chooseOrganization(nextOrganizationId: string) {
    if (nextOrganizationId === organizationId) return;
    if (!organizations.some((item) => item.id === nextOrganizationId)) return;
    replaceScopeUrl(nextOrganizationId);
    setOrganizationId(nextOrganizationId);
  }
  function setBrandId(nextBrandId: string) {
    if (!brands.some((item) => item.id === nextBrandId)) return;
    replaceScopeUrl(organizationId, nextBrandId);
    setSelection({ key: scopeKey, id: nextBrandId });
  }
  function reloadBrands() {
    setError("");
    void brandRead.reload();
  }
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
    setError(brandRead.error);
  }, [brandRead.error, brandRead.failures, brandRead.successVersion]);
  useEffect(() => {
    if (!brandRead.data) return;
    const availableIds = brandRead.data.map((item) => item.id);
    setSelection((current) => {
      const selected = selectScopeId(
        !requestedOrganizationId || requestedOrganizationId === organizationId
          ? requestedBrandId
          : null,
        current?.key === scopeKey && availableIds.includes(current.id)
          ? current.id
          : readStoredBrandId(organizationId, availableIds),
        availableIds,
      );
      return current?.key === scopeKey && current.id === selected
        ? current
        : { key: scopeKey, id: selected };
    });
  }, [
    brandRead.data,
    organizationId,
    scopeKey,
    requestedOrganizationId,
    requestedBrandId,
  ]);
  useEffect(() => {
    if (scopeRestored && organizationId) storeOrganizationId(organizationId);
  }, [organizationId, scopeRestored]);
  useEffect(() => {
    if (!scopeRestored || !organizationId) return;
    if (
      requestedOrganizationId &&
      requestedOrganizationId !== organizationId &&
      organizations.some((item) => item.id === requestedOrganizationId)
    )
      return;
    if (
      requestedBrandId &&
      requestedBrandId !== brandId &&
      brands.some((item) => item.id === requestedBrandId)
    )
      return;
    if (brandId) {
      storeBrandId(organizationId, brandId);
      replaceScopeUrl(organizationId, brandId);
    } else if (brandRead.data?.length === 0) replaceScopeUrl(organizationId);
  }, [
    organizationId,
    brandId,
    scopeRestored,
    requestedOrganizationId,
    requestedBrandId,
    organizations,
    brands,
    brandRead.data,
    replaceScopeUrl,
  ]);
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
    setOrganizationId: chooseOrganization,
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
    error: error ? brandRead.error : "",
    setError,
    reloadBrands,
    brandsLoading: brandRead.loading,
    brandsLoaded: Boolean(brandRead.data),
    scopeRestored,
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
      {showBrand &&
      scope.teamBindingId &&
      scope.brandsLoaded &&
      !scope.brandsLoading &&
      !scope.error &&
      !scope.brands.length ? (
        <Alert
          type="info"
          showIcon
          style={{ width: "100%" }}
          message="当前企业没有可访问品牌"
          description="请联系企业管理员确认品牌授权，或切换到其他已授权企业。"
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
          <Flex align="center" gap={8}>
            <Select
              style={{ flex: 1, minWidth: 0 }}
              disabled={!scope.teamBindingId || !scope.brands.length}
              id="answerbit-scope-brand"
              loading={scope.brandsLoading}
              onChange={scope.setBrandId}
              options={scope.brands.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
              placeholder="选择品牌"
              value={scope.brandId || undefined}
            />
            <Button
              aria-label="刷新品牌范围"
              title="重新读取可访问品牌"
              disabled={!scope.teamBindingId}
              loading={scope.brandsLoading}
              icon={<ReloadOutlined />}
              onClick={scope.reloadBrands}
            />
          </Flex>
        </Flex>
      ) : null}
    </Flex>
  );
}
export const scopeQuery = query;
