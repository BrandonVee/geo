"use client";

import {
  adminOrganizationPageQuerySchema,
  type AdminOrganizationPageQuery,
} from "@geo/contracts";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Input,
  Select,
  Space,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccessibleTable } from "../accessible-table";

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  serviceExpiresAt: string | null;
  pointsExpiresAt: string | null;
  accessState?: "active" | "suspended" | "expired";
  pointsExpired?: boolean;
  memberCount: number;
  answerbitBrandId: string | null;
  answerbitBrandName: string | null;
  createdAt: string;
};
type DirectoryPage = {
  list: AdminOrganization[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
const queryKeys = {
  page: "orgPage",
  pageSize: "orgPageSize",
  q: "orgKeyword",
  accessState: "orgAccessState",
} as const;

// @project-doc docs/architecture/platform_administration.md#enterprise_directory
export function AdminOrganizationDirectory({
  columns,
  refreshVersion,
  compact,
  mobile,
}: {
  columns: TableColumnsType<AdminOrganization>;
  refreshVersion: number;
  compact: boolean;
  mobile: boolean;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const serialized = search.toString();
  const [navigating, startTransition] = useTransition();
  const query = useMemo(() => {
    const params = new URLSearchParams(serialized);
    const parsed = adminOrganizationPageQuerySchema.safeParse(
      Object.fromEntries(
        Object.entries(queryKeys)
          .filter(([, key]) => params.has(key))
          .map(([field, key]) => [field, params.get(key)]),
      ),
    );
    return parsed.success
      ? parsed.data
      : adminOrganizationPageQuerySchema.parse({});
  }, [serialized]);
  const url = `/api/v1/admin/organizations?${new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  )}`;
  const requestKey = `${url}:${refreshVersion}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value: DirectoryPage;
  }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [reading, setReading] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const update = useCallback(
    (change: Partial<AdminOrganizationPageQuery>) => {
      const params = new URLSearchParams(serialized);
      for (const [field, key] of Object.entries(queryKeys)) {
        const value = { ...query, ...change }[
          field as keyof AdminOrganizationPageQuery
        ];
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, String(value));
      }
      if (params.toString() === serialized) return;
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      setSnapshot(undefined);
      setFailure(undefined);
      startTransition(() =>
        router.replace(`${pathname}?${params}`, { scroll: false }),
      );
    },
    [pathname, query, router, serialized],
  );
  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReading(true);
    setFailure(undefined);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "企业目录读取失败");
      const value = body.data as DirectoryPage;
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      setSnapshot({ key: requestKey, value });
      if (value.pagination.page !== query.page)
        update({ page: value.pagination.page });
    } catch (reason) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          key: requestKey,
          message:
            reason instanceof Error ? reason.message : "企业目录读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setReading(false);
      }
    }
  }, [query.page, requestKey, update, url]);
  useEffect(() => {
    if (navigating) return;
    void refresh();
    const poll = () => {
      if (!document.hidden && navigator.onLine && !controllerRef.current)
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
  }, [navigating, refresh]);
  const active =
    !navigating && snapshot?.key === requestKey ? snapshot.value : undefined;
  const readFailure =
    !navigating && failure?.key === requestKey ? failure.message : undefined;
  const clear = () => update({ page: 1, q: undefined, accessState: undefined });
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Flex gap={12} justify="space-between" wrap>
        <Input.Search
          key={query.q ?? ""}
          defaultValue={query.q ?? ""}
          allowClear
          enterButton="搜索"
          maxLength={200}
          aria-label="搜索企业或品牌"
          placeholder="搜索企业、品牌名称或 BrandID"
          style={{ maxWidth: 420, minWidth: mobile ? "100%" : 320 }}
          onSearch={(value) =>
            update({ page: 1, q: value.trim() || undefined })
          }
          onChange={(event) => {
            if (!event.target.value && query.q)
              update({ page: 1, q: undefined });
          }}
        />
        <Space wrap>
          <Select<"all" | "active" | "suspended" | "expired">
            aria-label="筛选企业状态"
            value={query.accessState ?? "all"}
            style={{ width: 148 }}
            options={[
              { label: "全部状态", value: "all" },
              { label: "正常", value: "active" },
              { label: "手动冻结", value: "suspended" },
              { label: "到期冻结", value: "expired" },
            ]}
            onChange={(value) =>
              update({
                page: 1,
                accessState: value === "all" ? undefined : value,
              })
            }
          />
          {query.q || query.accessState ? (
            <Button type="text" onClick={clear}>
              重置筛选
            </Button>
          ) : null}
        </Space>
      </Flex>
      {readFailure ? (
        <Alert
          type="error"
          showIcon
          message="企业目录读取失败"
          description={readFailure}
          action={
            <Button onClick={() => void refresh()} disabled={reading}>
              重试读取企业目录
            </Button>
          }
        />
      ) : null}
      <AccessibleTable<AdminOrganization>
        columns={columns}
        dataSource={active?.list ?? []}
        rowKey="id"
        loading={navigating || reading || (!active && !readFailure)}
        scrollRegionLabel="腾讯企业目录，可横向滚动"
        scroll={{ x: compact ? 900 : 1060 }}
        onChange={(pagination) =>
          update({
            page:
              pagination.pageSize !== query.pageSize
                ? 1
                : (pagination.current ?? 1),
            pageSize: pagination.pageSize ?? 20,
          })
        }
        pagination={{
          current: active?.pagination.page ?? query.page,
          pageSize: query.pageSize,
          total: active?.pagination.total ?? 0,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 家腾讯企业`,
        }}
        locale={{
          emptyText: readFailure ? (
            <Typography.Text type="secondary">
              企业目录暂不可用，请重试读取
            </Typography.Text>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  {query.q || query.accessState
                    ? "没有符合条件的企业"
                    : "暂无腾讯企业"}
                </Typography.Text>
              }
            />
          ),
        }}
      />
    </Space>
  );
}
