"use client";
import { Flex, Select, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  storeBrandId,
  storeOrganizationId,
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
  const [organizationId, setOrganizationIdState] = useState(
    organizations[0]?.id ?? "",
  );
  const [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<ScopeBrand[]>([]);
  const [error, setError] = useState("");
  const [scopeRestored, setScopeRestored] = useState(false);
  const [brandLoadVersion, setBrandLoadVersion] = useState(0);
  const setOrganizationId = useCallback((nextOrganizationId: string) => {
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
      readStoredOrganizationId(availableIds) || organizations[0]?.id || "",
    );
    setScopeRestored(true);
  }, [organizations, setOrganizationId]);
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
        setBrandId(
          readStoredBrandId(
            organizationId,
            next.map((item: ScopeBrand) => item.id),
          ) ||
            next[0]?.id ||
            "",
        );
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(reason instanceof Error ? reason.message : "品牌加载失败");
      });
    return () => controller.abort();
  }, [brandLoadVersion, organizationId, scopeRestored, teamBindingId]);
  useEffect(() => {
    if (organizationId && brandId) storeBrandId(organizationId, brandId);
  }, [organizationId, brandId]);
  const brand = brands.find((item) => item.id === brandId);
  const canWrite = Boolean(brand && brand.accessRole !== "brand_viewer");
  const canDelete = Boolean(
    brand && ["tenant_admin", "brand_admin"].includes(brand.accessRole),
  );
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
    error,
    setError,
    reloadBrands,
  };
}
export function ScopeFields({
  organizations,
  scope,
}: {
  organizations: ScopeOrganization[];
  scope: ReturnType<typeof useAnswerBitScope>;
}) {
  return (
    <Flex gap={12} style={{ width: "100%" }} wrap>
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
          placeholder="尚未分配企业"
          value={scope.organizationId || undefined}
        />
      </Flex>
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
    </Flex>
  );
}
export const scopeQuery = query;
