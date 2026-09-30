"use client";
import {
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag as AntTag,
  Typography,
  type TableColumnsType,
} from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";
import { DocumentLibrary } from "./document-library";
import { PublicationAttempt } from "../billing/publication-attempt";
type Article = {
  id: string;
  title: string;
  status: number;
  source: number;
  template_type: number;
  ref_count: number;
  fluctuation: number;
  ref_trends: { date: string; count: number }[];
  published_platforms: {
    platform: string;
    display_name: string;
    icon_url: string;
    publish_url: string;
  }[];
};
type Template = {
  template_id: number;
  template_name: string;
  description: string;
  is_high_ref: number;
};
type Prompt = { id: string; query_str: string; title_name: string };
type Tag = {
  tag_id: string;
  name: string;
  tag_type?: number;
  status?: number;
};
type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  answerbitArticleId: string | null;
  articleTitle: string | null;
  articleBody: string | null;
  templateType: number | null;
  generationMode: "standard" | "reference" | null;
  tags: { tagId: string; tagName: string }[] | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  replayed?: boolean;
};
type TraceDetail = {
  trace_info: {
    trace_id: string;
    url: string;
    platform: string;
    title: string;
    stats: { ref_count: Record<string, number>; total_count: number };
  }[];
  stats: {
    ref_count: Record<string, number>;
    total_count: number;
    ref_count_increase: number;
    ref_trends: {
      platform: string;
      ref_trends: {
        date: string;
        ref_count: number;
        prompts: {
          prompt_id: string;
          prompt_content: string;
          title_name: string;
          ref_count: number;
        }[];
      }[];
    }[];
  };
};
const statusLabel: Record<number, string> = {
  0: "生成中",
  1: "待发布",
  2: "发布中",
  3: "追踪中",
};
const sourceLabel: Record<number, string> = {
  0: "外部文章",
  1: "平台创作",
  2: "用户创作",
  3: "官网文章",
};
const jobStatusMeta = {
  queued: { color: "default", label: "等待生成" },
  running: { color: "processing", label: "生成中" },
  succeeded: { color: "success", label: "已生成" },
  failed: { color: "error", label: "生成失败" },
  cancelled: { color: "default", label: "已取消" },
} as const;
const apiScope = (scope: ReturnType<typeof useAnswerBitScope>) => ({
  organizationId: scope.organizationId,
  teamBindingId: scope.teamBindingId,
  brandId: scope.brandId,
});
export function ContentClient({
  organizations,
  featurePointCosts,
  initialTab = "generate",
}: {
  organizations: ScopeOrganization[];
  featurePointCosts: {
    articleGeneration: number;
    effectTracking: number;
  };
  initialTab?: "library" | "trace" | "generate";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = useAnswerBitScope(organizations);
  const { organizationId, teamBindingId, brandId } = scope;
  const scopeVersion = useRef(0);
  const readVersion = useRef(0);
  const jobReadVersion = useRef(0);
  const generationAttempt = useRef(new PublicationAttempt());
  const generationSubmitting = useRef(false);
  const [cancellingJob, setCancellingJob] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptSearchQuery, setPromptSearchQuery] = useState("");
  const initialPromptId = searchParams.get("promptId");
  const initialPromptText = searchParams.get("promptText")?.slice(0, 500) ?? "";
  const initialOrganizationId = searchParams.get("organizationId");
  const initialBrandId = searchParams.get("brandId");
  const preselectedPrompt = useRef("");
  useEffect(() => {
    const timer = setTimeout(() => setPromptSearchQuery(promptSearch), 300);
    return () => clearTimeout(timer);
  }, [promptSearch]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedGenerationTags, setSelectedGenerationTags] = useState<
    string[]
  >([]);
  const [selectedTraceTags, setSelectedTraceTags] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [libraryTags, setLibraryTags] = useState<string[]>([]);
  const [scrollId, setScrollId] = useState("");
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<"" | "trace" | "generate">("");
  const [tab, setTab] = useState<"library" | "trace" | "generate">(initialTab);
  const [traceTitle, setTraceTitle] = useState("");
  const [traceUrls, setTraceUrls] = useState("");
  const [traceCreateOpen, setTraceCreateOpen] = useState(false);
  const [language, setLanguage] = useState("zh-CN");
  const [generationMode, setGenerationMode] = useState<
    "standard" | "reference"
  >("standard");
  const [templateType, setTemplateType] = useState("");
  const availableTemplates = templates.filter((item) =>
    generationMode === "reference"
      ? item.is_high_ref === 1
      : item.is_high_ref === 0,
  );
  const selectedTemplate =
    availableTemplates.find(
      (item) => String(item.template_id) === templateType,
    ) ?? availableTemplates[0];
  const activeTemplateType = selectedTemplate
    ? String(selectedTemplate.template_id)
    : "";
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const selectedPromptsRef = useRef<string[]>([]);
  useEffect(() => {
    selectedPromptsRef.current = selectedPrompts;
  }, [selectedPrompts]);
  const [supplement, setSupplement] = useState("");
  const [highRefUrl, setHighRefUrl] = useState("");
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  useEffect(() => {
    scopeVersion.current += 1;
    readVersion.current += 1;
    jobReadVersion.current += 1;
    generationAttempt.current.complete();
    setArticles([]);
    setTemplates([]);
    setPrompts([]);
    setPromptSearch("");
    setTags([]);
    setSelectedPrompts([]);
    setSelectedGenerationTags([]);
    setSelectedTraceTags([]);
    setSupplement("");
    setHighRefUrl("");
    setScrollId("");
    setTotal(0);
    setTraceCreateOpen(false);
    setJobs([]);
    setSelectedJob(null);
    setLibraryTags([]);
    setDetail(null);
    setMessage("");
  }, [organizationId, teamBindingId, brandId]);
  useEffect(() => {
    if (scope.brand && !scope.canWrite)
      setTab((current) => (current === "generate" ? "library" : current));
  }, [scope.brand, scope.canWrite]);
  function changeTab(nextTab: "library" | "trace" | "generate") {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("stage", nextTab === "trace" ? "tracking" : nextTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const load = useCallback(
    async (cursor?: string) => {
      if (!brandId) return;
      const version = ++readVersion.current;
      const jobsVersion = ++jobReadVersion.current;
      setLoading(true);
      const base = { organizationId, teamBindingId, brandId };
      const read = async (path: string) => {
        const response = await fetch(path, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "读取失败");
        return body.data;
      };
      const result = await Promise.allSettled([
        tab === "trace"
          ? read(
              `/api/v1/answerbit/articles?${scopeQuery({ ...base, limit: "20", ...(cursor ? { scrollId: cursor } : {}) })}`,
            )
          : Promise.resolve(undefined),
        tab === "generate"
          ? read(
              `/api/v1/answerbit/article-templates?${scopeQuery({ ...base, localCode: language })}`,
            )
          : Promise.resolve(undefined),
        tab === "generate"
          ? read(
              `/api/v1/answerbit/prompts?${scopeQuery({ ...base, pageSize: "100", purpose: "content", ...(promptSearchQuery || initialPromptText ? { query: promptSearchQuery || initialPromptText } : {}) })}`,
            )
          : Promise.resolve(undefined),
        tab !== "library"
          ? read(
              `/api/v1/answerbit/tags?${scopeQuery({ organizationId, teamBindingId, tagType: "1" })}`,
            )
          : Promise.resolve(undefined),
        tab !== "library"
          ? read(
              `/api/v1/answerbit/tags?${scopeQuery({ organizationId, teamBindingId, tagType: "2" })}`,
            )
          : Promise.resolve(undefined),
        read(
          `/api/v1/answerbit/article-jobs?${scopeQuery({ ...base, limit: "20" })}`,
        ),
        tab === "generate"
          ? read(
              `/api/v1/content-documents?${scopeQuery({ ...base, limit: "100", offset: "0" })}`,
            )
          : Promise.resolve(undefined),
      ]);
      if (version !== readVersion.current) return;
      const value = (index: number) =>
        result[index].status === "fulfilled" ? result[index].value : undefined;
      const articleData = value(0);
      if (articleData) {
        setArticles((current) =>
          cursor ? [...current, ...articleData.list] : articleData.list,
        );
        setScrollId(articleData.scroll_id ?? "");
        setTotal(articleData.total ?? 0);
      }
      if (value(1)) setTemplates(value(1));
      if (value(2)) {
        const next = value(2).titles.flatMap(
          (group: { prompts: Prompt[] }) => group.prompts,
        ) as Prompt[];
        setPrompts((current) => [
          ...current.filter(
            (prompt) =>
              selectedPromptsRef.current.includes(prompt.id) &&
              !next.some((item) => item.id === prompt.id),
          ),
          ...next,
        ]);
        const key = `${organizationId}:${brandId}:${initialPromptId}`;
        if (
          initialPromptId &&
          preselectedPrompt.current !== key &&
          next.some((prompt) => prompt.id === initialPromptId) &&
          (!initialOrganizationId ||
            initialOrganizationId === organizationId) &&
          (!initialBrandId || initialBrandId === brandId)
        ) {
          preselectedPrompt.current = key;
          setSelectedPrompts([initialPromptId]);
        }
      }
      if (tab !== "library" && (value(3) || value(4))) {
        setTags(
          [...(value(3) ?? []), ...(value(4) ?? [])].filter(
            (tag: Tag, index: number, all: Tag[]) =>
              all.findIndex((candidate) => candidate.tag_id === tag.tag_id) ===
              index,
          ),
        );
      }
      if (value(5) && jobsVersion === jobReadVersion.current) setJobs(value(5));
      if (value(6))
        setLibraryTags(
          value(6).list.flatMap(
            (document: { tags?: string[] }) => document.tags ?? [],
          ),
        );
      const failures = result.flatMap((item) =>
        item.status === "rejected"
          ? [
              item.reason instanceof Error
                ? item.reason.message
                : "内容数据加载失败",
            ]
          : [],
      );
      if (failures.length) setMessage([...new Set(failures)].join("；"));
      setLoading(false);
    },
    [
      organizationId,
      teamBindingId,
      brandId,
      language,
      tab,
      promptSearchQuery,
      initialPromptId,
      initialPromptText,
      initialOrganizationId,
      initialBrandId,
    ],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      !jobs.some((job) => job.status === "queued" || job.status === "running")
    )
      return;
    const refreshJobs = async () => {
      if (document.hidden || !navigator.onLine || !brandId) return;
      const version = scopeVersion.current;
      const jobsVersion = ++jobReadVersion.current;
      try {
        const response = await fetch(
          `/api/v1/answerbit/article-jobs?${scopeQuery({ organizationId, teamBindingId, brandId, limit: "20" })}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = await response.json();
        if (
          version !== scopeVersion.current ||
          jobsVersion !== jobReadVersion.current
        )
          return;
        const nextJobs = body.data as Job[];
        setJobs(nextJobs);
        setSelectedJob((current) =>
          current
            ? (nextJobs.find((job) => job.id === current.id) ?? current)
            : null,
        );
      } catch {
        // The manual refresh action remains available if a status request fails.
      }
    };
    const timer = window.setInterval(() => void refreshJobs(), 15_000);
    return () => window.clearInterval(timer);
  }, [jobs, organizationId, teamBindingId, brandId]);
  async function request(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(body.error?.message ?? "操作失败"), {
        code: body.error?.code,
      });
    return body;
  }
  async function trace() {
    if (submitting || !scope.canWrite || !scope.brandId || scope.pointsExpired) return;
    setSubmitting("trace");
    try {
      const urls = traceUrls
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      await request("/api/v1/answerbit/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...apiScope(scope),
          expectedPoints: featurePointCosts.effectTracking,
          title: traceTitle,
          urls,
          tagIds: selectedTraceTags,
          language,
        }),
      });
      setTraceTitle("");
      setTraceUrls("");
      setSelectedTraceTags([]);
      setTraceCreateOpen(false);
      setMessage("文章已加入追踪");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
      if ((error as Error & { code?: string }).code === "FEATURE_PRICE_CHANGED")
        router.refresh();
    } finally {
      setSubmitting("");
    }
  }
  async function generate() {
    if (
      generationSubmitting.current ||
      submitting ||
      !scope.canWrite ||
      !scope.brandId || scope.pointsExpired
    )
      return;
    const template = selectedTemplate;
    if (!template)
      return setMessage("当前生成方式暂无可用模板，请切换方式或重试加载");
    if (!selectedPrompts.length) return setMessage("至少选择一个目标问题");
    if (generationMode === "reference" && !highRefUrl.trim())
      return setMessage("该模板需要参考文章 URL");
    const upstreamTagIds = selectedGenerationTags.filter((value) =>
      tags.some((tag) => tag.tag_id === value),
    );
    const contentTags = selectedGenerationTags
      .map(
        (value) =>
          tags.find((tag) => tag.tag_id === value)?.name ??
          (value.startsWith("local:") ? value.slice(6) : value),
      )
      .map((value) => value.trim())
      .filter(Boolean)
      .filter(
        (value, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === value.toLocaleLowerCase(),
          ) === index,
      );
    if (contentTags.some((tag) => tag.length > 40))
      return setMessage("每个内容标签最多 40 个字符");
    const payload = {
      ...apiScope(scope),
      expectedPoints: featurePointCosts.articleGeneration,
      templateType: Number(activeTemplateType),
      promptIds: selectedPrompts,
      supplementalKnowledge: supplement || undefined,
      highReference:
        generationMode === "reference" ? { url: highRefUrl.trim() } : undefined,
      tagIds: upstreamTagIds,
      contentTags,
      language,
    };
    const version = scopeVersion.current;
    generationSubmitting.current = true;
    jobReadVersion.current += 1;
    setSubmitting("generate");
    try {
      const body = await request("/api/v1/answerbit/article-jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": generationAttempt.current.key(payload),
        },
        body: JSON.stringify(payload),
      });
      if (version !== scopeVersion.current) return;
      generationAttempt.current.complete();
      if (body.data.status === "failed" || body.data.status === "cancelled") {
        setMessage("上一次生成任务未完成，输入已保留。确认后可再次提交生成。");
        await load();
        return;
      }
      setMessage(
        body.data.replayed ? "已返回相同幂等任务" : "生成任务已进入队列",
      );
      setSelectedPrompts([]);
      setSelectedGenerationTags([]);
      setSupplement("");
      setHighRefUrl("");
      changeTab("library");
      await load();
    } catch (error) {
      if (version !== scopeVersion.current) return;
      setMessage((error as Error).message);
      if ((error as Error & { code?: string }).code === "FEATURE_PRICE_CHANGED")
        router.refresh();
    } finally {
      generationSubmitting.current = false;
      setSubmitting("");
    }
  }
  async function cancelJob(job: Job) {
    if (cancellingJob) return;
    const version = scopeVersion.current;
    jobReadVersion.current += 1;
    setCancellingJob(job.id);
    try {
      const result = await request(
        `/api/v1/answerbit/article-jobs/${job.id}?${scopeQuery(apiScope(scope))}`,
        { method: "DELETE" },
      );
      if (version !== scopeVersion.current) return;
      setJobs((current) =>
        current.map((item) => (item.id === job.id ? result.data : item)),
      );
      setSelectedJob((current) =>
        current?.id === job.id ? result.data : current,
      );
      setMessage("等待中的生成任务已取消，未扣除积分。");
    } catch (error) {
      if (version === scopeVersion.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "取消失败，请刷新任务状态后重试",
        );
    } finally {
      setCancellingJob("");
    }
  }
  async function openArticle(id: string) {
    try {
      const body = await request(
        `/api/v1/answerbit/articles/${id}?${scopeQuery(apiScope(scope))}`,
      );
      setDetail(body.data);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  const groupedTagOptions = [
    {
      label: "用户标签",
      options: tags
        .filter((tag) => tag.tag_type !== 2)
        .map((tag) => ({ label: tag.name, value: tag.tag_id })),
    },
    {
      label: "系统标签",
      options: tags
        .filter((tag) => tag.tag_type === 2)
        .map((tag) => ({ label: tag.name, value: tag.tag_id })),
    },
  ].filter((group) => group.options.length > 0);
  const reusableContentTags = [
    ...libraryTags,
    ...jobs.flatMap((job) => job.tags ?? []).map((tag) => tag.tagName),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter(
      (name, index, all) =>
        !tags.some(
          (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        ) &&
        all.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
        ) === index,
    );
  const generationTagOptions = [
    ...groupedTagOptions,
    ...(reusableContentTags.length
      ? [
          {
            label: "我的内容标签",
            options: reusableContentTags.map((name) => ({
              label: name,
              value: `local:${name}`,
            })),
          },
        ]
      : []),
  ];
  const articleColumns: TableColumnsType<Article> = [
    {
      title: "文章",
      dataIndex: "title",
      render: (value: string, item) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary">
            {(sourceLabel[item.source] ?? "来源 " + item.source) +
              " · " +
              (statusLabel[item.status] ?? "状态 " + item.status)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "发布平台",
      dataIndex: "published_platforms",
      responsive: ["md"],
      render: (platforms: Article["published_platforms"]) => (
        <Space size={[4, 4]} wrap>
          {platforms.length
            ? platforms.map((platform) => (
                <AntTag key={platform.platform}>{platform.display_name}</AntTag>
              ))
            : "暂无"}
        </Space>
      ),
    },
    {
      title: "引用",
      dataIndex: "ref_count",
      width: 90,
      render: (value: number) => value + " 次",
    },
    {
      title: "变化",
      dataIndex: "fluctuation",
      width: 90,
      render: (value: number) => (
        <Typography.Text type={value >= 0 ? "success" : "danger"}>
          {(value >= 0 ? "+" : "") + value.toFixed(1)}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 90,
      render: (_, item) => (
        <Button
          icon={<EyeOutlined />}
          onClick={() => void openArticle(item.id)}
          size="small"
        >
          详情
        </Button>
      ),
    },
  ];

  function renderJobList(items: Job[], showCreateAction = true) {
    return items.length ? (
      <List
        dataSource={items}
        renderItem={(job) => {
          const status = jobStatusMeta[job.status];
          return (
            <List.Item
              actions={[
                <Button
                  icon={<EyeOutlined />}
                  key="view"
                  onClick={() => setSelectedJob(job)}
                  size="small"
                >
                  查看
                </Button>,
                ...(job.status === "queued" && scope.canWrite
                  ? [
                      <Popconfirm
                        key="cancel"
                        title="取消等待中的任务？"
                        description="任务尚未开始，不会扣除积分。"
                        onConfirm={() => void cancelJob(job)}
                      >
                        <Button
                          danger
                          size="small"
                          loading={cancellingJob === job.id}
                          disabled={Boolean(cancellingJob)}
                        >
                          取消
                        </Button>
                      </Popconfirm>,
                    ]
                  : []),
              ]}
            >
              <List.Item.Meta
                description={
                  <Space direction="vertical" size={3}>
                    <Typography.Text type="secondary">
                      {`${new Date(job.createdAt).toLocaleString(
                        "zh-CN",
                      )} · 模板 ${job.templateType ?? "—"}`}
                    </Typography.Text>
                    <AntTag
                      color={
                        job.generationMode === "reference" ? "purple" : "blue"
                      }
                    >
                      {job.generationMode === "reference"
                        ? "参考文章生成"
                        : job.generationMode === "standard"
                          ? "普通文章生成"
                          : "历史任务 · 方式未知"}
                    </AntTag>
                    {job.tags?.length ? (
                      <Space size={[4, 4]} wrap>
                        {job.tags.map((tag) => (
                          <AntTag key={`${job.id}-${tag.tagId || tag.tagName}`}>
                            {tag.tagName}
                          </AntTag>
                        ))}
                      </Space>
                    ) : null}
                  </Space>
                }
                title={
                  <Space wrap>
                    <Typography.Text strong>
                      {job.articleTitle ?? `任务 ${job.id.slice(0, 8)}`}
                    </Typography.Text>
                    <AntTag color={status.color}>{status.label}</AntTag>
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />
    ) : (
      <Empty description="还没有生成任务" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        {showCreateAction && scope.canWrite ? (
          <Button
            disabled={!scope.canWrite}
            onClick={() => changeTab("generate")}
            type="primary"
          >
            开始 AI 生成
          </Button>
        ) : null}
      </Empty>
    );
  }

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Card title="内容范围">
        <ScopeFields organizations={organizations} scope={scope} />
        <Tabs
          activeKey={tab}
          items={[
            ...(scope.canWrite ? [{
              key: "generate",
              label: "AI 生成",
            }] : []),
            {
              key: "library",
              label: "文档库",
            },
            {
              key: "trace",
              label: `效果追踪 ${articles.length ? `(${articles.length})` : ""}`,
            },
          ]}
          onChange={(value) =>
            changeTab(value as "library" | "trace" | "generate")
          }
          style={{ marginTop: 20 }}
        />
      </Card>

      {message || scope.error ? (
        <Alert
          closable
          message={message || scope.error}
          onClose={() => {
            setMessage("");
            scope.setError("");
          }}
          showIcon
          type={scope.error ? "error" : "info"}
        />
      ) : null}

      {tab === "generate" ? (
        <Row align="stretch" gutter={[16, 16]}>
          <Col xl={16} xs={24}>
            <Card title="创建 AI 文章">
              <Tabs
                activeKey={generationMode}
                onChange={(value) => {
                  setGenerationMode(value as "standard" | "reference");
                  setTemplateType("");
                  setHighRefUrl("");
                  setMessage("");
                }}
                items={[
                  { key: "standard", label: "普通文章生成" },
                  { key: "reference", label: "参考文章生成" },
                ]}
              />
              <Typography.Paragraph>
                {generationMode === "reference"
                  ? "提供一篇参考文章链接，选择高引用模板，围绕目标问题生成文章。"
                  : "选择普通模板，围绕目标问题和补充资料生成文章。"}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                腾讯生成通常需要 5–10
                分钟。提交后可离开页面，任务状态和结果会保存在这里；完成后文章自动进入文档库。
              </Typography.Paragraph>
              <Form layout="vertical" onFinish={() => void generate()}>
                <Form.Item
                  label={
                    generationMode === "reference"
                      ? "高引用模板"
                      : "普通文章模板"
                  }
                  extra={selectedTemplate?.description}
                  required
                >
                  <Select
                    onChange={setTemplateType}
                    options={availableTemplates.map((item) => ({
                      label:
                        item.template_name +
                        (item.is_high_ref ? " · 高引用模板" : ""),
                      value: String(item.template_id),
                    }))}
                    placeholder="选择模板"
                    value={activeTemplateType || undefined}
                  />
                </Form.Item>
                {!availableTemplates.length && !loading ? (
                  <Alert
                    type="info"
                    showIcon
                    message="当前语言下暂无此类模板，请切换生成方式或语言。"
                    style={{ marginBottom: 16 }}
                  />
                ) : null}
                {generationMode === "reference" ? (
                  <Form.Item
                    label="参考文章链接"
                    extra="填写腾讯可访问的完整文章链接（http:// 或 https://）。"
                    required
                  >
                    <Input
                      onChange={(event) => setHighRefUrl(event.target.value)}
                      placeholder="https://"
                      type="url"
                      value={highRefUrl}
                    />
                  </Form.Item>
                ) : null}
                <Form.Item
                  extra={<Space wrap><Typography.Text type="secondary">最多选择 20 个问题，输入关键词可搜索更多。</Typography.Text>{scope.can("resource.create", "geo_insights") ? <Typography.Link href={`/dashboard/monitoring?${scopeQuery({ organizationId, brandId })}`}>添加监控问题</Typography.Link> : null}</Space>}
                  label="目标监控问题"
                  required
                >
                  <Select
                    mode="multiple"
                    filterOption={false}
                    onSearch={setPromptSearch}
                    loading={loading}
                    onChange={(values) =>
                      setSelectedPrompts(values.slice(0, 20))
                    }
                    optionFilterProp="label"
                    options={prompts.map((item) => ({
                      label: item.query_str + " · " + item.title_name,
                      value: item.id,
                    }))}
                    placeholder="搜索并选择目标问题"
                    showSearch
                    value={selectedPrompts}
                  />
                </Form.Item>
                <Form.Item label="补充资料">
                  <Input.TextArea
                    onChange={(event) => setSupplement(event.target.value)}
                    placeholder="本次生成需要参考的事实、数据和表达要求"
                    rows={5}
                    value={supplement}
                  />
                </Form.Item>
                <Row gutter={12}>
                  <Col md={12} xs={24}>
                    <Form.Item label="语言">
                      <Select
                        onChange={setLanguage}
                        options={[
                          { label: "简体中文", value: "zh-CN" },
                          { label: "English (US)", value: "en-US" },
                          { label: "日本語", value: "ja-JP" },
                        ]}
                        value={language}
                      />
                    </Form.Item>
                  </Col>
                  <Col md={12} xs={24}>
                    <Form.Item
                      extra="直接输入新标签名称并按回车即可新增；标签会随生成结果保存到文档库。腾讯已有标签也会自动列出。"
                      label="文章标签（可选）"
                    >
                      <Select
                        mode="tags"
                        onChange={(values) =>
                          setSelectedGenerationTags(values.slice(0, 20))
                        }
                        optionFilterProp="label"
                        options={generationTagOptions}
                        placeholder="选择已有标签，或输入新标签后回车"
                        showSearch
                        tokenSeparators={[",", "，"]}
                        value={selectedGenerationTags}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Button
                  disabled={
                    !scope.canWrite || !scope.brandId || !selectedTemplate
                    || scope.pointsExpired || !selectedPrompts.length
                  }
                  htmlType="submit"
                  icon={<SendOutlined />}
                  loading={submitting === "generate"}
                  type="primary"
                >
                  {generationMode === "reference"
                    ? "提交参考文章生成"
                    : "提交普通文章生成"}{" "}
                  · 消耗 {featurePointCosts.articleGeneration.toLocaleString()}{" "}
                  积分
                </Button>
              </Form>
            </Card>
          </Col>
          <Col xl={8} xs={24}>
            <Card
              extra={
                <Button onClick={() => changeTab("library")} type="link">
                  查看全部
                </Button>
              }
              title={
                generationMode === "reference"
                  ? "最近参考文章任务"
                  : "最近普通文章任务"
              }
            >
              {renderJobList(
                jobs
                  .filter((job) => job.generationMode === generationMode)
                  .slice(0, 6),
                false,
              )}
            </Card>
          </Col>
        </Row>
      ) : null}

      {tab === "library" ? (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <DocumentLibrary
            key={`${organizationId}:${teamBindingId}:${brandId}`}
            canDelete={scope.canDelete}
            canWrite={scope.canWrite}
            onMessage={setMessage}
            refreshToken={jobs
              .map((job) => `${job.id}:${job.status}:${job.completedAt ?? ""}`)
              .join("|")}
            scope={apiScope(scope)}
          />
          <Card
            extra={
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void load()}
                >
                  刷新状态
                </Button>
                <Button
                  disabled={!scope.canWrite}
                  icon={<PlusOutlined />}
                  onClick={() => changeTab("generate")}
                  type="primary"
                >
                  新建 AI 生成
                </Button>
              </Space>
            }
            title="AI 生成任务"
          >
            {renderJobList(jobs)}
          </Card>
        </Space>
      ) : null}

      {tab === "trace" ? (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            <Col lg={8} sm={12} xs={24}>
              <Card>
                <Statistic title="追踪文章" value={total} />
              </Card>
            </Col>
            <Col lg={8} sm={12} xs={24}>
              <Card>
                <Statistic
                  title="本页发布链接"
                  value={articles.reduce(
                    (sum, item) => sum + item.published_platforms.length,
                    0,
                  )}
                />
              </Card>
            </Col>
            <Col lg={8} sm={24} xs={24}>
              <Card>
                <Statistic
                  title="本页引用次数"
                  value={articles.reduce(
                    (sum, item) => sum + item.ref_count,
                    0,
                  )}
                />
              </Card>
            </Col>
          </Row>
          <Card
            extra={
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void load()}
                >
                  查询追踪数据
                </Button>
                <Button
                  disabled={!scope.canWrite || !scope.brandId}
                  icon={<PlusOutlined />}
                  onClick={() => setTraceCreateOpen(true)}
                  type="primary"
                >
                  新增文章追踪
                </Button>
              </Space>
            }
            title="追踪中的文章"
          >
            <Table<Article>
              columns={articleColumns}
              dataSource={articles}
              locale={{
                emptyText: (
                  <Empty
                    description="还没有追踪文章"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              rowKey="id"
              scroll={{ x: 760 }}
            />
            {scrollId ? (
              <Flex justify="center" style={{ marginTop: 16 }}>
                <Button onClick={() => void load(scrollId)}>加载更多</Button>
              </Flex>
            ) : null}
          </Card>
        </Space>
      ) : null}

      <Modal
        cancelText="取消"
        confirmLoading={submitting === "trace"}
        okButtonProps={{
          disabled:
            !traceTitle.trim() ||
            !traceUrls.trim() ||
            !scope.canWrite ||
            !scope.brandId,
        }}
        okText={`加入追踪 · 消耗 ${featurePointCosts.effectTracking.toLocaleString()} 积分`}
        onCancel={() => setTraceCreateOpen(false)}
        onOk={() => void trace()}
        open={traceCreateOpen}
        title="新增文章追踪"
        width={720}
      >
        <Form layout="vertical">
          <Form.Item label="文章标题" required>
            <Input
              autoFocus
              onChange={(event) => setTraceTitle(event.target.value)}
              value={traceTitle}
            />
          </Form.Item>
          <Form.Item extra="每行一个公开发布链接。" label="发布链接" required>
            <Input.TextArea
              onChange={(event) => setTraceUrls(event.target.value)}
              placeholder="https://example.com/article"
              rows={5}
              value={traceUrls}
            />
          </Form.Item>
          <Form.Item label="语言">
            <Select
              onChange={setLanguage}
              options={[
                { label: "简体中文", value: "zh-CN" },
                { label: "繁体中文", value: "zh-TW" },
                { label: "English (US)", value: "en-US" },
                { label: "日本語", value: "ja-JP" },
              ]}
              value={language}
            />
          </Form.Item>
          <Form.Item
            extra={
              tags.length
                ? "可同时选择用户标签和系统标签。"
                : "当前腾讯团队未返回文章标签，此项可跳过，不影响追踪。"
            }
            label="文章标签（可选）"
          >
            <Select
              disabled={!tags.length}
              mode="multiple"
              onChange={setSelectedTraceTags}
              optionFilterProp="label"
              options={groupedTagOptions}
              placeholder={
                tags.length ? "选择用户或系统标签" : "当前团队暂无可用标签"
              }
              showSearch
              value={selectedTraceTags}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        onClose={() => setDetail(null)}
        open={Boolean(detail)}
        title="文章引用表现"
        width={720}
      >
        {detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions
              column={3}
              items={[
                {
                  key: "total",
                  label: "引用总数",
                  children: detail.stats.total_count,
                },
                {
                  key: "increase",
                  label: "新增引用",
                  children: detail.stats.ref_count_increase,
                },
                {
                  key: "links",
                  label: "发布链接",
                  children: detail.trace_info.length,
                },
              ]}
            />
            <List
              dataSource={detail.trace_info}
              header={<Typography.Text strong>发布链接</Typography.Text>}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    description={item.platform + " · " + item.url}
                    title={
                      <Typography.Link
                        href={item.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.title}
                      </Typography.Link>
                    }
                  />
                  <AntTag>{item.stats.total_count} 次引用</AntTag>
                </List.Item>
              )}
            />
            <Card size="small" title="平台引用">
              <Descriptions
                column={2}
                items={Object.entries(detail.stats.ref_count).map(
                  ([platformName, count]) => ({
                    key: platformName,
                    label: platformName,
                    children: count,
                  }),
                )}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        onClose={() => setSelectedJob(null)}
        open={Boolean(selectedJob)}
        title={selectedJob?.articleTitle ?? "AI 生成内容"}
        width={760}
      >
        {selectedJob ? (
          selectedJob.status === "succeeded" ? (
            <Space direction="vertical" size="large" style={{ width: "100%" }}>
              <Alert
                description="此内容由 AnswerBit 生成，请审核事实、版权和品牌表达后再发布。"
                message="发布前需要人工审核"
                showIcon
                type="warning"
              />
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {selectedJob.articleBody}
              </Typography.Paragraph>
              <Button
                onClick={() => {
                  setSelectedJob(null);
                  changeTab("library");
                }}
              >
                在文档库维护
              </Button>
            </Space>
          ) : (
            <Empty
              description={selectedJob.errorCode ?? "任务处理中"}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <AntTag color={jobStatusMeta[selectedJob.status].color}>
                {jobStatusMeta[selectedJob.status].label}
              </AntTag>
            </Empty>
          )
        ) : null}
      </Drawer>
    </Space>
  );
}
