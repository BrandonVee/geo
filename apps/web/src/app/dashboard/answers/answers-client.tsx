"use client";
import {
  DownloadOutlined,
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
  Modal,
  Pagination,
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
import { useCallback, useEffect, useMemo, useState } from "react";
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
type ExportJob = {
  id: string;
  reportType: string;
  status: string;
  filename: string | null;
  rowCount: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
};
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
}: {
  organizations: ScopeOrganization[];
}) {
  const scope = useAnswerBitScope(organizations);
  const initial = useMemo(() => dates(), []);
  const [beginDate, setBeginDate] = useState(initial.begin);
  const [endDate, setEndDate] = useState(initial.end);
  const [keyword, setKeyword] = useState("");
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
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [toolBusy, setToolBusy] = useState("");
  const [pendingBrand, setPendingBrand] = useState("");
  const [viewOpen, setViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  useEffect(() => {
    setSelectedPlatforms([]);
    setPlatforms({});
    if (!scope.teamBindingId) return;
    fetch(
      `/api/v1/answerbit/dashboard/platforms?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId })}`,
    )
      .then((response) => response.json())
      .then((body) => setPlatforms(body.data ?? {}))
      .catch(() => setPlatforms({}));
  }, [scope.organizationId, scope.teamBindingId]);
  const accessRole = scope.brand?.accessRole ?? "";
  const loadTools = useCallback(async () => {
    if (!scope.organizationId) return;
    try {
      const viewResponse = await fetch(
        `/api/v1/saved-views?${scopeQuery({ organizationId: scope.organizationId, page: "answers" })}`,
      );
      const viewBody = await viewResponse.json();
      if (viewResponse.ok) setViews(viewBody.data ?? []);
      if (
        scope.teamBindingId &&
        scope.brandId &&
        ["tenant_admin", "brand_admin"].includes(accessRole)
      ) {
        const exportResponse = await fetch(
          `/api/v1/report-exports?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId, brandId: scope.brandId, page: "1", pageSize: "20" })}`,
        );
        const exportBody = await exportResponse.json();
        if (exportResponse.ok) setExports(exportBody.data.list ?? []);
      } else setExports([]);
    } catch {}
  }, [scope.organizationId, scope.teamBindingId, scope.brandId, accessRole]);
  const scopeBrands = scope.brands;
  const setScopeBrandId = scope.setBrandId;
  useEffect(() => {
    void loadTools();
  }, [loadTools]);
  useEffect(() => {
    if (!exports.some((job) => ["queued", "running"].includes(job.status)))
      return;
    const timer = window.setInterval(() => void loadTools(), 3000);
    return () => window.clearInterval(timer);
  }, [exports, loadTools]);
  useEffect(() => {
    if (pendingBrand && scopeBrands.some((item) => item.id === pendingBrand)) {
      setScopeBrandId(pendingBrand);
      setPendingBrand("");
    }
  }, [pendingBrand, scopeBrands, setScopeBrandId]);
  const load = useCallback(async () => {
    if (!scope.brandId) return;
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
    try {
      const [taskResponse, domainResponse, articleResponse] = await Promise.all(
        [
          fetch(
            `/api/v1/answerbit/answers?${scopeQuery({ ...base, mentionBrand, ...(keyword ? { prompt: keyword } : {}) })}`,
          ),
          fetch(
            `/api/v1/answerbit/citations/domains?${scopeQuery({ ...base, ...(keyword ? { keyword } : {}) })}`,
          ),
          fetch(
            `/api/v1/answerbit/citations/articles?${scopeQuery({ ...base, ...(keyword ? { keyword } : {}) })}`,
          ),
        ],
      );
      const [taskBody, domainBody, articleBody] = await Promise.all([
        taskResponse.json(),
        domainResponse.json(),
        articleResponse.json(),
      ]);
      if (!taskResponse.ok) throw new Error(taskBody.error?.message);
      setTasks(taskBody.data.scores);
      setTotal(taskBody.data.total);
      setDomains(domainResponse.ok ? domainBody.data.reference_count : []);
      setArticles(articleResponse.ok ? articleBody.data.reference_count : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回答记录加载失败");
    } finally {
      setLoading(false);
    }
  }, [
    scope.organizationId,
    scope.teamBindingId,
    scope.brandId,
    beginDate,
    endDate,
    page,
    selectedPlatforms,
    keyword,
    mentionBrand,
  ]);
  useEffect(() => {
    void load();
  }, [load]);
  async function openDetail(taskId: string) {
    const response = await fetch(
      `/api/v1/answerbit/answers/${taskId}?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId, brandId: scope.brandId })}`,
    );
    const body = await response.json();
    if (!response.ok) return setMessage(body.error?.message ?? "详情加载失败");
    setDetail(body.data);
  }
  async function saveView() {
    const name = viewName.trim();
    if (!name) return;
    setToolBusy("view");
    try {
      const response = await fetch("/api/v1/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          name,
          page: "answers",
          filters: {
            brandId: scope.brandId,
            beginDate,
            endDate,
            platforms: selectedPlatforms,
            keyword,
            mentionBrand,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message);
      setViewName("");
      setViewOpen(false);
      await loadTools();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视图保存失败");
    } finally {
      setToolBusy("");
    }
  }
  function applyView(view: SavedView) {
    const filter = view.filters;
    if (typeof filter.brandId === "string") setPendingBrand(filter.brandId);
    if (typeof filter.beginDate === "string") setBeginDate(filter.beginDate);
    if (typeof filter.endDate === "string") setEndDate(filter.endDate);
    if (Array.isArray(filter.platforms))
      setSelectedPlatforms(
        filter.platforms.filter(
          (value): value is string => typeof value === "string",
        ),
      );
    else if (typeof filter.platform === "string")
      setSelectedPlatforms([filter.platform]);
    if (typeof filter.keyword === "string") setKeyword(filter.keyword);
    if (typeof filter.mentionBrand === "string")
      setMentionBrand(filter.mentionBrand);
    setPage(1);
  }
  async function createExport(
    reportType: "answers" | "domain_rank" | "article_rank",
  ) {
    setToolBusy(reportType);
    try {
      const response = await fetch("/api/v1/report-exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `report-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
          reportType,
          beginDate,
          endDate,
          titleIds: [],
          promptIds: [],
          platforms: selectedPlatforms,
          tagIds: [],
          ...(keyword ? { keyword } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message);
      setMessage("导出任务已提交，文件生成后将在下方显示下载入口");
      await loadTools();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出任务创建失败");
    } finally {
      setToolBusy("");
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
            disabled={!scope.brandId}
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
              allowClear={false}
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

      <Card title="视图与导出">
        <Flex gap={16} justify="space-between" wrap>
          <Space size={[8, 8]} wrap>
            <Button
              icon={<SaveOutlined />}
              loading={toolBusy === "view"}
              onClick={() => setViewOpen(true)}
            >
              保存当前条件
            </Button>
            {views.map((view) => (
              <Button
                key={view.id}
                onClick={() => applyView(view)}
                type={view.isDefault ? "primary" : "default"}
              >
                {view.name}
              </Button>
            ))}
          </Space>
          {["tenant_admin", "brand_admin"].includes(
            scope.brand?.accessRole ?? "",
          ) ? (
            <Space size={[8, 8]} wrap>
              <Button
                loading={toolBusy === "answers"}
                onClick={() => void createExport("answers")}
              >
                回答 CSV
              </Button>
              <Button
                loading={toolBusy === "domain_rank"}
                onClick={() => void createExport("domain_rank")}
              >
                域名 CSV
              </Button>
              <Button
                loading={toolBusy === "article_rank"}
                onClick={() => void createExport("article_rank")}
              >
                文章 CSV
              </Button>
            </Space>
          ) : null}
        </Flex>
        {exports.length ? (
          <List
            dataSource={exports.slice(0, 3)}
            header={<Typography.Text strong>最近导出</Typography.Text>}
            renderItem={(job) => (
              <List.Item
                actions={
                  job.downloadUrl
                    ? [
                        <Button
                          href={job.downloadUrl}
                          icon={<DownloadOutlined />}
                          key="download"
                          size="small"
                        >
                          下载
                        </Button>,
                      ]
                    : undefined
                }
              >
                <List.Item.Meta
                  description={
                    job.rowCount === null ? "正在生成" : job.rowCount + " 行"
                  }
                  title={job.filename ?? job.reportType}
                />
                <Tag
                  color={job.status === "completed" ? "success" : "processing"}
                >
                  {job.status}
                </Tag>
              </List.Item>
            )}
            size="small"
          />
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
        okButtonProps={{ disabled: !viewName.trim() }}
        okText="保存"
        onCancel={() => setViewOpen(false)}
        onOk={() => void saveView()}
        open={viewOpen}
        title="保存筛选视图"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          保存当前企业、品牌、日期和筛选条件。
        </Typography.Paragraph>
        <Input
          autoFocus
          maxLength={80}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="视图名称"
          value={viewName}
        />
      </Modal>

      <Drawer
        onClose={() => setDetail(null)}
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
