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
import { ReportAttempt } from "./report-attempt";
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
  const end = new Date();
  const begin = new Date(end);
  begin.setUTCDate(begin.getUTCDate() - 6);
  return {
    begin: begin.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
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
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
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
    data?: AbortController;
    tools?: AbortController;
    detail?: AbortController;
  }>({});
  const mounted = useRef(true);
  const toolSubmitting = useRef(false);
  const attempts = useRef(new Map<string, ReportAttempt>());
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
  useEffect(() => {
    if (!scope.teamBindingId || !canRead) return;
    const controller = new AbortController();
    void readData<Record<string, string>>(
      `/api/v1/answerbit/dashboard/platforms?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId })}`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setPlatforms(data ?? {});
      })
      .catch(() => {});
    return () => controller.abort();
  }, [scope.organizationId, scope.teamBindingId, canRead]);
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
  const load = useCallback(async () => {
    if (!scope.brandId || !canRead) return;
    reads.current.data?.abort();
    const controller = new AbortController();
    reads.current.data = controller;
    setLoading(true);
    setMessage("");
    const base: Record<string, string> = {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
      beginDate,
      endDate,
      page: String(page),
      pageSize: "20",
    };
    if (selectedPlatforms.length) base.platforms = selectedPlatforms.join(",");
    const [taskResult, domainResult, articleResult] = await Promise.allSettled([
      readData<{ scores: Task[]; total: number }>(
        `/api/v1/answerbit/answers?${scopeQuery({ ...base, mentionBrand, ...(keywordQuery ? { prompt: keywordQuery } : {}) })}`,
        controller.signal,
      ),
      readData<{ reference_count: Domain[] }>(
        `/api/v1/answerbit/citations/domains?${scopeQuery({ ...base, ...(keywordQuery ? { keyword: keywordQuery } : {}) })}`,
        controller.signal,
      ),
      readData<{ reference_count: Article[] }>(
        `/api/v1/answerbit/citations/articles?${scopeQuery({ ...base, ...(keywordQuery ? { keyword: keywordQuery } : {}) })}`,
        controller.signal,
      ),
    ]);
    if (controller.signal.aborted || !mounted.current) return;
    if (taskResult.status === "fulfilled") {
      setTasks(taskResult.value.scores ?? []);
      setTotal(taskResult.value.total ?? 0);
    }
    if (domainResult.status === "fulfilled")
      setDomains(domainResult.value.reference_count ?? []);
    if (articleResult.status === "fulfilled")
      setArticles(articleResult.value.reference_count ?? []);
    const errors = [taskResult, domainResult, articleResult].flatMap(
      (result, index) =>
        result.status === "rejected"
          ? [
              `${["回答", "引用域名", "引用文章"][index]}：${result.reason instanceof Error ? result.reason.message : "加载失败"}`,
            ]
          : [],
    );
    setMessage(errors.join("；"));
    setMessageType("error");
    setLoading(false);
  }, [
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    beginDate,
    endDate,
    page,
    selectedPlatforms,
    keywordQuery,
    mentionBrand,
    canRead,
  ]);
  useEffect(() => {
    void load();
  }, [load]);
  async function openDetail(taskId: string) {
    reads.current.detail?.abort();
    const controller = new AbortController();
    reads.current.detail = controller;
    setDetailLoading(taskId);
    try {
      const data = await readData<Detail>(
        `/api/v1/answerbit/answers/${taskId}?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId, brandId: scope.brandId })}`,
        controller.signal,
      );
      if (!controller.signal.aborted) setDetail(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessageType("error");
        setMessage(
          error instanceof Error ? error.message : "详情加载失败，请重试",
        );
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading("");
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
    setPage(1);
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
  async function createExport(
    reportType: "answers" | "domain_rank" | "article_rank",
    previous?: ExportJob,
  ) {
    if (!canExport || !scope.brandId || toolSubmitting.current) return;
    toolSubmitting.current = true;
    setToolBusy(reportType);
    const payload = {
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
        mentionBrand: Number(mentionBrand),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      }),
    };
    let attempt = attempts.current.get(reportType);
    if (!attempt) {
      attempt = new ReportAttempt(
        `geo.report.${userId}.${scope.organizationId}.${scope.brandId}.${reportType}`,
      );
      attempts.current.set(reportType, attempt);
    }
    try {
      const response = await fetch("/api/v1/report-exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": attempt.key(payload),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message);
      attempt.complete();
      if (!mounted.current) return;
      const job = body.data as ExportJob;
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
      await reportHistory.refresh();
    } catch (error) {
      if (mounted.current) {
        setMessageType("error");
        setMessage(
          error instanceof TypeError
            ? "导出请求未确认，请重试；重复点击不会创建重复任务。"
            : error instanceof Error
              ? error.message
              : "导出请求未确认，请重试；重复点击不会创建重复任务。",
        );
      }
    } finally {
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
            <Statistic title="回答记录" value={total} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              title="本页已提及"
              value={tasks.filter((item) => item.exposure === 1).length}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              precision={1}
              title="本页平均分"
              value={
                tasks.length
                  ? tasks.reduce((sum, item) => sum + item.score, 0) /
                    tasks.length
                  : 0
              }
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="引用域名" value={domains.length} />
          </Card>
        </Col>
      </Row>

      <Card
        extra={
          <Button
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
            <Typography.Text type="secondary">日期范围</Typography.Text>
            <DatePicker.RangePicker
              disabled={!canRead || !scope.brandId}
              allowClear={false}
              disabledDate={(date) => date.isAfter(dayjs(), "day")}
              onChange={(values) => {
                if (!values?.[0] || !values[1]) return;
                setPage(1);
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
                setPage(1);
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
            <Typography.Text type="secondary">关键词</Typography.Text>
            <Input.Search
              disabled={!canRead || !scope.brandId}
              allowClear
              onChange={(event) => {
                setPage(1);
                setKeyword(event.target.value);
              }}
              onSearch={() => void load()}
              placeholder="问题、文章或域名"
              value={keyword}
            />
          </Col>
        </Row>
      </Card>

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
        <Table<Task>
          columns={taskColumns}
          dataSource={tasks}
          locale={{
            emptyText: (
              <Empty
                description="暂无回答记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={false}
          loading={loading}
          rowKey="task_id"
          scroll={{ x: 860 }}
        />
        <Flex justify="flex-end" style={{ marginTop: 16 }}>
          <Pagination
            current={page}
            onChange={setPage}
            pageSize={20}
            showSizeChanger={false}
            total={total}
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
              <Button
                loading={toolBusy === "answers"}
                disabled={Boolean(toolBusy)}
                onClick={() => void createExport("answers")}
              >
                回答 CSV
              </Button>
              <Button
                loading={toolBusy === "domain_rank"}
                disabled={Boolean(toolBusy)}
                onClick={() => void createExport("domain_rank")}
              >
                域名 CSV
              </Button>
              <Button
                loading={toolBusy === "article_rank"}
                disabled={Boolean(toolBusy)}
                onClick={() => void createExport("article_rank")}
              >
                文章 CSV
              </Button>
            </Space>
          ) : null}
        </Flex>
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
            />
          </>
        ) : null}
      </Card>

      <Row gutter={[16, 16]}>
        <Col lg={10} xs={24}>
          <Card title="引用域名">
            <Table<Domain>
              columns={domainColumns}
              dataSource={domains}
              locale={{
                emptyText: (
                  <Empty
                    description="暂无引用域名"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              rowKey="domain"
              size="small"
            />
          </Card>
        </Col>
        <Col lg={14} xs={24}>
          <Card title="引用文章">
            <Table<Article>
              columns={articleColumns}
              dataSource={articles.slice(0, 8)}
              locale={{
                emptyText: (
                  <Empty
                    description="暂无引用文章"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              rowKey={(item) => item.url}
              size="small"
            />
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
        }}
        open={Boolean(detail)}
        title={detail?.query ?? "回答详情"}
        width={720}
      >
        {detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions
              column={3}
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
