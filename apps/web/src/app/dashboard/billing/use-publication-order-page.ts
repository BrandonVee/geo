"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  publicationOrderQuerySchema,
  type PublicationOrderQuery,
} from "@geo/contracts";

type Filters = Pick<
  PublicationOrderQuery,
  "page" | "pageSize" | "keyword" | "status" | "beginDate" | "endDate"
>;
type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

// @project-doc docs/domains/geo_operations.md#publication_orders
export function usePublicationOrderPage<T>(
  scope: {
    organizationId: string;
    teamBindingId: string;
    brandId: string;
  },
  enabled: boolean,
) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const serialized = params.toString();
  const { organizationId, teamBindingId, brandId } = scope;
  const query = useMemo(() => {
    const params = new URLSearchParams(serialized);
    const matches =
      (!params.get("organizationId") ||
        params.get("organizationId") === organizationId) &&
      (!params.get("brandId") || params.get("brandId") === brandId);
    const filters = matches
      ? Object.fromEntries(
          ["page", "pageSize", "keyword", "status", "beginDate", "endDate"]
            .filter((key) => params.has(key))
            .map((key) => [key, params.get(key)]),
        )
      : {};
    const parsed = publicationOrderQuerySchema.safeParse({
      ...filters,
      organizationId,
      teamBindingId,
      brandId,
    });
    return parsed.success
      ? parsed.data
      : ({
          organizationId,
          teamBindingId,
          brandId,
          page: 1,
          pageSize: 20,
          keyword: "",
        } as PublicationOrderQuery);
  }, [serialized, organizationId, teamBindingId, brandId]);
  const url = `/api/v1/publication-orders?${new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  )}`;
  const currentKey = useRef(url);
  useEffect(() => {
    currentKey.current = url;
  }, [url]);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    list: T[];
    pagination: Pagination;
  }>();
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const update = useCallback(
    (change: Partial<Filters>) => {
      const params = new URLSearchParams(serialized);
      params.set("organizationId", organizationId);
      params.set("brandId", brandId);
      params.delete("teamBindingId");
      const next = { ...query, ...change };
      for (const key of [
        "page",
        "pageSize",
        "keyword",
        "status",
        "beginDate",
        "endDate",
      ] as const) {
        const value = next[key];
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, String(value));
      }
      if (params.toString() === serialized) return;
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      setSnapshot(undefined);
      setFailure(undefined);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [serialized, organizationId, brandId, query, router, pathname],
  );
  const refresh = useCallback(async () => {
    if (!enabled || !organizationId || !teamBindingId || !brandId) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReading(true);
    setFailure(undefined);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "发布订单读取失败");
      if (
        controller.signal.aborted ||
        currentKey.current !== url ||
        controllerRef.current !== controller
      )
        return;
      if (!Array.isArray(body.data) || !body.pagination)
        throw new Error("发布订单暂时无法读取，请重试");
      setSnapshot({ key: url, list: body.data, pagination: body.pagination });
      if (body.pagination.page !== query.page)
        update({ page: body.pagination.page });
    } catch (error) {
      if (
        !controller.signal.aborted &&
        currentKey.current === url &&
        controllerRef.current === controller
      )
        setFailure({
          key: url,
          message: error instanceof Error ? error.message : "发布订单读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setReading(false);
      }
    }
  }, [
    enabled,
    organizationId,
    teamBindingId,
    brandId,
    url,
    query.page,
    update,
  ]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const poll = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !controllerRef.current
      )
        void refresh();
    };
    const timer = window.setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
    };
  }, [enabled, refresh]);
  const active = snapshot?.key === url && enabled ? snapshot : undefined;
  return {
    query,
    update,
    refresh,
    list: active?.list ?? [],
    pagination: active?.pagination ?? {
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
      pages: 0,
    },
    loading: enabled && reading,
    error: enabled && failure?.key === url ? failure.message : "",
  };
}
