"use client";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Spin,
  Drawer,
  Empty,
  Flex,
  Input,
  List,
  Pagination,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { answersSavedViewFiltersSchema } from "@geo/contracts";
import {
  reportTypes,
  useReportAttempts,
  type ReportType,
} from "./report-attempt";
import { useDirectoryRead } from "../directory-read";
import {
  ReportHistory,
  useReportHistory,
  type ExportJob,
} from "./report-history";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";
import {
  findModelUpstreamLabel,
  ModelLabel,
  modelSelectOptions,
} from "../model-display";
const reportLabels = {
  answers: "回答 CSV",
  domain_rank: "域名 CSV",
  article_rank: "文章 CSV",
};
type Task = {
  task_id: string;
  query_id: string;
  query_str: string;
  platform: string;
  language: string;
  zone: string;
  date: string;
  exposure: number;
  score: number;
  avg_rank: number;
  title_name: string;
  trace_article_cnt: number;
};
type Detail = {
  query: string;
  query_id: string;
  score: number;
  zone: string;
  language: string;
  exposure: number;
  rank: number;
  exposure_cnt: number;
  llm_output: string;
  platform: string;
  date: string;
  links: {
    index: number;
    url: string;
    title: string;
    source: number;
    article_id: string;
  }[];
  title_name: string;
};
type Domain = { domain: string; count: number; is_own: boolean };
type Article = {
  article: string;
  url: string;
  domain: string;
  count: number;
  source: number;
  article_id: string;
};
type SavedView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  isDefault: boolean;
};
async function readData<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败，请重试");
  return body.data;
}
const dates = () => {
  const end = dayjs();
  return {
    begin: end.subtract(6, "day").format("YYYY-MM-DD"),
    end: end.format("YYYY-MM-DD"),
  };
};
export function AnswersClient({
  organizations,
  userId,
}: {
  organizations: ScopeOrganization[];
  userId: string;
}) {
  const scope = useAnswerBitScope(organizations);
  return (
    <AnswersWorkspace
      key={`${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`}
      organizations={organizations}
      scope={scope}
      userId={userId}
    />
  );
}
// @project-doc docs/domains/geo_operations.md#answer_evidence_workflow
function AnswersWorkspace({
  organizations,
  scope,
  userId,
}: {
  organizations: ScopeOrganization[];
  scope: ReturnType<typeof useAnswerBitScope>;
  userId: string;
}) {
  const initial = useMemo(() => dates(), []);
  const [beginDate, setBeginDate] = useState(initial.begin);
  const [endDate, setEndDate] = useState(initial.end);
  const [keyword, setKeyword] = useState("");
  const [keywordQuery, setKeywordQuery] = useState("");
  const [mentionBrand, setMentionBrand] = useState("-1");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [domainPage, setDomainPage] = useState(1);
  const [articlePage, setArticlePage] = useState(1);
  const [detailTaskId, setDetailTaskId] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [views, setViews] = useState<SavedView[]>([]);
  const [submittedReport, setSubmittedReport] = useState<ExportJob>();
  const [toolBusy, setToolBusy] = useState("");
  const [toolError, setToolError] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success" | "info">(
    "info",
  );
  const [viewOpen, setViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const reads = useRef<{
    tools?: AbortController;
    detail?: AbortController;
  }>({});
  const mounted = useRef(true);
  const toolSubmitting = useRef(false);
  const reportAttempts = useReportAttempts(userId, {
    organizationId: scope.organizationId,
    teamBindingId: scope.teamBindingId,
    brandId: scope.brandId,
  });
  const canRead = scope.can("answerbit.resource.read");
  const canExport = scope.can("report.export");
  const reportHistory = useReportHistory(
    {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
    },
    canExport && Boolean(scope.brandId),
  );
  const refreshReports = reportHistory.refresh;
  useEffect(() => {
    const job = reportAttempts.completedReport;
    if (!job || !canExport) return;
    setSubmittedReport(job);
    setMessageType(
      ["failed", "expired"].includes(job.status) ? "error" : "success",
    );
    setMessage(
      job.status === "failed"
        ? "上次导出生成失败，可以重新导出。"
        : job.status === "expired"
          ? "上次导出文件已过期，可以重新导出。"
          : "导出任务已提交，可离开页面等待；文件生成后会显示下载入口。",
    );
    void refreshReports();
  }, [reportAttempts.completedReport, canExport, refreshReports]);
  useEffect(() => {
    mounted.current = true;
    const currentReads = reads.current;
    return () => {
      mounted.current = false;
      Object.values(currentReads).forEach((controller) => controller.abort());
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setKeywordQuery(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  const platformRead = useDirectoryRead<Record<string, string>>(
    scope.teamBindingId && canRead
      ? `/api/v1/answerbit/dashboard/platforms?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId })}`
      : null,
  );
  const platforms = platformRead.data ?? {};
  const loadTools = useCallback(async () => {
    if (!scope.organizationId) return;
    reads.current.tools?.abort();
    const controller = new AbortController();
    reads.current.tools = controller;
    try {
      const rows = canRead
        ? await readData<SavedView[]>(
            `/api/v1/saved-views?${scopeQuery({ organizationId: scope.organizationId, page: "answers" })}`,
            controller.signal,
          )
        : [];
      if (!controller.signal.aborted && mounted.current) {
        setViews(rows);
        setToolError("");
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setToolError(
          error instanceof Error ? error.message : "保存视图读取失败",
        );
    }
  }, [scope.organizationId, canRead]);
  useEffect(() => {
    void loadTools();
  }, [loadTools]);
  const base: Record<string, string> = {
    organizationId: scope.organizationId,
    teamBindingId: scope.teamBindingId,
    brandId: scope.brandId,
    beginDate,
    endDate,
    ...(selectedPlatforms.length
      ? { platforms: selectedPlatforms.join(",") }
      : {}),
  };
  const readable = Boolean(scope.brandId && canRead);
  const taskRead = useDirectoryRead<{ scores: Task[]; total: number }>(
    readable
      ? `/api/v1/answerbit/answers?${scopeQuery({ ...base, page: String(page), pageSize: "20", mentionBrand, ...(keywordQuery ? { prompt: keywordQuery } : {}) })}`
      : null,
  );
  const domainRead = useDirectoryRead<{
    reference_count: Domain[];
    total: number;
  }>(
    readable
      ? `/api/v1/answerbit/citations/domains?${scopeQuery({ ...base, page: String(domainPage), pageSize: "10", ...(keywordQuery ? { keyword: keywordQuery } : {}) })}`
      : null,
  );
  const articleRead = useDirectoryRead<{
    reference_count: Article[];
    total: number;
  }>(
    readable
      ? `/api/v1/answerbit/citations/articles?${scopeQuery({ ...base, page: String(articlePage), pageSize: "10", ...(keywordQuery ? { keyword: keywordQuery } : {}) })}`
      : null,
  );
  const tasks = taskRead.data?.scores ?? [];
  const total = taskRead.data?.total;
  const domains = domainRead.data?.reference_count ?? [];
  const articles = articleRead.data?.reference_count ?? [];
  const loading = taskRead.loading || domainRead.loading || articleRead.loading;
  useEffect(() => {
    if (taskRead.data)
      setPage((current) =>
        Math.min(current, Math.max(1, Math.ceil(taskRead.data!.total / 20))),
      );
  }, [taskRead.data]);
  useEffect(() => {
    if (domainRead.data)
      setDomainPage((current) =>
        Math.min(current, Math.max(1, Math.ceil(domainRead.data!.total / 10))),
      );
  }, [domainRead.data]);
  useEffect(() => {
    if (articleRead.data)
      setArticlePage((current) =>
        Math.min(current, Math.max(1, Math.ceil(articleRead.data!.total / 10))),
      );
  }, [articleRead.data]);
  function load() {
    return Promise.all([
      taskRead.reload(),
      domainRead.reload(),
      articleRead.reload(),
    ]);
  }
  function resetPages() {
    setPage(1);
    setDomainPage(1);
    setArticlePage(1);
  }
  function readError(
    label: string,
    read: { error: string; loading: boolean; reload: () => Promise<boolean> },
  ) {
    return read.error ? (
      <Alert
        showIcon
        type="error"
        message={`${label}：${read.error}`}
        style={{ marginBottom: 16 }}
        action={
          <Button
            aria-label={`重试${label}`}
            loading={read.loading}
            onClick={() => void read.reload()}
          >
            重试
          </Button>
        }
      />
    ) : null;
  }
  async function openDetail(taskId: string) {
    reads.current.detail?.abort();
    const controller = new AbortController();
    reads.current.detail = controller;
    setDetailTaskId(taskId);
    setDetail(null);
    setDetailError("");
    setDetailLoading(taskId);
    try {
      const data = await readData<Detail>(
        `/api/v1/answerbit/answers/${taskId}?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId, brandId: scope.brandId })}`,
        controller.signal,
      );
      if (!controller.signal.aborted && mounted.current) setDetail(data);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setDetailError(
          error instanceof Error ? error.message : "详情加载失败，请重试",
        );
    } finally {
      if (!controller.signal.aborted && mounted.current) setDetailLoading("");
    }
  }
  async function saveView() {
    const name = viewName.trim();
    if (!name || toolSubmitting.current || !canRead || !scope.brandId) return;
    toolSubmitting.current = true;
    setToolBusy("view");
    try {
      const response = await fetch(
        editingView
          ? `/api/v1/saved-views/${editingView.id}`
          : "/api/v1/saved-views",
        {
          method: editingView ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: scope.organizationId,
            name,
            ...(!editingView
              ? {
                  page: "answers",
                  filters: {
                    teamBindingId: scope.teamBindingId,
                    brandId: scope.brandId,
                    beginDate,
                    endDate,
                    platforms: selectedPlatforms,
                    keyword,
                    mentionBrand,
                  },
                }
              : {}),
          }),
        },
      );
      const body = await response.json();
      if (!mounted.current) return;
      if (!response.ok) throw new Error(body.error?.message);
      setViewName("");
      setViewOpen(false);
      setMessageType("success");
      setMessage(editingView ? "视图名称已更新" : "当前条件已保存");
      setEditingView(null);
      await loadTools();
    } catch (error) {
      if (mounted.current) {
        setMessageType("error");
        setMessage(error instanceof Error ? error.message : "视图保存失败");
      }
    } finally {
      toolSubmitting.current = false;
      if (mounted.current) setToolBusy("");
    }
  }
  function applyView(view: SavedView) {
    const parsed = answersSavedViewFiltersSchema.safeParse(view.filters);
    if (!parsed.success) {
      setMessageType("error");
      setMessage("这个视图的筛选条件已失效，请重新保存条件。");
      return;
    }
    const filter = parsed.data;
    if (
      (typeof filter.brandId === "string" &&
        filter.brandId !== scope.brandId) ||
      (typeof filter.teamBindingId === "string" &&
        filter.teamBindingId !== scope.teamBindingId)
    ) {
      setMessageType("error");
      setMessage("这个视图的品牌范围已变更，请在当前品牌重新保存条件。");
      return;
    }
    setBeginDate(filter.beginDate ?? initial.begin);
    setEndDate(filter.endDate ?? initial.end);
    setSelectedPlatforms(
      filter.platforms ?? (filter.platform ? [filter.platform] : []),
    );
    setKeyword(filter.keyword);
    setKeywordQuery(filter.keyword);
    setMentionBrand(filter.mentionBrand);
    resetPages();
    setMessage("");
  }
  async function deleteView(view: SavedView) {
    if (toolSubmitting.current) return;
    toolSubmitting.current = true;
    setToolBusy(`delete:${view.id}`);
    try {
      const response = await fetch(`/api/v1/saved-views/${view.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: scope.organizationId }),
      });
      if (!mounted.current) return;
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "视图删除失败");
      }
      setViews((items) => items.filter((item) => item.id !== view.id));
      setMessageType("success");
      setMessage("视图已删除");
    } catch (error) {
      if (mounted.current) {
        setMessageType("error");
        setMessage(error instanceof Error ? error.message : "视图删除失败");
      }
    } finally {
      toolSubmitting.current = false;
      if (mounted.current) setToolBusy("");
    }
  }
  async function createExport(reportType: ReportType, previous?: ExportJob) {
    const attempt = reportAttempts.get(reportType);
    if (
      !canExport ||
      !scope.brandId ||
      toolSubmitting.current ||
      !attempt?.ready ||
      attempt.inFlight
    )
      return;
    if (previous && attempt.pending) {
      setMessageType("info");
      setMessage("请先确认原导出，再按这份报告重新导出。");
      return;
    }
    toolSubmitting.current = true;
    setToolBusy(reportType);
    const wasPending = Boolean(attempt.pending);
    const payload = attempt.pending?.payload ?? {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
      reportType,
      ...(previous?.filters ?? {
        beginDate,
        endDate,
        titleIds: [],
        promptIds: [],
        platforms: selectedPlatforms,
        tagIds: [],
        mentionBrand: Number(mentionBrand) as -1 | 0 | 1,
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      }),
    };
    let submittedKey: string | undefined;
    try {
      const pending = attempt.begin(payload);
      submittedKey = pending.key;
      const response = await fetch("/api/v1/report-exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": pending.key,
        },
        body: JSON.stringify(pending.payload),
      });
      const body = await response.json();
      if (!response.ok) {
        // A refusal of a new request is definite. A later permission or quota
        // refusal cannot erase an earlier submission with an unknown outcome.
        if (
          !wasPending &&
          response.status >= 400 &&
          response.status < 500 &&
          body.error?.code !== "REPORT_EXPORT_IDEMPOTENCY_CONFLICT"
        )
          attempt.complete(pending.key);
        throw new Error(
          body.error?.message ?? "导出请求未确认，请确认原导出。",
        );
      }
      const job = body.data as ExportJob;
      if (
        !job?.id ||
        job.reportType !== pending.payload.reportType ||
        !["queued", "running", "succeeded", "failed", "expired"].includes(
          job.status,
        )
      )
        throw new Error("导出响应未能确认，请继续确认原导出。");
      attempt.complete(pending.key, job);
    } catch (error) {
      if (mounted.current) {
        setMessageType("error");
        setMessage(
          error instanceof TypeError
            ? "导出结果暂未确认，请确认原导出；将沿用原条件与提交键。"
            : error instanceof Error
              ? error.message
              : "导出结果暂未确认，请确认原导出。",
        );
      }
    } finally {
      if (submittedKey) attempt.settle(submittedKey);
      toolSubmitting.current = false;
      if (mounted.current) setToolBusy("");
    }
  }
  async function downloadReport(job: ExportJob) {
    if (!job.downloadUrl || toolSubmitting.current) return;
    toolSubmitting.current = true;
    setToolBusy(`download:${job.id}`);
    try {
      const response = await fetch(job.downloadUrl);
      if (!response.ok) {
        const body = await response.json();
        if (response.status === 410 && mounted.current)
          reportHistory.markExpired(job.id);
        throw new Error(body.error?.message ?? "下载失败，请重试");
      }
      const blob = await response.blob();
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = job.filename ?? "geo-report.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (mounted.current) {
        setMessageType("error");
        setMessage(
          error instanceof TypeError
            ? "下载连接中断，请重试"
            : error instanceof Error
              ? error.message
              : "下载失败，请重试",
        );
      }
    } finally {
      toolSubmitting.current = false;
      if (mounted.current) setToolBusy("");
    }
  }
  const taskColumns: TableColumnsType<Task> = [
    {
      title: "问题",
      dataIndex: "query_str",
      render: (value: string, item) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Space size={6} wrap>
            <Typography.Text type="secondary">
              {item.title_name}
            </Typography.Text>
            <Typography.Text type="secondary">·</Typography.Text>
            <ModelLabel
              modelId={item.platform}
              upstreamLabel={findModelUpstreamLabel(platforms, item.platform)}
            />
            <Typography.Text type="secondary">· {item.date}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "品牌提及",
      dataIndex: "exposure",
      width: 110,
      render: (value: number) => (
        <Tag color={value ? "success" : "default"}>
          {value ? "已提及" : "未提及"}
        </Tag>
      ),
    },
    { title: "得分", dataIndex: "score", width: 90 },
    {
      title: "平均排名",
      dataIndex: "avg_rank",
      width: 110,
      render: (value: number) => value || "—",
    },
    {
      title: "引用",
      dataIndex: "trace_article_cnt",
      width: 80,
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 90,
      render: (_, item) => (
        <Button
          aria-label={`查看回答：${item.query_str}`}
          loading={detailLoading === item.task_id}
          icon={<EyeOutlined />}
          onClick={() => void openDetail(item.task_id)}
          size="small"
        >
          查看
        </Button>
      ),
    },
  ];

  const domainColumns: TableColumnsType<Domain> = [
    {
      title: "域名",
      dataIndex: "domain",
      render: (value: string, item) => (
        <Space>
          <Typography.Text>{value}</Typography.Text>
          {item.is_own ? <Tag color="blue">品牌官网</Tag> : null}
        </Space>
      ),
    },
    { title: "引用数", dataIndex: "count", align: "right", width: 90 },
  ];

  const articleColumns: TableColumnsType<Article> = [
    {
      title: "文章",
      dataIndex: "article",
      render: (value: string, item) => (
        <Typography.Link href={item.url} rel="noreferrer" target="_blank">
          {value || item.domain}
        </Typography.Link>
      ),
    },
    { title: "域名", dataIndex: "domain", width: 160, ellipsis: true },
    { title: "引用数", dataIndex: "count", align: "right", width: 90 },
  ];

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="回答记录" value={total ?? "—"} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              title="本页已提及"
              value={
                taskRead.data
                  ? tasks.filter((item) => item.exposure === 1).length
                  : "—"
              }
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              precision={1}
              title="本页平均分"
              value={
                !taskRead.data
                  ? "—"
                  : tasks.length
                    ? tasks.reduce((sum, item) => sum + item.score, 0) /
                      tasks.length
                    : 0
              }
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="引用域名" value={domainRead.data?.total ?? "—"} />
          </Card>
        </Col>
      </Row>

      <Card
        extra={
          <Button
            aria-label="查询回答与引用"
            disabled={!scope.brandId || !canRead}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
            type="primary"
          >
            查询
          </Button>
        }
        title="回答筛选"
      >
        <ScopeFields organizations={organizations} scope={scope} />
        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col lg={7} md={12} xs={24}>
            <label htmlFor="answers-begin-date">
              <Typography.Text type="secondary">日期范围</Typography.Text>
            </label>
            <label
              htmlFor="answers-end-date"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
              }}
            >
              结束日期
            </label>
            <DatePicker.RangePicker
              id={{ start: "answers-begin-date", end: "answers-end-date" }}
              disabled={!canRead || !scope.brandId}
              allowClear={false}
              disabledDate={(date) => date.isAfter(dayjs(), "day")}
              onChange={(values) => {
                if (!values?.[0] || !values[1]) return;
                resetPages();
                setBeginDate(values[0].format("YYYY-MM-DD"));
                setEndDate(values[1].format("YYYY-MM-DD"));
              }}
              style={{ width: "100%" }}
              value={[dayjs(beginDate), dayjs(endDate)]}
            />
          </Col>
          <Col lg={6} md={12} xs={24}>
            <label htmlFor="answers-platform-filter">
              <Typography.Text type="secondary">模型</Typography.Text>
            </label>
            <Select
              allowClear
              id="answers-platform-filter"
              disabled={!canRead || !scope.brandId}
              labelRender={({ value }) => (
                <ModelLabel
                  modelId={String(value)}
                  upstreamLabel={findModelUpstreamLabel(
                    platforms,
                    String(value),
                  )}
                />
              )}
              maxTagCount="responsive"
              mode="multiple"
              onChange={(value) => {
                resetPages();
                setSelectedPlatforms(value);
              }}
              optionFilterProp="searchText"
              options={modelSelectOptions(platforms)}
              placeholder="全部模型"
              showSearch
              style={{ width: "100%" }}
              value={selectedPlatforms}
            />
          </Col>
          <Col lg={4} md={6} xs={12}>
            <label htmlFor="answers-brand-mention-filter">
              <Typography.Text type="secondary">品牌提及</Typography.Text>
            </label>
            <Select
              id="answers-brand-mention-filter"
              disabled={!canRead || !scope.brandId}
              onChange={(value) => {
                setPage(1);
                setMentionBrand(value);
              }}
              options={[
                { label: "全部", value: "-1" },
                { label: "已提及", value: "1" },
                { label: "未提及", value: "0" },
              ]}
              style={{ width: "100%" }}
              value={mentionBrand}
            />
          </Col>
          <Col lg={7} md={18} xs={24}>
            <label htmlFor="answers-keyword">
              <Typography.Text type="secondary">关键词</Typography.Text>
            </label>
            <Input.Search
              id="answers-keyword"
              disabled={!canRead || !scope.brandId}
              allowClear
              onChange={(event) => {
                resetPages();
                setKeyword(event.target.value);
              }}
              onSearch={(value) => {
                const next = value.trim();
                if (next === keywordQuery) void load();
                else {
                  resetPages();
                  setKeywordQuery(next);
                }
              }}
              placeholder="问题、文章或域名"
              value={keyword}
            />
          </Col>
        </Row>
      </Card>

      {readError("模型目录", platformRead)}

      {message ? (
        <Alert
          closable
          message={message}
          onClose={() => {
            setMessage("");
          }}
          showIcon
          type={messageType}
        />
      ) : null}

      <Card
        extra={<Typography.Text type="secondary">第 {page} 页</Typography.Text>}
        title="大模型回答记录"
      >
        {readError("回答", taskRead)}
        <Table<Task>
          columns={taskColumns}
          dataSource={tasks}
          locale={{
            emptyText: (
              <Empty
                description={
                  <Typography.Text tabIndex={0}>
                    {taskRead.error && !taskRead.data
                      ? "回答尚未加载，请重试"
                      : "暂无回答记录"}
                  </Typography.Text>
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={false}
          loading={taskRead.loading}
          rowKey="task_id"
          scroll={{ x: 860 }}
        />
        <Flex justify="flex-end" style={{ marginTop: 16 }}>
          <Pagination
            aria-label="回答分页"
            current={page}
            onChange={setPage}
            pageSize={20}
            showSizeChanger={false}
            total={total ?? 0}
            disabled={!taskRead.data}
          />
        </Flex>
      </Card>

      <Card
        title="视图与导出"
        extra={
          <Button
            onClick={() => {
              void loadTools();
              void reportHistory.refresh();
            }}
            icon={<ReloadOutlined />}
          >
            刷新任务
          </Button>
        }
      >
        {toolError ? (
          <Alert
            type="error"
            showIcon
            message={toolError}
            action={<Button onClick={() => void loadTools()}>重试</Button>}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Flex gap={16} justify="space-between" wrap>
          <Space size={[8, 8]} wrap>
            <Button
              icon={<SaveOutlined />}
              loading={toolBusy === "view"}
              disabled={!canRead || !scope.brandId || Boolean(toolBusy)}
              onClick={() => {
                setEditingView(null);
                setViewName("");
                setViewOpen(true);
              }}
            >
              保存当前条件
            </Button>
            {views.map((view) => (
              <Space.Compact key={view.id}>
                <Button onClick={() => applyView(view)}>{view.name}</Button>
                <Button
                  aria-label={`重命名视图 ${view.name}`}
                  icon={<EditOutlined />}
                  disabled={Boolean(toolBusy)}
                  onClick={() => {
                    setEditingView(view);
                    setViewName(view.name);
                    setViewOpen(true);
                  }}
                />
                <Popconfirm
                  title={`删除视图“${view.name}”？`}
                  description="仅删除保存的筛选条件，回答记录会保留。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => deleteView(view)}
                >
                  <Button
                    aria-label={`删除视图 ${view.name}`}
                    danger
                    icon={<DeleteOutlined />}
                    loading={toolBusy === `delete:${view.id}`}
                    disabled={Boolean(toolBusy)}
                  />
                </Popconfirm>
              </Space.Compact>
            ))}
          </Space>
          {canExport ? (
            <Space size={[8, 8]} wrap>
              {reportTypes.map((type) => {
                const attempt = reportAttempts.get(type);
                return (
                  <Button
                    key={type}
                    aria-label={reportLabels[type]}
                    loading={toolBusy === type || attempt?.inFlight}
                    disabled={
                      Boolean(toolBusy) ||
                      !reportAttempts.ready ||
                      !attempt?.ready ||
                      Boolean(attempt.pending)
                    }
                    onClick={() => void createExport(type)}
                  >
                    {reportLabels[type]}
                  </Button>
                );
              })}
            </Space>
          ) : null}
        </Flex>
        {reportAttempts.errors.map(({ type, attempt, message }) => (
          <Alert
            key={type}
            type="warning"
            showIcon
            message={`${reportLabels[type]}：${message}`}
            style={{ marginTop: 16 }}
            action={
              <Button onClick={() => attempt.reload()}>重新读取暂存</Button>
            }
          />
        ))}
        {reportAttempts.pending.map(({ type, attempt, record }) => (
          <Alert
            key={type}
            type="warning"
            showIcon
            message={`${reportLabels[type]}${attempt.inFlight ? "原导出仍在提交" : "导出结果待确认"}`}
            style={{ marginTop: 16 }}
            description={
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>
                  原数据日期：{record.payload.beginDate} 至{" "}
                  {record.payload.endDate}
                </Typography.Text>
                {record.payload.keyword ? (
                  <Typography.Text>
                    原关键词：{record.payload.keyword}
                  </Typography.Text>
                ) : null}
                {record.payload.platforms.length ? (
                  <Space wrap>
                    <Typography.Text>原模型：</Typography.Text>
                    {record.payload.platforms.map((model) => (
                      <ModelLabel key={model} modelId={model} />
                    ))}
                  </Space>
                ) : null}
                {type === "answers" ? (
                  <Typography.Text>
                    原品牌提及：
                    {record.payload.mentionBrand === 1
                      ? "已提及"
                      : record.payload.mentionBrand === 0
                        ? "未提及"
                        : "全部"}
                  </Typography.Text>
                ) : null}
                <Typography.Text type="secondary">
                  确认将沿用原条件与提交键，当前分析筛选保持不变。
                </Typography.Text>
                {!canExport ? (
                  <Space wrap>
                    <Typography.Text type="secondary">
                      当前没有报告导出权限，原记录已保留；恢复权限后可继续确认。
                    </Typography.Text>
                    <Button
                      loading={scope.brandsLoading}
                      onClick={() => scope.reloadBrands()}
                    >
                      重新检查权限
                    </Button>
                  </Space>
                ) : null}
                <Button
                  aria-label={`确认原导出 · ${reportLabels[type]}`}
                  loading={toolBusy === type || attempt.inFlight}
                  disabled={!canExport || Boolean(toolBusy) || attempt.inFlight}
                  onClick={() => void createExport(type)}
                >
                  确认原导出 · {reportLabels[type]}
                </Button>
              </Space>
            }
          />
        ))}
        {canExport && scope.brandId ? (
          <>
            {submittedReport ? (
              <Button
                style={{ marginTop: 16 }}
                onClick={() =>
                  reportHistory.change({
                    q: submittedReport.id,
                    reportType: undefined,
                    status: undefined,
                    beginDate: undefined,
                    endDate: undefined,
                  })
                }
              >
                查看本次报告
              </Button>
            ) : null}
            <ReportHistory
              history={reportHistory}
              busy={toolBusy}
              onDownload={(job) => void downloadReport(job)}
              onExport={(job) => void createExport(job.reportType, job)}
              canExportJob={(job) => {
                const attempt = reportAttempts.get(job.reportType);
                return Boolean(
                  reportAttempts.ready &&
                    attempt?.ready &&
                    !attempt.pending &&
                    !attempt.inFlight,
                );
              }}
            />
          </>
        ) : null}
      </Card>

      <Row gutter={[16, 16]}>
        <Col lg={10} xs={24}>
          <Card title="引用域名">
            {readError("引用域名", domainRead)}
            <Table<Domain>
              onRow={(_, index) => ({ tabIndex: index === 0 ? 0 : undefined })}
              loading={domainRead.loading}
              columns={domainColumns}
              dataSource={domains}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      domainRead.error && !domainRead.data
                        ? "引用域名尚未加载，请重试"
                        : "暂无引用域名"
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              scroll={domains.length ? { x: 360 } : undefined}
              rowKey="domain"
              size="small"
            />
            <Flex justify="flex-end" style={{ marginTop: 16 }}>
              <Pagination
                aria-label="引用域名分页"
                current={domainPage}
                onChange={setDomainPage}
                pageSize={10}
                showSizeChanger={false}
                total={domainRead.data?.total ?? 0}
                disabled={!domainRead.data}
              />
            </Flex>
          </Card>
        </Col>
        <Col lg={14} xs={24}>
          <Card title="引用文章">
            {readError("引用文章", articleRead)}
            <Table<Article>
              loading={articleRead.loading}
              columns={articleColumns}
              dataSource={articles}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      articleRead.error && !articleRead.data
                        ? "引用文章尚未加载，请重试"
                        : "暂无引用文章"
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              scroll={articles.length ? { x: 560 } : undefined}
              rowKey={(item) => item.url}
              size="small"
            />
            <Flex justify="flex-end" style={{ marginTop: 16 }}>
              <Pagination
                aria-label="引用文章分页"
                current={articlePage}
                onChange={setArticlePage}
                pageSize={10}
                showSizeChanger={false}
                total={articleRead.data?.total ?? 0}
                disabled={!articleRead.data}
              />
            </Flex>
          </Card>
        </Col>
      </Row>

      <Modal
        cancelText="取消"
        confirmLoading={toolBusy === "view"}
        cancelButtonProps={{ disabled: Boolean(toolBusy) }}
        closable={!toolBusy}
        maskClosable={!toolBusy}
        keyboard={!toolBusy}
        okButtonProps={{ disabled: !viewName.trim() }}
        okText="保存"
        onCancel={() => setViewOpen(false)}
        onOk={() => void saveView()}
        open={viewOpen}
        title={editingView ? "重命名视图" : "保存筛选视图"}
        width={640}
      >
        {!editingView ? (
          <Typography.Paragraph type="secondary">
            保存当前企业、品牌、日期和筛选条件。
          </Typography.Paragraph>
        ) : null}
        <label htmlFor="saved-view-name">视图名称</label>
        <Input
          id="saved-view-name"
          autoFocus
          maxLength={100}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="视图名称"
          value={viewName}
        />
      </Modal>

      <Drawer
        onClose={() => {
          reads.current.detail?.abort();
          setDetailLoading("");
          setDetail(null);
          setDetailTaskId("");
          setDetailError("");
        }}
        open={Boolean(detailTaskId)}
        title={detail?.query ?? "回答详情"}
        width={720}
      >
        {detailLoading ? (
          <Flex justify="center" style={{ padding: 32 }}>
            <Spin aria-label="正在读取回答详情" />
          </Flex>
        ) : null}
        {detailError ? (
          <Alert
            type="error"
            showIcon
            message={detailError}
            action={
              <Button
                aria-label="重试回答详情"
                onClick={() => void openDetail(detailTaskId)}
              >
                重试详情
              </Button>
            }
          />
        ) : null}
        {detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions
              column={{ xs: 1, sm: 2, md: 3 }}
              items={[
                {
                  key: "platform",
                  label: "模型",
                  children: (
                    <ModelLabel
                      modelId={detail.platform}
                      upstreamLabel={findModelUpstreamLabel(
                        platforms,
                        detail.platform,
                      )}
                    />
                  ),
                },
                { key: "date", label: "日期", children: detail.date },
                { key: "score", label: "曝光分", children: detail.score },
                {
                  key: "rank",
                  label: "品牌排名",
                  children: detail.rank || "—",
                },
                {
                  key: "mentions",
                  label: "提及次数",
                  children: detail.exposure_cnt,
                },
                { key: "language", label: "语言", children: detail.language },
              ]}
              size="small"
            />
            <Card size="small" title="模型回答">
              <Typography.Paragraph
                style={{ margin: 0, whiteSpace: "pre-wrap" }}
              >
                {detail.llm_output}
              </Typography.Paragraph>
            </Card>
            <List
              dataSource={detail.links}
              header={<Typography.Text strong>引用证据</Typography.Text>}
              renderItem={(link) => (
                <List.Item>
                  <List.Item.Meta
                    description={link.url}
                    title={
                      <Typography.Link
                        href={link.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {"[" + link.index + "] " + (link.title || link.url)}
                      </Typography.Link>
                    }
                  />
                </List.Item>
              )}
            />
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
