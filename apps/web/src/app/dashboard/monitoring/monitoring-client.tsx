"use client";
import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
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
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useDirectoryRead } from "../directory-read";
import {
  useDirectoryAttempt,
  type DirectoryAttempt,
} from "../directory-attempt";
import {
  createCategorySchema,
  updateCategorySchema,
  createPromptSchema,
  createPromptsBatchSchema,
  updatePromptSchema,
} from "@geo/contracts";
import { AccessibleTable } from "../../accessible-table";

type Category = {
  id: string;
  title_name: string;
  title_desc: string;
  count: number;
};
type Prompt = {
  id: string;
  query_str: string;
  status: number;
  exposure: number;
  avg_rank: number;
  fluctuation: number;
  title_id: string;
  tags: { tag_id: string; tag_name: string }[];
};
type Group = {
  title_id: string;
  title_name: string;
  title_desc: string;
  prompt_count: number;
  exposure: number;
  fluctuation: number;
  avg_rank: number;
  prompts: Prompt[];
};
const apiScope = (scope: ReturnType<typeof useAnswerBitScope>) => ({
  organizationId: scope.organizationId,
  teamBindingId: scope.teamBindingId,
  brandId: scope.brandId,
});
type Notice = {
  type: "success" | "error" | "info";
  text: string;
};
const accessRoleLabel = {
  tenant_admin: "企业管理员",
  brand_admin: "品牌管理员",
  brand_editor: "品牌编辑",
  brand_viewer: "品牌查看者",
} as const;
export function MonitoringClient({
  organizations,
  userId,
}: {
  organizations: ScopeOrganization[];
  userId: string;
}) {
  const scope = useAnswerBitScope(organizations);
  return (
    <MonitoringWorkspace
      key={`${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`}
      organizations={organizations}
      scope={scope}
      userId={userId}
    />
  );
}
const emptyCategories: Category[] = [];
const emptyGroups: Group[] = [];
// @project-doc docs/domains/geo_operations.md#monitoring_workflow
function MonitoringWorkspace({
  organizations,
  scope,
  userId,
}: {
  organizations: ScopeOrganization[];
  scope: ReturnType<typeof useAnswerBitScope>;
  userId: string;
}) {
  const { organizationId, teamBindingId, brandId } = scope;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [categoryFilterIds, setCategoryFilterIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionKey, setActionKey] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [promptTitleId, setPromptTitleId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryDescription, setEditingCategoryDescription] =
    useState("");
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [promptCreateOpen, setPromptCreateOpen] = useState(false);
  const [editingPromptText, setEditingPromptText] = useState("");
  const mountedRef = useRef(false);
  const mutationRef = useRef("");
  const attempt = useDirectoryAttempt(
    `geo-monitoring-attempt:${userId}:${organizationId}:${teamBindingId}:${brandId}`,
  );
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    const form = attempt.pending?.form;
    if (form?.kind === "category") {
      setCategoryName(form.name);
      setCategoryDescription(form.description);
    }
    if (form?.kind === "prompts") {
      setPromptText(form.text);
      setPromptTitleId(form.titleId);
    }
  }, [attempt.pending]);
  const mutationDisabled = Boolean(
    actionKey || attempt.pending || !attempt.ready,
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const base = { organizationId, teamBindingId, brandId };
  const categoryRead = useDirectoryRead<Category[]>(
    brandId ? `/api/v1/answerbit/categories?${scopeQuery(base)}` : null,
  );
  const platformRead = useDirectoryRead<Record<string, string>>(
    teamBindingId
      ? `/api/v1/answerbit/dashboard/platforms?${scopeQuery({ organizationId, teamBindingId })}`
      : null,
  );
  const promptUrl = brandId
    ? `/api/v1/answerbit/prompts?${scopeQuery({
        ...base,
        page: String(page),
        pageSize: String(pageSize),
        ...(keyword ? { query: keyword } : {}),
        ...(selectedPlatforms.length
          ? { platforms: selectedPlatforms.join(",") }
          : {}),
        ...(categoryFilterIds.length
          ? { titleIds: categoryFilterIds.join(",") }
          : {}),
        ...(dateRange
          ? {
              beginDate: dateRange[0].format("YYYY-MM-DD"),
              endDate: dateRange[1].format("YYYY-MM-DD"),
            }
          : {}),
      })}`
    : null;
  const promptRead = useDirectoryRead<{
    titles: Group[];
    total_prompts: number;
  }>(promptUrl);
  const categories = categoryRead.data ?? emptyCategories;
  const groups = promptRead.data?.titles ?? emptyGroups;
  const total = promptRead.data?.total_prompts ?? 0;
  const platforms = platformRead.data ?? {};
  const displayedModelIds = [...new Set(Object.values(platforms))];
  const syncError = promptRead.error;
  const syncFailureCount = promptRead.failures;
  const loading = promptRead.loading;
  const batchInput = useMemo(() => {
    const lines = promptText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const prompts = [...new Set(lines)];
    return {
      prompts,
      duplicates: lines.length - prompts.length,
      error:
        prompts.length > 100
          ? "单次最多添加 100 个不同的问题，请分批添加。"
          : prompts.some((line) => line.length > 2000)
            ? "每个问题最多 2000 字，请缩短超长的问题。"
            : "",
    };
  }, [promptText]);
  useEffect(() => {
    if (!categoryRead.data) return;
    setPromptTitleId((current) => current || categories[0]?.id || "");
    setCategoryFilterIds((current) => {
      const next = current.filter((id) =>
        categories.some((item) => item.id === id),
      );
      return next.length === current.length ? current : next;
    });
  }, [categoryRead.data, categories]);
  useEffect(() => {
    if (!promptRead.data) return;
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last);
  }, [promptRead.data, total, pageSize, page]);
  async function load(options?: { announce?: boolean; verify?: boolean }) {
    const results = await Promise.all([
      categoryRead.reload(),
      promptRead.reload(),
      platformRead.reload(),
    ]);
    if (!mountedRef.current) return;
    if (options?.verify && results[0] && results[1]) setReviewed(true);
    if (options?.announce && results.every(Boolean))
      setNotice({ type: "success", text: "监测数据已刷新" });
  }
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (attempt.resolvedVersion) void loadRef.current();
  }, [attempt.resolvedVersion]);
  async function request(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    const body = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      const error = new Error(body.error?.message ?? "操作失败") as Error & {
        definite?: boolean;
      };
      error.definite = response.status >= 400 && response.status < 500;
      throw error;
    }
    return body;
  }
  function operationDetails() {
    if (mutationRef.current === "category-create")
      return [
        { label: "分类名称", value: categoryName.trim() },
        { label: "分类描述", value: categoryDescription.trim() },
      ];
    if (mutationRef.current.startsWith("category-update-"))
      return [
        { label: "分类名称", value: editingCategoryName.trim() },
        { label: "分类描述", value: editingCategoryDescription.trim() },
      ];
    if (mutationRef.current === "prompt-create")
      return [
        {
          label: "所属分类",
          value:
            categories.find((item) => item.id === promptTitleId)?.title_name ??
            promptTitleId,
        },
        { label: "问题内容", value: batchInput.prompts.join("\n") },
      ];
    if (editingPrompt)
      return [
        { label: "原问题", value: editingPrompt.query_str },
        { label: "修改后问题", value: editingPromptText.trim() },
      ];
    const id = mutationRef.current.replace(/^prompt-(update|move|delete)-/, "");
    const prompt = groups
      .flatMap((group) => group.prompts)
      .find((item) => item.id === id);
    return [
      {
        label: "操作对象",
        value:
          prompt?.query_str ??
          categories.find(
            (item) => `category-delete-${item.id}` === mutationRef.current,
          )?.title_name ??
          selectedPromptIds.join("、"),
      },
    ];
  }
  async function runMutation(
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
    details?: DirectoryAttempt["details"],
  ) {
    if (mutationRef.current || mutationDisabled) return false;
    mutationRef.current = key;
    setActionKey(key);
    setNotice(null);
    setReviewed(false);
    const operation =
      key === "category-create"
        ? "新增问题分类"
        : key.startsWith("category-update-")
          ? "编辑问题分类"
          : key.startsWith("category-delete-")
            ? "删除问题分类"
            : key === "prompt-create"
              ? "新增监控问题"
              : key.startsWith("prompt-update-")
                ? "修改监控问题"
                : key.startsWith("prompt-move-")
                  ? "移动问题分类"
                  : "删除监控问题";
    const attemptId = crypto.randomUUID();
    attempt.begin({
      id: attemptId,
      operation,
      details: details ?? operationDetails(),
      submittedAt: new Date().toISOString(),
      ...(key === "category-create"
        ? {
            form: {
              kind: "category" as const,
              name: categoryName,
              description: categoryDescription,
            },
          }
        : key === "prompt-create"
          ? {
              form: {
                kind: "prompts" as const,
                titleId: promptTitleId,
                text: promptText,
              },
            }
          : {}),
    });
    try {
      await action();
      attempt.finish(attemptId);
      if (!mountedRef.current) return false;
      setNotice({ type: "success", text: successMessage });
      return true;
    } catch (error) {
      if ((error as Error & { definite?: boolean }).definite)
        attempt.finish(attemptId);
      if (mountedRef.current)
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "操作失败，请核对结果",
        });
      return false;
    } finally {
      attempt.settle(attemptId);
      mutationRef.current = "";
      if (mountedRef.current) setActionKey("");
    }
  }
  const formError =
    notice?.type === "error" ? (
      <Alert
        showIcon
        type="error"
        message={notice.text}
        style={{ marginBottom: 16 }}
      />
    ) : null;
  async function createCategory() {
    if (
      !createCategorySchema.safeParse({
        ...apiScope(scope),
        titleName: categoryName,
        titleDescription: categoryDescription,
      }).success
    ) {
      setNotice({
        type: "error",
        text: "分类名称须为 1–255 字，描述最多 2000 字。",
      });
      return;
    }
    const created = await runMutation(
      "category-create",
      () =>
        request("/api/v1/answerbit/categories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...apiScope(scope),
            titleName: categoryName,
            titleDescription: categoryDescription,
          }),
        }),
      "分类已创建",
    );
    if (created) {
      setCategoryName("");
      setCategoryDescription("");
      setCategoryCreateOpen(false);
    }
  }
  function editCategory(item: Category) {
    setNotice(null);
    setEditingCategory(item);
    setEditingCategoryName(item.title_name);
    setEditingCategoryDescription(item.title_desc);
  }
  async function saveCategory() {
    if (!editingCategory || !editingCategoryName.trim()) return;
    if (
      !updateCategorySchema.safeParse({
        ...apiScope(scope),
        titleName: editingCategoryName,
        titleDescription: editingCategoryDescription,
      }).success
    ) {
      setNotice({
        type: "error",
        text: "分类名称须为 1–255 字，描述最多 2000 字。",
      });
      return;
    }
    const categoryId = editingCategory.id;
    const saved = await runMutation(
      `category-update-${categoryId}`,
      () =>
        request(`/api/v1/answerbit/categories/${categoryId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...apiScope(scope),
            titleName: editingCategoryName.trim(),
            titleDescription: editingCategoryDescription.trim(),
          }),
        }),
      "分类已更新",
    );
    if (saved) setEditingCategory(null);
  }
  async function removeCategory(id: string) {
    const removed = await runMutation(
      `category-delete-${id}`,
      () =>
        request(
          `/api/v1/answerbit/categories/${id}?${scopeQuery(apiScope(scope))}`,
          { method: "DELETE" },
        ),
      "分类已删除",
    );
    if (removed) setSelectedPromptIds([]);
  }
  async function createPrompts() {
    const prompts = batchInput.prompts;
    if (!prompts.length) return;
    const payload =
      prompts.length === 1
        ? { ...apiScope(scope), titleId: promptTitleId, query: prompts[0] }
        : { ...apiScope(scope), titleId: promptTitleId, prompts };
    if (
      batchInput.error ||
      !(
        prompts.length === 1 ? createPromptSchema : createPromptsBatchSchema
      ).safeParse(payload).success ||
      !categories.some((item) => item.id === promptTitleId)
    ) {
      setNotice({
        type: "error",
        text: batchInput.error || "请选择有效分类后添加问题。",
      });
      return;
    }
    const created = await runMutation(
      "prompt-create",
      () =>
        request(
          prompts.length === 1
            ? "/api/v1/answerbit/prompts"
            : "/api/v1/answerbit/prompts/batch",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              prompts.length === 1
                ? {
                    ...apiScope(scope),
                    titleId: promptTitleId,
                    query: prompts[0],
                  }
                : { ...apiScope(scope), titleId: promptTitleId, prompts },
            ),
          },
        ),
      `已创建 ${prompts.length} 个监控问题`,
    );
    if (created) {
      setPromptText("");
      setPromptCreateOpen(false);
    }
  }
  async function updatePrompt(
    item: Prompt,
    changes: { query?: string; status?: 1 | 2 },
  ) {
    if (
      !updatePromptSchema.safeParse({ ...apiScope(scope), ...changes }).success
    ) {
      setNotice({ type: "error", text: "问题内容须为 1–2000 字。" });
      return false;
    }
    return runMutation(
      `prompt-update-${item.id}`,
      () =>
        request(`/api/v1/answerbit/prompts/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...apiScope(scope), ...changes }),
        }),
      changes.status
        ? changes.status === 1
          ? "问题已启用，AnswerBit 将持续监测"
          : "问题已停用"
        : "问题已更新",
      [
        { label: "原问题", value: item.query_str },
        ...(changes.status
          ? [
              {
                label: "修改后状态",
                value: changes.status === 1 ? "监测中" : "已停用",
              },
            ]
          : [{ label: "修改后问题", value: changes.query ?? "" }]),
      ],
    );
  }
  async function savePrompt() {
    if (!editingPrompt || !editingPromptText.trim()) return;
    const saved = await updatePrompt(editingPrompt, {
      query: editingPromptText.trim(),
    });
    if (saved) setEditingPrompt(null);
  }
  async function movePrompt(item: Prompt, titleId: string) {
    await runMutation(
      `prompt-move-${item.id}`,
      () =>
        request(`/api/v1/answerbit/prompts/${item.id}/category`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...apiScope(scope), titleId }),
        }),
      "问题已移动",
      [
        { label: "问题内容", value: item.query_str },
        {
          label: "目标分类",
          value:
            categories.find((category) => category.id === titleId)
              ?.title_name ?? titleId,
        },
      ],
    );
  }
  async function removePrompt(id: string) {
    const removed = await runMutation(
      `prompt-delete-${id}`,
      () =>
        request(
          `/api/v1/answerbit/prompts/${id}?${scopeQuery(apiScope(scope))}`,
          { method: "DELETE" },
        ),
      "问题已删除",
    );
    if (removed)
      setSelectedPromptIds((current) =>
        current.filter((promptId) => promptId !== id),
      );
  }
  const visiblePrompts = groups.flatMap((group) => group.prompts);
  const visiblePromptIds = visiblePrompts.map((prompt) => prompt.id);
  const promptColumns: TableColumnsType<Prompt> = [
    ...(scope.can("resource.delete", "geo_insights")
      ? [
          {
            key: "selection",
            title: "选择",
            width: 72,
            render: (_: unknown, item: Prompt) => (
              <Checkbox
                aria-label={`选择问题 ${item.query_str}`}
                checked={selectedPromptIds.includes(item.id)}
                disabled={mutationDisabled}
                onChange={(event) =>
                  togglePromptSelection(item.id, event.target.checked)
                }
              />
            ),
          },
        ]
      : []),
    {
      title: "监控问题",
      key: "query",
      render: (_, item) => (
        <Flex gap={6} vertical>
          <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
            {item.query_str}
          </Typography.Text>
          {item.tags.length ? (
            <Space size={[4, 4]} wrap>
              {item.tags.map((tag) => (
                <Tag key={tag.tag_id}>{tag.tag_name}</Tag>
              ))}
            </Space>
          ) : null}
          {displayedModelIds.length ? (
            <Space size={[10, 6]} wrap>
              <Typography.Text type="secondary">监测模型</Typography.Text>
              {displayedModelIds.map((modelId) => (
                <ModelLabel
                  key={modelId}
                  modelId={modelId}
                  upstreamLabel={findModelUpstreamLabel(platforms, modelId)}
                />
              ))}
            </Space>
          ) : null}
        </Flex>
      ),
    },
    {
      title: "所属分类",
      key: "category",
      width: 160,
      render: (_, item) =>
        scope.can("resource.update", "geo_insights") ? (
          <Select
            aria-label={`移动问题 ${item.query_str}`}
            disabled={
              mutationDisabled ||
              !categoryRead.data ||
              Boolean(categoryRead.error)
            }
            loading={actionKey === `prompt-move-${item.id}`}
            onChange={(value) => void movePrompt(item, value)}
            options={categories.map((category) => ({
              label: category.title_name,
              value: category.id,
            }))}
            size="small"
            style={{ width: "100%" }}
            value={item.title_id}
          />
        ) : (
          (categories.find((category) => category.id === item.title_id)
            ?.title_name ??
          groups.find((group) => group.title_id === item.title_id)
            ?.title_name ??
          "未分类")
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 92,
      render: (value: number) => (
        <Tag color={value === 1 ? "success" : "default"}>
          {value === 1 ? "监测中" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "提及率",
      dataIndex: "exposure",
      align: "right",
      width: 94,
      render: (value: number) => `${value.toFixed(1)}%`,
    },
    {
      title: "平均排名",
      dataIndex: "avg_rank",
      align: "right",
      width: 100,
      render: (value: number) => value.toFixed(1),
    },
    {
      title: "提及变化",
      dataIndex: "fluctuation",
      align: "right",
      width: 108,
      render: (value: number) => (
        <Typography.Text
          type={value > 0 ? "success" : value < 0 ? "danger" : "secondary"}
        >
          {value > 0 ? "+" : ""}
          {value.toFixed(1)}
        </Typography.Text>
      ),
    },
    ...(scope.can("resource.create", "geo_insights")
      ? [
          {
            title: "操作",
            key: "actions",
            width: 190,
            render: (_: unknown, item: Prompt) => (
              <Space size={4} wrap>
                <Button
                  aria-label={`编辑问题 ${item.query_str}`}
                  disabled={mutationDisabled}
                  icon={<EditOutlined />}
                  onClick={() => {
                    setNotice(null);
                    setEditingPrompt(item);
                    setEditingPromptText(item.query_str);
                  }}
                  size="small"
                >
                  编辑
                </Button>
                {scope.can("resource.create") ? (
                  <Button
                    size="small"
                    href={`/dashboard/content?${scopeQuery({ stage: "generate", organizationId: scope.organizationId, brandId: scope.brandId, promptId: item.id, promptText: item.query_str.slice(0, 500) })}`}
                  >
                    生成文章
                  </Button>
                ) : null}
                <Button
                  aria-label={`${item.status === 1 ? "停用" : "启用"}问题 ${item.query_str}`}
                  disabled={mutationDisabled}
                  loading={actionKey === `prompt-update-${item.id}`}
                  onClick={() =>
                    void updatePrompt(item, {
                      status: item.status === 1 ? 2 : 1,
                    })
                  }
                  size="small"
                >
                  {item.status === 1 ? "停用" : "启用"}
                </Button>
                {scope.can("resource.delete", "geo_insights") ? (
                  <Popconfirm
                    title="确认删除这个监控问题？"
                    onConfirm={() => void removePrompt(item.id)}
                    okText="删除"
                    okButtonProps={{
                      danger: true,
                      loading: actionKey === `prompt-delete-${item.id}`,
                    }}
                  >
                    <Button
                      aria-label={`删除问题 ${item.query_str}`}
                      danger
                      disabled={mutationDisabled}
                      icon={<DeleteOutlined />}
                      size="small"
                    />
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ]
      : []),
  ];

  const allVisiblePromptsSelected =
    visiblePromptIds.length > 0 &&
    visiblePromptIds.every((id) => selectedPromptIds.includes(id));
  const someVisiblePromptsSelected = visiblePromptIds.some((id) =>
    selectedPromptIds.includes(id),
  );
  const togglePromptSelection = (promptId: string, checked: boolean) => {
    if (checked && !selectedPromptIds.includes(promptId)) {
      if (selectedPromptIds.length >= 100) {
        setNotice({ type: "error", text: "单次最多选择 100 个监测问题" });
        return;
      }
      setSelectedPromptIds([...selectedPromptIds, promptId]);
      return;
    }
    if (!checked)
      setSelectedPromptIds(
        selectedPromptIds.filter((item) => item !== promptId),
      );
  };
  const toggleCurrentPageSelection = (checked: boolean) => {
    if (!checked) {
      setSelectedPromptIds((current) =>
        current.filter((id) => !visiblePromptIds.includes(id)),
      );
      return;
    }
    const next = [...new Set([...selectedPromptIds, ...visiblePromptIds])];
    if (next.length > 100) {
      setNotice({ type: "error", text: "单次最多选择 100 个监测问题" });
      return;
    }
    setSelectedPromptIds(next);
  };
  const resetFilters = () => {
    setKeywordDraft("");
    setKeyword("");
    setSelectedPlatforms([]);
    setCategoryFilterIds([]);
    setDateRange(null);
    setSelectedPromptIds([]);
    setPage(1);
  };
  async function removeSelectedPrompts() {
    if (!selectedPromptIds.length) return;
    const count = selectedPromptIds.length;
    const removed = await runMutation(
      "prompt-delete-batch",
      () =>
        request("/api/v1/answerbit/prompts/batch", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...apiScope(scope),
            promptIds: selectedPromptIds,
          }),
        }),
      `已删除 ${count} 个监测问题`,
    );
    if (removed) setSelectedPromptIds([]);
  }
  const activePrompts = visiblePrompts.filter(
    (prompt) => prompt.status === 1,
  ).length;
  const hasActiveFilters = Boolean(
    keyword ||
      selectedPlatforms.length ||
      categoryFilterIds.length ||
      dateRange,
  );
  const monitoringStatus = !brandId
    ? { status: "default" as const, text: "等待选择品牌" }
    : loading || categoryRead.loading || platformRead.loading
      ? { status: "processing" as const, text: "正在刷新" }
      : syncError || categoryRead.error || platformRead.error
        ? { status: "error" as const, text: "请求异常" }
        : { status: "success" as const, text: "数据已加载" };
  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="问题分类"
              value={categoryRead.data ? categories.length : "—"}
            />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="监控问题"
              suffix="条"
              value={promptRead.data ? total : "—"}
            />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="当前页已启用"
              suffix={
                promptRead.data ? `/ ${visiblePrompts.length}` : undefined
              }
              value={promptRead.data ? activePrompts : "—"}
            />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="当前权限"
              valueStyle={{ fontSize: 20, whiteSpace: "nowrap" }}
              value={
                scope.brand ? accessRoleLabel[scope.brand.accessRole] : "—"
              }
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Flex align="center" justify="space-between" gap={12} wrap>
            <Space>
              <CloudSyncOutlined />
              <span>持续检测控制台</span>
            </Space>
            <Space wrap>
              <Badge
                status={monitoringStatus.status}
                text={monitoringStatus.text}
              />
              <Button
                aria-label="刷新数据"
                disabled={!scope.brandId}
                icon={<ReloadOutlined />}
                loading={
                  loading || categoryRead.loading || platformRead.loading
                }
                onClick={() => void load({ announce: true })}
              >
                刷新数据
              </Button>
            </Space>
          </Flex>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          已启用的问题由 AnswerBit 持续监测，筛选变化时按当前条件请求最新结果。
        </Typography.Paragraph>
        <div className="monitoring-filter-grid">
          <ScopeFields organizations={organizations} scope={scope} />
          <Flex align="flex-end" gap={12} wrap>
            <Flex style={{ flex: "1 1 200px", minWidth: 180 }} vertical>
              <label htmlFor="monitoring-model-filter">
                <Typography.Text type="secondary">模型</Typography.Text>
              </label>
              <Select
                allowClear
                disabled={!brandId || !Object.keys(platforms).length}
                id="monitoring-model-filter"
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
                  setSelectedPlatforms(value);
                  setSelectedPromptIds([]);
                  setPage(1);
                }}
                optionFilterProp="searchText"
                options={modelSelectOptions(platforms)}
                placeholder="全部模型"
                showSearch
                value={selectedPlatforms}
              />
            </Flex>
            <Flex style={{ flex: "1 1 220px", minWidth: 180 }} vertical>
              <label htmlFor="monitoring-category-filter">
                <Typography.Text type="secondary">问题分类</Typography.Text>
              </label>
              <Select
                allowClear
                disabled={!brandId || !categories.length}
                id="monitoring-category-filter"
                maxTagCount="responsive"
                mode="multiple"
                onChange={(value) => {
                  setCategoryFilterIds(value);
                  setSelectedPromptIds([]);
                  setPage(1);
                }}
                options={categories.map((item) => ({
                  label: `${item.title_name}（${item.count}）`,
                  value: item.id,
                }))}
                placeholder="全部分类"
                value={categoryFilterIds}
              />
            </Flex>
            <Flex style={{ flex: "1 1 260px", minWidth: 240 }} vertical>
              <Typography.Text type="secondary">监测日期</Typography.Text>
              <DatePicker.RangePicker
                aria-label="监测日期"
                allowClear
                allowEmpty={[false, false]}
                id={{
                  start: "monitoring-date-start",
                  end: "monitoring-date-end",
                }}
                placeholder={["监测开始日期", "监测结束日期"]}
                disabled={!brandId}
                format="YYYY-MM-DD"
                onChange={(value) => {
                  setDateRange(
                    value?.[0] && value[1] ? [value[0], value[1]] : null,
                  );
                  setSelectedPromptIds([]);
                  setPage(1);
                }}
                presets={[
                  {
                    label: "最近 7 天",
                    value: [dayjs().subtract(6, "day"), dayjs()],
                  },
                  {
                    label: "最近 30 天",
                    value: [dayjs().subtract(29, "day"), dayjs()],
                  },
                ]}
                style={{ width: "100%" }}
                value={dateRange}
              />
            </Flex>
            <Flex style={{ flex: "1 1 240px", minWidth: 200 }} vertical>
              <label htmlFor="monitoring-search">
                <Typography.Text type="secondary">搜索问题</Typography.Text>
              </label>
              <Input.Search
                id="monitoring-search"
                maxLength={500}
                allowClear
                onChange={(event) => {
                  setKeywordDraft(event.target.value);
                  if (!event.target.value && keyword) {
                    setSelectedPromptIds([]);
                    setPage(1);
                    setKeyword("");
                  }
                }}
                onSearch={(value) => {
                  const nextKeyword = value.trim();
                  if (nextKeyword === keyword) void load({ announce: true });
                  else {
                    setSelectedPromptIds([]);
                    setPage(1);
                    setKeyword(nextKeyword);
                  }
                }}
                placeholder="输入关键词后搜索"
                value={keywordDraft}
              />
            </Flex>
            <Button disabled={!hasActiveFilters} onClick={resetFilters}>
              重置筛选
            </Button>
          </Flex>
        </div>
      </Card>

      {scope.error ? (
        <Alert
          action={<Button onClick={scope.reloadBrands}>重试范围</Button>}
          closable
          message={scope.error}
          onClose={() => scope.setError("")}
          showIcon
          type="error"
        />
      ) : null}

      {categoryRead.error ? (
        <Alert
          showIcon
          type="error"
          message="问题分类请求失败"
          description={categoryRead.error}
          action={
            <Button
              aria-label="重试分类"
              loading={categoryRead.loading}
              onClick={() => void categoryRead.reload()}
            >
              重试分类
            </Button>
          }
        />
      ) : null}
      {platformRead.error ? (
        <Alert
          showIcon
          type="error"
          message="监测模型请求失败"
          description={platformRead.error}
          action={
            <Button
              aria-label="重试模型"
              loading={platformRead.loading}
              onClick={() => void platformRead.reload()}
            >
              重试模型
            </Button>
          }
        />
      ) : null}
      {attempt.storageError ? (
        <Alert showIcon type="error" message={attempt.storageError} />
      ) : null}
      {(attempt.pending || (!attempt.ready && attempt.storageError)) &&
      !actionKey ? (
        <Card title="上次操作结果待核对">
          <Alert
            showIcon
            type="warning"
            message={`${attempt.pending?.operation ?? "原操作"}的结果尚未确认`}
            description={
              attempt.inFlight
                ? "原操作仍在提交，请等待结果后再核对。"
                : "原操作不会自动重发。请刷新目录，并按以下原内容搜索、翻页核对；确认后结束本次操作，才能继续修改。"
            }
          />
          <List
            dataSource={attempt.pending?.details ?? []}
            renderItem={(detail) => (
              <List.Item>
                <Flex vertical style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    {detail.label}
                  </Typography.Text>
                  <Typography.Paragraph
                    ellipsis={{
                      rows: 6,
                      expandable: true,
                      symbol: "展开原内容",
                    }}
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      marginBottom: 0,
                    }}
                  >
                    {detail.value || "无"}
                  </Typography.Paragraph>
                </Flex>
              </List.Item>
            )}
          />
          <Space wrap>
            <Button
              aria-label="刷新目录核对"
              disabled={attempt.inFlight}
              loading={loading || categoryRead.loading}
              onClick={() => {
                setCategoryCreateOpen(false);
                setPromptCreateOpen(false);
                setEditingCategory(null);
                setEditingPrompt(null);
                void load({ verify: true });
              }}
            >
              刷新目录核对
            </Button>
            <Popconfirm
              title="已核对腾讯目录中的操作结果？"
              description="只结束本次核对，不会再次发送原操作。"
              okText="结束本次操作"
              onConfirm={() => {
                if (attempt.finish()) {
                  setReviewed(false);
                  setNotice({
                    type: "info",
                    text: "本次核对已结束，请根据目录结果继续操作。",
                  });
                }
              }}
            >
              <Button
                disabled={
                  attempt.inFlight ||
                  !reviewed ||
                  Boolean(categoryRead.error || syncError) ||
                  loading
                }
              >
                已核对，结束本次操作
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      ) : null}
      {syncError ? (
        <Alert
          action={
            <Button
              aria-label="立即重试"
              loading={loading}
              onClick={() => void promptRead.reload()}
            >
              立即重试
            </Button>
          }
          description={syncError}
          message={`监测数据请求失败${syncFailureCount > 1 ? `（连续 ${syncFailureCount} 次）` : ""}`}
          showIcon
          type="error"
        />
      ) : null}

      {notice ? (
        <Alert
          closable
          message={notice.text}
          onClose={() => setNotice(null)}
          showIcon
          type={notice.type}
        />
      ) : null}

      <Card
        id="monitoring-prompts"
        title="监控问题"
        extra={
          <Space wrap>
            {selectedPlatforms.map((modelId) => (
              <ModelLabel
                key={modelId}
                modelId={modelId}
                upstreamLabel={findModelUpstreamLabel(platforms, modelId)}
              />
            ))}
            <Tag>{promptRead.data ? `${total} 条` : "未加载"}</Tag>
            {scope.can("resource.create", "geo_insights") ? (
              <Button
                aria-label="新增问题"
                icon={<PlusOutlined />}
                onClick={() => {
                  setNotice(null);
                  setPromptCreateOpen(true);
                }}
                disabled={!brandId || mutationDisabled}
              >
                新增问题
              </Button>
            ) : null}
          </Space>
        }
      >
        {scope.can("resource.delete", "geo_insights") &&
        (visiblePromptIds.length || selectedPromptIds.length) ? (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Flex align="center" gap={12} justify="space-between" wrap>
              <Space size={12} wrap>
                <Checkbox
                  disabled={mutationDisabled || loading}
                  checked={allVisiblePromptsSelected}
                  indeterminate={
                    someVisiblePromptsSelected && !allVisiblePromptsSelected
                  }
                  onChange={(event) =>
                    toggleCurrentPageSelection(event.target.checked)
                  }
                >
                  选择当前页
                </Checkbox>
                <Typography.Text type="secondary">
                  已选 {selectedPromptIds.length} 个，支持跨页选择，单次最多 100
                  个
                </Typography.Text>
              </Space>
              <Space>
                {selectedPromptIds.length ? (
                  <Button
                    disabled={mutationDisabled}
                    onClick={() => setSelectedPromptIds([])}
                    type="text"
                  >
                    清空选择
                  </Button>
                ) : null}
                <Popconfirm
                  description={`将通过腾讯接口删除已选的 ${selectedPromptIds.length} 个监测问题，此操作不可撤销。`}
                  disabled={!selectedPromptIds.length}
                  okButtonProps={{
                    danger: true,
                    loading: actionKey === "prompt-delete-batch",
                  }}
                  okText="确认批量删除"
                  onConfirm={() => void removeSelectedPrompts()}
                  title="批量删除监测问题？"
                >
                  <Button
                    danger
                    disabled={!selectedPromptIds.length || mutationDisabled}
                    icon={<DeleteOutlined />}
                  >
                    批量删除
                  </Button>
                </Popconfirm>
              </Space>
            </Flex>
          </Card>
        ) : null}
        <AccessibleTable<Prompt>
          columns={promptColumns}
          dataSource={visiblePrompts}
          loading={loading}
          rowKey="id"
          tableLayout="fixed"
          scroll={{ x: 1080 }}
          scrollRegionLabel="监控问题列表，可横向滚动查看指标和操作"
          locale={{
            emptyText: (
              <Empty
                description={
                  syncError && !promptRead.data
                    ? "当前条件的问题尚未加载，请重试"
                    : brandId
                      ? hasActiveFilters
                        ? "没有符合筛选条件的监控问题"
                        : "暂无监控问题，可点击新增问题"
                      : "请先选择品牌"
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            showTotal: (count) => `共 ${count} 条监测问题`,
            onChange: (nextPage, nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(nextPageSize === pageSize ? nextPage : 1);
            },
          }}
        />
      </Card>

      <Card
        id="monitoring-categories"
        title="问题分类"
        extra={
          scope.can("resource.create", "geo_insights") ? (
            <Button
              aria-label="新增分类"
              disabled={!brandId || mutationDisabled}
              icon={<PlusOutlined />}
              onClick={() => {
                setNotice(null);
                setCategoryCreateOpen(true);
              }}
            >
              新增分类
            </Button>
          ) : null
        }
      >
        {categories.length ? (
          <List
            dataSource={categories}
            grid={{ gutter: 16, column: 3, xs: 1, sm: 1, md: 2, lg: 3 }}
            renderItem={(item) => (
              <List.Item>
                <Card
                  size="small"
                  actions={
                    scope.can("resource.create", "geo_insights")
                      ? [
                          <Button
                            aria-label={`编辑分类 ${item.title_name}`}
                            disabled={mutationDisabled}
                            icon={<EditOutlined />}
                            key="edit"
                            onClick={() => editCategory(item)}
                            size="small"
                            type="text"
                          >
                            编辑
                          </Button>,
                          ...(scope.can("resource.delete", "geo_insights")
                            ? [
                                <Popconfirm
                                  description="分类下的问题可能受到影响。"
                                  key="delete"
                                  okButtonProps={{
                                    danger: true,
                                    loading:
                                      actionKey ===
                                      `category-delete-${item.id}`,
                                  }}
                                  okText="删除"
                                  onConfirm={() => void removeCategory(item.id)}
                                  title="确认删除分类？"
                                >
                                  <Button
                                    aria-label={`删除分类 ${item.title_name}`}
                                    danger
                                    disabled={mutationDisabled}
                                    icon={<DeleteOutlined />}
                                    size="small"
                                    type="text"
                                  >
                                    删除
                                  </Button>
                                </Popconfirm>,
                              ]
                            : []),
                        ]
                      : undefined
                  }
                >
                  <Flex gap={6} vertical>
                    <Flex align="center" justify="space-between" gap={12}>
                      <Typography.Text strong>
                        {item.title_name}
                      </Typography.Text>
                      <Tag>{item.count} 条</Tag>
                    </Flex>
                    <Typography.Text type="secondary">
                      {item.title_desc || "无描述"}
                    </Typography.Text>
                  </Flex>
                </Card>
              </List.Item>
            )}
          />
        ) : (
          <Empty
            description={
              categoryRead.error && !categoryRead.data
                ? "分类尚未加载，请重试"
                : "暂无问题分类"
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>

      <Modal
        closable={!actionKey}
        maskClosable={!actionKey}
        keyboard={!actionKey}
        cancelButtonProps={{ disabled: Boolean(actionKey) }}
        cancelText="取消"
        confirmLoading={actionKey === "category-create"}
        okButtonProps={{
          "aria-label": "创建分类",
          disabled: !categoryName.trim() || mutationDisabled,
        }}
        okText="创建分类"
        onCancel={() => setCategoryCreateOpen(false)}
        onOk={() => void createCategory()}
        open={categoryCreateOpen}
        title="新增问题分类"
        width={640}
      >
        {formError}
        {attempt.pending && !actionKey ? (
          <Alert
            showIcon
            type="warning"
            message="操作结果待核对，请关闭弹窗查看原操作记录。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical" disabled={mutationDisabled}>
          <Form.Item
            htmlFor="monitoring-create-category-name"
            label="分类名称"
            required
          >
            <Input
              autoFocus
              id="monitoring-create-category-name"
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="输入分类名称"
              value={categoryName}
            />
          </Form.Item>
          <Form.Item
            htmlFor="monitoring-create-category-description"
            label="分类描述"
          >
            <Input.TextArea
              id="monitoring-create-category-description"
              onChange={(event) => setCategoryDescription(event.target.value)}
              placeholder="补充分类用途（可选）"
              rows={3}
              value={categoryDescription}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        closable={!actionKey}
        maskClosable={!actionKey}
        keyboard={!actionKey}
        cancelButtonProps={{ disabled: Boolean(actionKey) }}
        cancelText="取消"
        confirmLoading={actionKey.startsWith("category-update-")}
        okButtonProps={{
          "aria-label": "保存分类",
          disabled: !editingCategoryName.trim() || mutationDisabled,
        }}
        okText="保存分类"
        onCancel={() => setEditingCategory(null)}
        onOk={() => void saveCategory()}
        open={Boolean(editingCategory)}
        title="编辑问题分类"
        width={640}
      >
        {formError}
        {attempt.pending && !actionKey ? (
          <Alert
            showIcon
            type="warning"
            message="操作结果待核对，请关闭弹窗查看原操作记录。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical" disabled={mutationDisabled}>
          <Form.Item
            htmlFor="monitoring-edit-category-name"
            label="分类名称"
            required
          >
            <Input
              autoFocus
              id="monitoring-edit-category-name"
              onChange={(event) => setEditingCategoryName(event.target.value)}
              value={editingCategoryName}
            />
          </Form.Item>
          <Form.Item
            htmlFor="monitoring-edit-category-description"
            label="分类描述"
          >
            <Input.TextArea
              id="monitoring-edit-category-description"
              onChange={(event) =>
                setEditingCategoryDescription(event.target.value)
              }
              rows={3}
              value={editingCategoryDescription}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        closable={!actionKey}
        maskClosable={!actionKey}
        keyboard={!actionKey}
        cancelButtonProps={{ disabled: Boolean(actionKey) }}
        cancelText="取消"
        confirmLoading={actionKey === "prompt-create"}
        okButtonProps={{
          "aria-label": "添加问题",
          disabled:
            !promptTitleId ||
            !promptText.trim() ||
            mutationDisabled ||
            Boolean(batchInput.error) ||
            !categoryRead.data ||
            Boolean(categoryRead.error),
        }}
        okText="添加问题"
        onCancel={() => setPromptCreateOpen(false)}
        onOk={() => void createPrompts()}
        open={promptCreateOpen}
        title="新增监控问题"
        width={760}
      >
        {formError}
        {attempt.pending && !actionKey ? (
          <Alert
            showIcon
            type="warning"
            message="操作结果待核对，请关闭弹窗查看原操作记录。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {promptTitleId &&
        categoryRead.data &&
        !categories.some((item) => item.id === promptTitleId) ? (
          <Alert
            showIcon
            type="warning"
            message="原分类已不在当前目录，请重新选择分类。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical" disabled={mutationDisabled}>
          <Form.Item
            htmlFor="monitoring-new-prompt-category"
            label="所属分类"
            required
          >
            <Select
              id="monitoring-new-prompt-category"
              onChange={setPromptTitleId}
              options={categories.map((item) => ({
                label: item.title_name,
                value: item.id,
              }))}
              placeholder="选择分类"
              value={promptTitleId || undefined}
            />
          </Form.Item>
          <Form.Item
            extra={`每行一个问题，单次最多 100 个，每个最多 2000 字。将添加 ${batchInput.prompts.length} 个${batchInput.duplicates ? `，已合并 ${batchInput.duplicates} 行重复内容` : ""}。`}
            validateStatus={batchInput.error ? "error" : undefined}
            help={batchInput.error || undefined}
            htmlFor="monitoring-new-prompt-text"
            label="问题内容"
            required
          >
            <Input.TextArea
              autoFocus
              id="monitoring-new-prompt-text"
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="输入需要监控的问题"
              rows={6}
              value={promptText}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        closable={!actionKey}
        maskClosable={!actionKey}
        keyboard={!actionKey}
        cancelButtonProps={{ disabled: Boolean(actionKey) }}
        cancelText="取消"
        confirmLoading={actionKey.startsWith("prompt-update-")}
        okButtonProps={{
          "aria-label": "保存问题",
          disabled: !editingPromptText.trim() || mutationDisabled,
        }}
        okText="保存问题"
        onCancel={() => setEditingPrompt(null)}
        onOk={() => void savePrompt()}
        open={Boolean(editingPrompt)}
        title="编辑监控问题"
        width={720}
      >
        {formError}
        {attempt.pending && !actionKey ? (
          <Alert
            showIcon
            type="warning"
            message="操作结果待核对，请关闭弹窗查看原操作记录。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical" disabled={mutationDisabled}>
          <Form.Item
            htmlFor="monitoring-edit-prompt-text"
            label="问题内容"
            required
          >
            <Input.TextArea
              autoFocus
              id="monitoring-edit-prompt-text"
              value={editingPromptText}
              onChange={(event) => setEditingPromptText(event.target.value)}
              autoSize={{ minRows: 4, maxRows: 10 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
