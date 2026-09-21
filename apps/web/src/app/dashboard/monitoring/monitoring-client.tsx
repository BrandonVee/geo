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
import { useCallback, useEffect, useRef, useState } from "react";
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
}: {
  organizations: ScopeOrganization[];
}) {
  const scope = useAnswerBitScope(organizations);
  const { organizationId, teamBindingId, brandId } = scope;
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [categoryFilterIds, setCategoryFilterIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncFailureCount, setSyncFailureCount] = useState(0);
  const [loading, setLoading] = useState(false);
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
  const displayedModelIds = [...new Set(Object.values(platforms))];
  const scopeKey = `${organizationId}:${teamBindingId}:${brandId}`;
  const scopeKeyRef = useRef(scopeKey);
  const loadRunRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!organizationId || !teamBindingId) {
      setPlatforms({});
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/v1/answerbit/dashboard/platforms?${scopeQuery({ organizationId, teamBindingId })}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message);
        setPlatforms(body.data ?? {});
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setPlatforms({});
      });
    return () => controller.abort();
  }, [organizationId, teamBindingId]);
  useEffect(() => {
    scopeKeyRef.current = scopeKey;
    setEditingCategory(null);
    setEditingPrompt(null);
    setCategoryCreateOpen(false);
    setPromptCreateOpen(false);
    setCategoryName("");
    setCategoryDescription("");
    setPromptText("");
    setKeywordDraft("");
    setKeyword("");
    setSelectedPlatforms([]);
    setCategoryFilterIds([]);
    setDateRange(null);
    setSelectedPromptIds([]);
    setPage(1);
    setNotice(null);
    setSyncError("");
    setSyncFailureCount(0);
  }, [scopeKey]);
  const load = useCallback(
    async (options?: { announce?: boolean }) => {
      const runId = ++loadRunRef.current;
      loadControllerRef.current?.abort();
      if (!brandId) {
        setCategories([]);
        setGroups([]);
        setTotal(0);
        setPromptTitleId("");
        setSyncError("");
        setSyncFailureCount(0);
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      loadControllerRef.current = controller;
      setLoading(true);
      const base = { organizationId, teamBindingId, brandId };
      try {
        const [categoryResponse, promptResponse] = await Promise.all([
          fetch(`/api/v1/answerbit/categories?${scopeQuery(base)}`, {
            signal: controller.signal,
          }),
          fetch(
            `/api/v1/answerbit/prompts?${scopeQuery({
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
            })}`,
            { signal: controller.signal },
          ),
        ]);
        const [categoryBody, promptBody] = await Promise.all([
          categoryResponse.json(),
          promptResponse.json(),
        ]);
        if (!categoryResponse.ok || !promptResponse.ok)
          throw new Error(
            categoryBody.error?.message ?? promptBody.error?.message,
          );
        if (controller.signal.aborted || runId !== loadRunRef.current) return;
        const nextTotal = promptBody.data.total_prompts;
        const lastPage = Math.max(1, Math.ceil(nextTotal / pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setCategories(categoryBody.data);
        setCategoryFilterIds((current) => {
          const next = current.filter((id) =>
            categoryBody.data.some((item: Category) => item.id === id),
          );
          return next.length === current.length ? current : next;
        });
        setGroups(promptBody.data.titles);
        setTotal(nextTotal);
        setPromptTitleId((current) =>
          categoryBody.data.some((item: Category) => item.id === current)
            ? current
            : categoryBody.data[0]?.id || "",
        );
        setSyncError("");
        setSyncFailureCount(0);
        if (options?.announce)
          setNotice({ type: "success", text: "监测数据已刷新" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (runId !== loadRunRef.current) return;
        setSyncError(
          error instanceof Error ? error.message : "监控问题加载失败",
        );
        setSyncFailureCount((current) => current + 1);
      } finally {
        if (runId === loadRunRef.current) setLoading(false);
      }
    },
    [
      organizationId,
      teamBindingId,
      brandId,
      keyword,
      selectedPlatforms,
      categoryFilterIds,
      dateRange,
      page,
      pageSize,
    ],
  );
  useEffect(() => {
    void load();
    return () => loadControllerRef.current?.abort();
  }, [load]);
  async function request(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    const body = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "操作失败");
    return body;
  }
  async function runMutation(
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    if (actionKey) return false;
    const mutationScopeKey = scopeKeyRef.current;
    setActionKey(key);
    setNotice(null);
    try {
      await action();
      if (mutationScopeKey === scopeKeyRef.current) {
        setNotice({ type: "success", text: successMessage });
        await load();
      }
      return true;
    } catch (error) {
      if (mutationScopeKey === scopeKeyRef.current)
        setNotice({ type: "error", text: (error as Error).message });
      return false;
    } finally {
      setActionKey("");
    }
  }
  async function createCategory() {
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
    setEditingCategory(item);
    setEditingCategoryName(item.title_name);
    setEditingCategoryDescription(item.title_desc);
  }
  async function saveCategory() {
    if (!editingCategory || !editingCategoryName.trim()) return;
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
    const prompts = promptText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!prompts.length) return;
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
    ...(scope.canDelete
      ? [
          {
            key: "selection",
            title: "选择",
            width: 72,
            render: (_: unknown, item: Prompt) => (
              <Checkbox
                aria-label={`选择问题 ${item.query_str}`}
                checked={selectedPromptIds.includes(item.id)}
                disabled={Boolean(actionKey)}
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
        scope.canWrite ? (
          <Select
            aria-label={`移动问题 ${item.query_str}`}
            disabled={Boolean(actionKey)}
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
    ...(scope.canWrite
      ? [
          {
            title: "操作",
            key: "actions",
            width: 190,
            render: (_: unknown, item: Prompt) => (
              <Space size={4} wrap>
                <Button
                  aria-label={`编辑问题 ${item.query_str}`}
                  disabled={Boolean(actionKey)}
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingPrompt(item);
                    setEditingPromptText(item.query_str);
                  }}
                  size="small"
                >
                  编辑
                </Button>
                <Button
                  aria-label={`${item.status === 1 ? "停用" : "启用"}问题 ${item.query_str}`}
                  disabled={Boolean(actionKey)}
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
                {scope.canDelete ? (
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
                      disabled={Boolean(actionKey)}
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
    : loading
      ? { status: "processing" as const, text: "正在刷新" }
      : syncError
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
            <Statistic title="问题分类" value={categories.length} />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic title="监控问题" suffix="条" value={total} />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="当前页已启用"
              suffix={`/ ${visiblePrompts.length}`}
              value={activePrompts}
            />
          </Card>
        </Col>
        <Col lg={6} xs={12}>
          <Card>
            <Statistic
              title="当前权限"
              value={
                scope.brand ? accessRoleLabel[scope.brand.accessRole] : "—"
              }
            />
          </Card>
        </Col>
      </Row>

      <Card
        extra={
          <Space wrap>
            <Badge
              status={monitoringStatus.status}
              text={monitoringStatus.text}
            />
            <Button
              disabled={!scope.brandId}
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void load({ announce: true })}
            >
              刷新数据
            </Button>
          </Space>
        }
        title={
          <Space>
            <CloudSyncOutlined />
            <span>持续检测控制台</span>
          </Space>
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
                allowClear
                allowEmpty={[true, true]}
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
              <Typography.Text type="secondary">搜索问题</Typography.Text>
              <Input.Search
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

      {syncError ? (
        <Alert
          action={
            <Button loading={loading} onClick={() => void load()}>
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
            <Tag>{total} 条</Tag>
            {scope.canWrite ? (
              <Button
                icon={<PlusOutlined />}
                onClick={() => setPromptCreateOpen(true)}
                disabled={!brandId}
              >
                新增问题
              </Button>
            ) : null}
          </Space>
        }
      >
        {scope.canDelete &&
        (visiblePromptIds.length || selectedPromptIds.length) ? (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Flex align="center" gap={12} justify="space-between" wrap>
              <Space size={12} wrap>
                <Checkbox
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
                    disabled={Boolean(actionKey)}
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
                    disabled={!selectedPromptIds.length || Boolean(actionKey)}
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
                  brandId
                    ? hasActiveFilters
                      ? "没有符合筛选条件的监控问题"
                      : "暂无监控问题，可在下方添加"
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
          scope.canWrite ? (
            <Button
              disabled={!brandId}
              icon={<PlusOutlined />}
              onClick={() => setCategoryCreateOpen(true)}
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
                    scope.canWrite
                      ? [
                          <Button
                            aria-label={`编辑分类 ${item.title_name}`}
                            disabled={Boolean(actionKey)}
                            icon={<EditOutlined />}
                            key="edit"
                            onClick={() => editCategory(item)}
                            size="small"
                            type="text"
                          >
                            编辑
                          </Button>,
                          ...(scope.canDelete
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
                                    disabled={Boolean(actionKey)}
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
            description="暂无问题分类"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Card>

      <Modal
        cancelText="取消"
        confirmLoading={actionKey === "category-create"}
        okButtonProps={{
          disabled: !categoryName.trim() || Boolean(actionKey),
        }}
        okText="创建分类"
        onCancel={() => setCategoryCreateOpen(false)}
        onOk={() => void createCategory()}
        open={categoryCreateOpen}
        title="新增问题分类"
        width={640}
      >
        <Form layout="vertical">
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
        cancelText="取消"
        confirmLoading={actionKey.startsWith("category-update-")}
        okButtonProps={{
          disabled: !editingCategoryName.trim() || Boolean(actionKey),
        }}
        okText="保存分类"
        onCancel={() => setEditingCategory(null)}
        onOk={() => void saveCategory()}
        open={Boolean(editingCategory)}
        title="编辑问题分类"
        width={640}
      >
        <Form layout="vertical">
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
        cancelText="取消"
        confirmLoading={actionKey === "prompt-create"}
        okButtonProps={{
          disabled: !promptTitleId || !promptText.trim() || Boolean(actionKey),
        }}
        okText="添加问题"
        onCancel={() => setPromptCreateOpen(false)}
        onOk={() => void createPrompts()}
        open={promptCreateOpen}
        title="新增监控问题"
        width={760}
      >
        <Form layout="vertical">
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
            extra="每行一个问题，支持批量创建。"
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
        cancelText="取消"
        confirmLoading={actionKey.startsWith("prompt-update-")}
        okButtonProps={{
          disabled: !editingPromptText.trim() || Boolean(actionKey),
        }}
        okText="保存问题"
        onCancel={() => setEditingPrompt(null)}
        onOk={() => void savePrompt()}
        open={Boolean(editingPrompt)}
        title="编辑监控问题"
        width={720}
      >
        <Form layout="vertical">
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
