"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Flex,
  Input,
  List,
  Pagination,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  reportExportListQuerySchema,
  type ReportExportFilters,
  type ReportExportListQuery,
} from "@geo/contracts";
export type ExportJob = {
  id: string;
  reportType: "answers" | "domain_rank" | "article_rank";
  status: string;
  filename: string | null;
  rowCount: number | null;
  downloadUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  errorMessage: string | null;
  filters: ReportExportFilters | null;
};
type ReportPage = {
  list: ExportJob[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
const labels = {
  answers: "回答 CSV",
  domain_rank: "域名 CSV",
  article_rank: "文章 CSV",
};
const statuses = {
  queued: "等待生成",
  running: "正在生成",
  succeeded: "可下载",
  failed: "生成失败",
  expired: "文件已过期",
};
const keys = {
  page: "reportPage",
  pageSize: "reportPageSize",
  q: "reportQ",
  reportType: "reportType",
  status: "reportStatus",
  beginDate: "reportBeginDate",
  endDate: "reportEndDate",
} as const;
export function useReportHistory(
  scope: { organizationId: string; teamBindingId: string; brandId: string },
  enabled: boolean,
) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const [navigating, startTransition] = useTransition();
  const raw: Record<string, unknown> = { ...scope, pageSize: 5 };
  if (
    search.get("reportOrganizationId") === scope.organizationId &&
    search.get("reportBrandId") === scope.brandId
  )
    for (const [field, key] of Object.entries(keys)) {
      const value = search.get(key);
      if (value) raw[field] = value;
    }
  const parsed = reportExportListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : reportExportListQuerySchema.parse({
        organizationId:
          scope.organizationId || "11111111-1111-4111-8111-111111111111",
        teamBindingId:
          scope.teamBindingId || "11111111-1111-4111-8111-111111111111",
        brandId: scope.brandId || "pending",
        pageSize: 5,
      });
  const url = `/api/v1/report-exports?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`;
  const [snapshot, setSnapshot] = useState<{ url: string; data: ReportPage }>();
  const [failure, setFailure] = useState<{ url: string; message: string }>();
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    if (!enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "报告记录读取失败");
      if (!controller.signal.aborted && controllerRef.current === controller)
        setSnapshot({ url, data: body.data });
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          url,
          message: error instanceof Error ? error.message : "报告记录读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [enabled, url]);
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);
  const refresh = useCallback(() => latestLoad.current(), []);
  useEffect(() => {
    void load();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
    };
  }, [load]);
  const error = failure?.url === url ? failure.message : undefined;
  const data = !error && snapshot?.url === url ? snapshot.data : undefined;
  const active = data?.list.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  useEffect(() => {
    if (!enabled) return;
    const poll = () => {
      if (!document.hidden && navigator.onLine && !controllerRef.current)
        void load();
    };
    const timer = window.setInterval(poll, active ? 5000 : 60_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
    };
  }, [load, enabled, active]);
  function change(patch: Partial<ReportExportListQuery>) {
    const next = { ...query, page: 1, ...patch },
      params = new URLSearchParams(search);
    params.set("organizationId", scope.organizationId);
    params.set("brandId", scope.brandId);
    params.set("reportOrganizationId", scope.organizationId);
    params.set("reportBrandId", scope.brandId);
    for (const [field, key] of Object.entries(keys)) {
      const value = next[field as keyof typeof keys];
      if (value !== undefined && value !== "") params.set(key, String(value));
      else params.delete(key);
    }
    startTransition(() =>
      router.replace(`${pathname}?${params}`, { scroll: false }),
    );
  }
  function markExpired(id: string) {
    setSnapshot((current) =>
      current?.url === url
        ? {
            ...current,
            data: {
              ...current.data,
              list: current.data.list.map((job) =>
                job.id === id
                  ? { ...job, status: "expired", downloadUrl: null }
                  : job,
              ),
            },
          }
        : current,
    );
  }
  return {
    markExpired,
    query,
    data,
    loading,
    navigating,
    error,
    invalid: !parsed.success,
    refresh,
    change,
  };
}
export function ReportHistory({
  history,
  busy,
  onDownload,
  onExport,
  canExportJob,
}: {
  history: ReturnType<typeof useReportHistory>;
  busy: string;
  onDownload: (job: ExportJob) => void;
  onExport: (job: ExportJob) => void;
  canExportJob?: (job: ExportJob) => boolean;
}) {
  const { query, data, loading, navigating, error, invalid, refresh, change } =
    history;
  const [draft, setDraft] = useState(query.q);
  useEffect(() => {
    setDraft(query.q);
  }, [query.q]);
  return (
    <Space
      role="region"
      aria-label="报告记录"
      direction="vertical"
      size="middle"
      style={{ width: "100%", marginTop: 20 }}
    >
      <Typography.Text strong>报告记录</Typography.Text>
      {invalid ? (
        <Alert type="warning" showIcon message="报告筛选参数无效，请重新选择" />
      ) : null}
      <Flex gap={12} wrap align="flex-end">
        <Input.Search
          type="search"
          aria-label="搜索报告名称、编号或原关键词"
          placeholder="报告名称、编号或原关键词"
          allowClear
          maxLength={500}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onSearch={(q) => change({ q })}
          style={{ minWidth: 200, flex: "1 1 260px" }}
        />
        <Select
          aria-label="按报告类型筛选"
          allowClear
          placeholder="全部类型"
          value={query.reportType}
          onChange={(reportType) => change({ reportType })}
          options={Object.entries(labels).map(([value, label]) => ({
            value,
            label,
          }))}
          style={{ minWidth: 140, flex: "1 1 140px" }}
        />
        <Select
          aria-label="按报告状态筛选"
          allowClear
          placeholder="全部状态"
          value={query.status}
          onChange={(status) => change({ status })}
          options={Object.entries(statuses).map(([value, label]) => ({
            value,
            label,
          }))}
          style={{ minWidth: 140, flex: "1 1 140px" }}
        />
        <Flex vertical style={{ minWidth: 0, flex: "1 1 280px" }}>
          <label htmlFor="report-begin">提交日期（北京时间）</label>
          <label
            htmlFor="report-end"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0, 0, 0, 0)",
            }}
          >
            报告结束日期
          </label>
          <DatePicker.RangePicker
            id={{ start: "report-begin", end: "report-end" }}
            allowEmpty={[true, true]}
            placeholder={["开始日期", "结束日期"]}
            value={
              query.beginDate || query.endDate
                ? [
                    query.beginDate ? dayjs(query.beginDate) : null,
                    query.endDate ? dayjs(query.endDate) : null,
                  ]
                : null
            }
            onChange={(dates) =>
              change({
                beginDate: dates?.[0]?.format("YYYY-MM-DD"),
                endDate: dates?.[1]?.format("YYYY-MM-DD"),
              })
            }
            style={{ width: "100%" }}
          />
        </Flex>
        <Button
          onClick={() =>
            change({
              q: "",
              reportType: undefined,
              status: undefined,
              beginDate: undefined,
              endDate: undefined,
            })
          }
        >
          清除报告筛选
        </Button>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void refresh()}
        >
          刷新报告
        </Button>
      </Flex>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="报告记录读取失败"
          description={error}
          action={<Button onClick={() => void refresh()}>重试读取报告</Button>}
        />
      ) : null}
      <Typography.Text type="secondary">
        {data ? `共 ${data.pagination.total} 份报告` : "报告数量暂不可用"}
      </Typography.Text>
      <List
        loading={loading || navigating || (!data && !error)}
        dataSource={data?.list ?? []}
        size="small"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                error ? "报告记录暂不可用，请重试读取" : "暂无符合条件的报告"
              }
            />
          ),
        }}
        renderItem={(job) => (
          <List.Item
            style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}
            actions={[
              ...(job.downloadUrl
                ? [
                    <Button
                      key="download"
                      size="small"
                      disabled={Boolean(busy)}
                      loading={busy === `download:${job.id}`}
                      icon={<DownloadOutlined />}
                      onClick={() => onDownload(job)}
                    >
                      下载
                    </Button>,
                  ]
                : []),
              ...(["failed", "expired"].includes(job.status) && job.filters
                ? [
                    <Button
                      key="retry"
                      size="small"
                      disabled={
                        Boolean(busy) ||
                        (canExportJob ? !canExportJob(job) : false)
                      }
                      onClick={() => onExport(job)}
                    >
                      重新导出
                    </Button>,
                  ]
                : []),
            ]}
          >
            <List.Item.Meta
              style={{
                minWidth: 0,
                flex: "1 1 260px",
                overflowWrap: "anywhere",
              }}
              title={
                <Typography.Text strong>
                  {job.filename ?? labels[job.reportType] ?? "报告"}
                </Typography.Text>
              }
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text type="secondary">
                    提交于{" "}
                    {new Date(job.createdAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </Typography.Text>
                  {job.filters ? (
                    <Typography.Text type="secondary">
                      数据日期：{job.filters.beginDate} 至 {job.filters.endDate}
                      {job.filters.keyword ? ` · ${job.filters.keyword}` : ""}
                    </Typography.Text>
                  ) : null}
                  <Typography.Text
                    type={job.status === "failed" ? "danger" : "secondary"}
                  >
                    {job.status === "failed"
                      ? (job.errorMessage ?? "生成失败，可重新导出")
                      : job.status === "expired"
                        ? "文件保留时间为 24 小时，已过期，可重新导出"
                        : job.status === "succeeded"
                          ? `${job.rowCount ?? 0} 行 · 文件保留至 ${new Date(job.expiresAt!).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                          : job.status === "queued"
                            ? "等待处理，可离开页面"
                            : "正在生成，可离开页面"}
                  </Typography.Text>
                </Space>
              }
            />
            <Tag>
              {statuses[job.status as keyof typeof statuses] ?? "状态未知"}
            </Tag>
          </List.Item>
        )}
      />
      <Flex justify="flex-end">
        <Pagination
          current={data?.pagination.page ?? query.page}
          pageSize={query.pageSize}
          total={data?.pagination.total ?? 0}
          showSizeChanger
          pageSizeOptions={[5, 10, 20, 50, 100]}
          onChange={(page, pageSize) =>
            change({ page: pageSize === query.pageSize ? page : 1, pageSize })
          }
        />
      </Flex>
    </Space>
  );
}
