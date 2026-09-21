"use client";

import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  DeleteOutlined,
  EditOutlined,
  LineChartOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Line } from "@ant-design/charts";
import {
  App,
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  theme,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { apiClient, getApiData } from "@/lib/http-client";
import { useThemeMode } from "../providers";
import {
  findModelUpstreamLabel,
  ModelLabel,
  modelSelectOptions,
} from "./model-display";
import {
  buildAverageRankTrendData,
  buildExposureTrendData,
  buildScoreTrendData,
  buildTaskCountTrendData,
  type OverviewTrendPoint,
} from "./overview-trend";
import {
  readStoredBrandId,
  readStoredOrganizationId,
  storeBrandId,
  storeOrganizationId,
} from "./scope-storage";

type Organization = {
  id: string;
  name: string;
  role: string | null;
  teamBindingId: string;
};
type Brand = {
  id: string;
  name: string;
  accessRole: "tenant_admin" | "brand_admin" | "brand_editor" | "brand_viewer";
};
type Competitor = { id: string; name: string; alias: string };
type Metric = { value: number; fluctuation: number };
type Metrics = { exposure: Metric; avg_rank: Metric; score: Metric };
type ExposureTrends = {
  brand_statistics: {
    date: string;
    name?: string;
    exposure: number;
    avg_rank: number;
    task_count: number;
  }[];
  competitor_statistics: {
    competitor_id: string;
    name: string;
    statistics: {
      date: string;
      exposure: number;
      avg_rank: number;
      task_count: number;
    }[];
  }[];
};
type ScoreTrends = {
  brand_statistics: {
    date: string;
    name?: string;
    score: number;
    task_count: number;
  }[];
  competitor_statistics: {
    competitor_id: string;
    name: string;
    statistics: {
      date: string;
      score: number;
      task_count: number;
    }[];
  }[];
};
type Rank = {
  competitor_id: string;
  competitor_name: string;
  exposure: number;
  fluctuation: number;
  avg_rank: Metric;
};
type ScoreRank = {
  competitor_id: string;
  competitor_name: string;
  score: number;
  fluctuation: number;
};
type OverviewTab = "trend" | "competition" | "actions";

const initialRange = (): [Dayjs, Dayjs] => [
  dayjs().subtract(29, "day"),
  dayjs(),
];
const rangePresets = [
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "近 90 天", days: 90 },
  { label: "近 180 天", days: 180 },
];
const qs = (input: Record<string, string>) =>
  new URLSearchParams(input).toString();
const format = (value?: number) =>
  value === undefined
    ? "—"
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(1);

function Trend({
  data,
  suffix,
  emptyDescription,
}: {
  data: OverviewTrendPoint[];
  suffix?: string;
  emptyDescription: string;
}) {
  const screens = Grid.useBreakpoint();
  const { mode } = useThemeMode();

  if (!data.length)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyDescription}
      />
    );
  return (
    <Line
      data={data}
      xField="date"
      yField="value"
      colorField="series"
      height={screens.md ? 250 : 220}
      shapeField="smooth"
      axis={{
        y: {
          labelFormatter: (value: number) => `${value}${suffix ?? ""}`,
        },
      }}
      style={{ lineWidth: 2.5 }}
      legend={{ color: { position: "top" } }}
      theme={mode === "dark" ? "classicDark" : "classic"}
    />
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Flex gap={2} vertical>
      <Typography.Text className="overview-section-title" strong>
        {title}
      </Typography.Text>
      {description ? (
        <Typography.Text
          className="overview-section-description"
          type="secondary"
        >
          {description}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}

function MetricTrend({
  metric,
  inverse = false,
}: {
  metric?: Metric;
  inverse?: boolean;
}) {
  if (!metric)
    return (
      <Typography.Text className="overview-metric-trend" type="secondary">
        等待数据
      </Typography.Text>
    );
  const neutral = metric.fluctuation === 0;
  const improved = inverse ? metric.fluctuation <= 0 : metric.fluctuation >= 0;
  const icon = neutral ? (
    <MinusOutlined />
  ) : metric.fluctuation > 0 ? (
    <ArrowUpOutlined />
  ) : (
    <ArrowDownOutlined />
  );
  return (
    <Typography.Text
      className="overview-metric-trend"
      type={neutral ? "secondary" : improved ? "success" : "danger"}
    >
      {icon} {Math.abs(metric.fluctuation).toFixed(1)}
      <span className="overview-metric-context"> 较上周期</span>
    </Typography.Text>
  );
}

function MetricBlock({
  title,
  metric,
  suffix,
  inverse,
}: {
  title: string;
  metric?: Metric;
  suffix?: string;
  inverse?: boolean;
}) {
  return (
    <div className="overview-metric-cell">
      <Typography.Text type="secondary">{title}</Typography.Text>
      <Statistic suffix={suffix} value={format(metric?.value)} />
      <MetricTrend inverse={inverse} metric={metric} />
    </div>
  );
}

export function OverviewClient({
  organizations,
}: {
  organizations: Organization[];
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const [range, setRange] = useState<[Dayjs, Dayjs]>(initialRange);
  const [organizationId, setOrganizationIdState] = useState(
    organizations[0]?.id ?? "",
  );
  const [brandId, setBrandId] = useState("");
  const [brandScopeKey, setBrandScopeKey] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trends, setTrends] = useState<ExposureTrends | null>(null);
  const [scoreTrends, setScoreTrends] = useState<ScoreTrends | null>(null);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [scoreRanks, setScoreRanks] = useState<ScoreRank[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<OverviewTab>("trend");
  const [competitorQuery, setCompetitorQuery] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [scopeRestored, setScopeRestored] = useState(false);
  const [form] = Form.useForm<{ name: string; alias: string }>();
  const scopeRequestIdRef = useRef(0);
  const analyticsRequestIdRef = useRef(0);

  const clearAnalytics = useCallback(() => {
    setCompetitors([]);
    setMetrics(null);
    setTrends(null);
    setScoreTrends(null);
    setRanks([]);
    setScoreRanks([]);
    setLastSyncedAt(null);
    setLoading(false);
  }, []);

  const selectOrganization = useCallback(
    (nextOrganizationId: string) => {
      scopeRequestIdRef.current += 1;
      analyticsRequestIdRef.current += 1;
      setOrganizationIdState(nextOrganizationId);
      setBrandId("");
      setBrandScopeKey("");
      setBrands([]);
      setSelectedPlatforms([]);
      setPlatforms({});
      setCompetitorQuery("");
      setEditorOpen(false);
      setEditing(null);
      clearAnalytics();
    },
    [clearAnalytics],
  );

  const selectBrand = useCallback(
    (nextBrandId: string) => {
      analyticsRequestIdRef.current += 1;
      setBrandId(nextBrandId);
      setCompetitorQuery("");
      setEditorOpen(false);
      setEditing(null);
      clearAnalytics();
    },
    [clearAnalytics],
  );

  const selectedOrganization = organizations.find(
    (item) => item.id === organizationId,
  );
  const teamId = selectedOrganization?.teamBindingId ?? "";
  const currentScopeKey =
    organizationId && teamId ? `${organizationId}:${teamId}` : "";
  const selectedBrand = brands.find((item) => item.id === brandId);
  const scopeReady = Boolean(
    selectedBrand && brandScopeKey === currentScopeKey,
  );
  const canEdit = Boolean(
    scopeReady && selectedBrand?.accessRole !== "brand_viewer",
  );
  const beginDate = range[0].format("YYYY-MM-DD");
  const endDate = range[1].format("YYYY-MM-DD");
  const rangeDays = range[1].diff(range[0], "day") + 1;

  useEffect(() => {
    const availableIds = organizations.map((item) => item.id);
    selectOrganization(
      readStoredOrganizationId(availableIds) || organizations[0]?.id || "",
    );
    setScopeRestored(true);
  }, [organizations, selectOrganization]);

  useEffect(() => {
    if (!scopeRestored || !organizationId) return;
    storeOrganizationId(organizationId);
  }, [organizationId, message, scopeRestored]);

  useEffect(() => {
    if (!scopeRestored || !teamId) return;
    const requestId = ++scopeRequestIdRef.current;
    setBrandId("");
    setBrandScopeKey("");
    setBrands([]);
    setPlatforms({});
    Promise.all([
      getApiData<Brand[]>(
        `/answerbit/brands?${qs({ organizationId, teamBindingId: teamId })}`,
      ),
      getApiData<Record<string, string>>(
        `/answerbit/dashboard/platforms?${qs({ organizationId, teamBindingId: teamId })}`,
      ),
    ])
      .then(([nextBrands, nextPlatforms]) => {
        if (scopeRequestIdRef.current !== requestId) return;
        setBrands(nextBrands);
        setBrandId(
          readStoredBrandId(
            organizationId,
            nextBrands.map((item) => item.id),
          ) ||
            nextBrands[0]?.id ||
            "",
        );
        setBrandScopeKey(currentScopeKey);
        setPlatforms(nextPlatforms);
      })
      .catch((error) => {
        if (scopeRequestIdRef.current === requestId)
          void message.error(error.message);
      });
    return () => {
      if (scopeRequestIdRef.current === requestId)
        scopeRequestIdRef.current += 1;
    };
  }, [currentScopeKey, organizationId, scopeRestored, teamId, message]);

  useEffect(() => {
    if (organizationId && brandId) storeBrandId(organizationId, brandId);
  }, [organizationId, brandId]);

  const loadAnalytics = useCallback(async () => {
    if (
      !brandId ||
      !teamId ||
      !scopeReady ||
      !brands.some((item) => item.id === brandId)
    )
      return;
    const requestId = ++analyticsRequestIdRef.current;
    setLoading(true);
    const common: Record<string, string> = {
      organizationId,
      teamBindingId: teamId,
      brandId,
      beginDate,
      endDate,
    };
    if (selectedPlatforms.length)
      common.platforms = selectedPlatforms.join(",");
    try {
      const nextCompetitors = await getApiData<Competitor[]>(
        `/answerbit/competitors?${qs({ organizationId, teamBindingId: teamId, brandId })}`,
      );
      if (analyticsRequestIdRef.current !== requestId) return;
      setCompetitors(nextCompetitors);
      const comparison = nextCompetitors.map((item) => item.id).join(",");
      const all = comparison
        ? { ...common, competitorIds: comparison }
        : common;
      const [
        nextMetrics,
        nextTrends,
        nextRanks,
        nextScoreTrends,
        nextScoreRanks,
      ] = await Promise.all([
        getApiData<Metrics>(`/answerbit/dashboard?${qs(common)}`),
        getApiData<ExposureTrends>(
          `/answerbit/dashboard/exposure-trends?${qs(all)}`,
        ),
        getApiData<Rank[]>(`/answerbit/dashboard/exposure-rank?${qs(all)}`),
        getApiData<ScoreTrends>(
          `/answerbit/dashboard/score-trends?${qs(all)}`,
        ).catch(() => null),
        getApiData<ScoreRank[]>(
          `/answerbit/dashboard/score-rank?${qs(all)}`,
        ).catch(() => []),
      ]);
      if (analyticsRequestIdRef.current !== requestId) return;
      setMetrics(nextMetrics);
      setTrends(nextTrends);
      setScoreTrends(nextScoreTrends);
      setRanks(nextRanks);
      setScoreRanks(nextScoreRanks);
      setLastSyncedAt(new Date());
    } catch (error) {
      if (analyticsRequestIdRef.current !== requestId) return;
      message.error(
        error instanceof Error ? error.message : "概览数据加载失败",
      );
      setMetrics(null);
      setTrends(null);
      setScoreTrends(null);
      setRanks([]);
      setScoreRanks([]);
    } finally {
      if (analyticsRequestIdRef.current === requestId) setLoading(false);
    }
  }, [
    organizationId,
    teamId,
    brandId,
    scopeReady,
    brands,
    beginDate,
    endDate,
    selectedPlatforms,
    message,
  ]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  function openEditor(item?: Competitor) {
    setEditing(item ?? null);
    setEditorOpen(true);
  }

  useEffect(() => {
    if (!editorOpen) return;
    form.setFieldsValue({
      name: editing?.name ?? "",
      alias: editing?.alias ?? "",
    });
  }, [editing, editorOpen, form]);

  async function saveCompetitor(values: { name: string; alias: string }) {
    const payload = {
      organizationId,
      teamBindingId: teamId,
      brandId,
      competitorName: values.name,
      competitorAlias: values.alias,
    };
    if (editing)
      await apiClient.patch(`/answerbit/competitors/${editing.id}`, payload);
    else await apiClient.post("/answerbit/competitors", payload);
    message.success(editing ? "竞品已更新" : "竞品已添加");
    setEditorOpen(false);
    form.resetFields();
    await loadAnalytics();
  }

  async function removeCompetitor(id: string) {
    await apiClient.delete(
      `/answerbit/competitors/${id}?${qs({ organizationId, teamBindingId: teamId, brandId })}`,
    );
    message.success("竞品已删除");
    await loadAnalytics();
  }

  const rankRows = [...ranks].sort((a, b) => b.exposure - a.exposure);
  const topRank = rankRows[0];
  const exposureTrendPoints = useMemo(
    () =>
      buildExposureTrendData(trends).map((point) => ({
        date: point.date,
        series: point.series,
        value: point.exposure,
      })),
    [trends],
  );
  const scoreTrendPoints = useMemo(
    () => buildScoreTrendData(scoreTrends),
    [scoreTrends],
  );
  const averageRankTrendPoints = useMemo(
    () => buildAverageRankTrendData(trends),
    [trends],
  );
  const taskCountTrendPoints = useMemo(
    () => buildTaskCountTrendData(trends),
    [trends],
  );
  const totalTaskCount =
    trends?.brand_statistics.reduce(
      (total, point) => total + point.task_count,
      0,
    ) ?? 0;
  const activeObservationDays =
    trends?.brand_statistics.filter((point) => point.task_count > 0).length ??
    0;
  const scoreRankById = new Map(
    scoreRanks.map((item) => [item.competitor_id, item]),
  );
  const modelScopeCount =
    selectedPlatforms.length || Object.keys(platforms).length;
  const filteredCompetitors = competitors.filter((item) => {
    const keyword = competitorQuery.trim().toLocaleLowerCase();
    return (
      !keyword ||
      item.name.toLocaleLowerCase().includes(keyword) ||
      item.alias.toLocaleLowerCase().includes(keyword)
    );
  });
  const analysisSignal = !metrics
    ? {
        color: "default",
        label: "等待数据",
        title: "选择品牌后生成行动建议",
        description: "系统会结合提及率、平均排名与曝光效果识别优先动作。",
      }
    : metrics.exposure.fluctuation < 0
      ? {
          color: "error",
          label: "优先处理",
          title: "品牌提及率较上周期回落",
          description: `下降 ${Math.abs(metrics.exposure.fluctuation).toFixed(1)}，建议先检查高价值问题的品牌覆盖。`,
        }
      : metrics.avg_rank.fluctuation > 0
        ? {
            color: "warning",
            label: "值得关注",
            title: "品牌平均排名出现下滑",
            description: `排名变化 ${metrics.avg_rank.fluctuation.toFixed(1)}，建议结合回答证据定位内容差距。`,
          }
        : {
            color: "success",
            label: "表现稳定",
            title: "当前品牌指标保持正向",
            description:
              "可以继续扩大优质问题覆盖，并将有效主题推进到内容生成。",
          };

  return (
    <div
      className="overview-page"
      style={
        { "--overview-border": token.colorBorderSecondary } as CSSProperties
      }
    >
      <Card className="overview-metric-strip" styles={{ body: { padding: 0 } }}>
        <div className="overview-metric-grid">
          <MetricBlock
            metric={metrics?.exposure}
            suffix="%"
            title="品牌提及率"
          />
          <MetricBlock inverse metric={metrics?.avg_rank} title="平均排名" />
          <MetricBlock metric={metrics?.score} title="曝光效果" />
        </div>
      </Card>

      <Card
        className="overview-scope-card"
        styles={{ body: { padding: compact ? 16 : 20 } }}
      >
        <div className="overview-scope-layout">
          <div className="overview-scope-copy">
            <Space size={8}>
              <Typography.Text className="overview-scope-title" strong>
                自动侦察范围
              </Typography.Text>
              <Badge status="processing" text="自动分析" />
            </Space>
            <Typography.Text type="secondary">
              默认读取当前品牌与近 30 天，调整范围后自动重算
            </Typography.Text>
          </div>
          <div className="overview-filter-grid">
            <label className="overview-filter-field overview-platform-field">
              <Typography.Text type="secondary">企业</Typography.Text>
              <Select
                aria-label="企业"
                value={organizationId}
                onChange={selectOrganization}
                options={organizations.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                popupMatchSelectWidth={false}
                style={{ width: "100%" }}
              />
            </label>
            <label className="overview-filter-field">
              <Typography.Text type="secondary">品牌</Typography.Text>
              <Select
                aria-label="品牌"
                value={brandId || undefined}
                placeholder="选择品牌"
                onChange={selectBrand}
                options={brands.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                popupMatchSelectWidth={false}
                style={{ width: "100%" }}
              />
            </label>
            <label className="overview-filter-field">
              <Typography.Text type="secondary">模型</Typography.Text>
              <Select
                aria-label="模型"
                value={selectedPlatforms}
                allowClear
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
                placeholder="全部模型"
                onChange={setSelectedPlatforms}
                optionFilterProp="searchText"
                options={modelSelectOptions(platforms)}
                popupMatchSelectWidth={false}
                showSearch
                style={{ width: "100%" }}
              />
            </label>
            <label className="overview-filter-field overview-date-field">
              <Typography.Text type="secondary">统计周期</Typography.Text>
              <DatePicker.RangePicker
                value={range}
                onChange={(value) =>
                  value?.[0] && value?.[1] && setRange([value[0], value[1]])
                }
                presets={rangePresets.map(({ label, days }) => ({
                  label,
                  value: [dayjs().subtract(days - 1, "day"), dayjs()],
                }))}
                disabledDate={(current) => current.isAfter(dayjs(), "day")}
                format="YYYY-MM-DD"
                placeholder={["开始日期", "结束日期"]}
                allowClear={false}
                style={{ width: "100%" }}
              />
            </label>
            <Button
              className="overview-refresh-button"
              icon={<ReloadOutlined />}
              loading={loading}
              disabled={!scopeReady}
              onClick={() => void loadAnalytics()}
            >
              重新查询
            </Button>
          </div>
        </div>
      </Card>

      <Card
        className="overview-panel overview-workspace-card"
        styles={{ body: { padding: 0 } }}
      >
        <Tabs
          activeKey={activeTab}
          animated={{ inkBar: true, tabPane: false }}
          className="overview-tabs"
          onChange={(key) => setActiveTab(key as OverviewTab)}
          tabBarGutter={compact ? 20 : 32}
          tabBarStyle={{
            margin: 0,
            paddingInline: compact ? 12 : 20,
          }}
          tabBarExtraContent={
            <Typography.Text className="overview-sync-time" type="secondary">
              {lastSyncedAt
                ? `更新于 ${lastSyncedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                : "尚未查询"}
            </Typography.Text>
          }
          items={[
            {
              key: "trend",
              label: (
                <Space size={8}>
                  <LineChartOutlined />
                  趋势洞察
                </Space>
              ),
              children: (
                <div className="overview-tab-panel overview-recon-workspace">
                  <div className="overview-recon-intro">
                    <SectionTitle
                      description="系统按当前范围自动读取多组指标，不需要先提交筛选条件"
                      title="数据侦察"
                    />
                    <Space size={[6, 6]} wrap>
                      <Tag>{selectedBrand?.name || "等待品牌"}</Tag>
                      <Tag>{rangeDays} 天窗口</Tag>
                      <Tag>
                        {selectedPlatforms.length
                          ? `${selectedPlatforms.length} 个指定模型`
                          : `全部 ${modelScopeCount} 个模型`}
                      </Tag>
                    </Space>
                  </div>

                  <div className="overview-recon-summary">
                    <div>
                      <Typography.Text type="secondary">
                        侦察任务样本
                      </Typography.Text>
                      <Typography.Text strong>
                        {totalTaskCount.toLocaleString()}
                      </Typography.Text>
                      <small>当前品牌累计监测任务</small>
                    </div>
                    <div>
                      <Typography.Text type="secondary">
                        有效监测天数
                      </Typography.Text>
                      <Typography.Text strong>
                        {activeObservationDays}/{rangeDays}
                      </Typography.Text>
                      <small>有任务数据的日期覆盖</small>
                    </div>
                    <div>
                      <Typography.Text type="secondary">
                        竞争观察对象
                      </Typography.Text>
                      <Typography.Text strong>
                        {competitors.length}
                      </Typography.Text>
                      <small>自动加入趋势和位次对比</small>
                    </div>
                    <div>
                      <Typography.Text type="secondary">
                        模型侦察范围
                      </Typography.Text>
                      <Typography.Text strong>
                        {modelScopeCount}
                      </Typography.Text>
                      <small>
                        {selectedPlatforms.length
                          ? "当前指定模型"
                          : "全部可用模型"}
                      </small>
                    </div>
                  </div>

                  <div className="overview-insight-grid">
                    <Card
                      className="overview-inner-card overview-card-wide"
                      styles={{ body: { padding: compact ? 12 : 20 } }}
                      title={
                        <SectionTitle
                          description={`品牌与竞品的提及率变化 · ${beginDate} 至 ${endDate}`}
                          title="提及率走势"
                        />
                      }
                    >
                      <Trend
                        data={exposureTrendPoints}
                        emptyDescription="暂无提及率趋势数据"
                        suffix="%"
                      />
                    </Card>

                    <Card
                      className="overview-inner-card"
                      styles={{ body: { padding: compact ? 12 : 20 } }}
                      title={
                        <SectionTitle
                          description="综合衡量回答表现与品牌可见度"
                          title="曝光效果走势"
                        />
                      }
                    >
                      <Trend
                        data={scoreTrendPoints}
                        emptyDescription="暂无曝光效果趋势数据"
                      />
                    </Card>

                    <Card
                      className="overview-inner-card"
                      styles={{ body: { padding: compact ? 12 : 20 } }}
                      title={
                        <SectionTitle
                          description="数值越低代表平均出现位置越靠前"
                          title="平均排名走势"
                        />
                      }
                    >
                      <Trend
                        data={averageRankTrendPoints}
                        emptyDescription="暂无平均排名趋势数据"
                      />
                    </Card>

                    <Card
                      className="overview-inner-card"
                      styles={{ body: { padding: compact ? 12 : 20 } }}
                      title={
                        <SectionTitle
                          description="每日任务量用于判断趋势样本是否充分"
                          title="监测任务量"
                        />
                      }
                    >
                      <Trend
                        data={taskCountTrendPoints}
                        emptyDescription="暂无任务量数据"
                      />
                    </Card>

                    <Card
                      className="overview-inner-card"
                      styles={{ body: { padding: compact ? 12 : 20 } }}
                      title={
                        <SectionTitle
                          description="同时比较提及率、排名与曝光效果"
                          title="竞争位次"
                        />
                      }
                    >
                      <div className="overview-rank-summary">
                        <div>
                          <Typography.Text type="secondary">
                            对比对象
                          </Typography.Text>
                          <Typography.Text strong>
                            {rankRows.length}
                          </Typography.Text>
                        </div>
                        <div>
                          <Typography.Text type="secondary">
                            最高提及率
                          </Typography.Text>
                          <Typography.Text strong>
                            {topRank ? `${topRank.exposure.toFixed(1)}%` : "—"}
                          </Typography.Text>
                        </div>
                      </div>
                      <Table<Rank>
                        key={`rank-${organizationId}-${brandId}`}
                        columns={[
                          {
                            title: "品牌",
                            dataIndex: "competitor_name",
                            ellipsis: true,
                          },
                          {
                            title: "提及率",
                            dataIndex: "exposure",
                            align: "right",
                            width: 82,
                            sorter: (a, b) => a.exposure - b.exposure,
                            render: (value: number) => (
                              <Typography.Text strong>
                                {value.toFixed(1)}%
                              </Typography.Text>
                            ),
                          },
                          {
                            title: "排名",
                            dataIndex: ["avg_rank", "value"],
                            align: "right",
                            responsive: ["sm" as const],
                            width: 70,
                            sorter: (a, b) =>
                              a.avg_rank.value - b.avg_rank.value,
                            render: (value: number) => value.toFixed(1),
                          },
                          {
                            title: "效果",
                            align: "right",
                            responsive: ["md" as const],
                            width: 72,
                            render: (_: unknown, row: Rank) => {
                              const score = scoreRankById.get(
                                row.competitor_id,
                              );
                              return score ? score.score.toFixed(1) : "—";
                            },
                          },
                        ]}
                        dataSource={rankRows}
                        loading={loading}
                        locale={{
                          emptyText: (
                            <Empty
                              description="暂无排行数据"
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                            />
                          ),
                        }}
                        pagination={{
                          defaultPageSize: 5,
                          hideOnSinglePage: rankRows.length <= 5,
                          showSizeChanger: false,
                        }}
                        rowKey="competitor_id"
                        size="small"
                        tableLayout="fixed"
                      />
                    </Card>
                  </div>
                </div>
              ),
            },
            {
              key: "competition",
              label: (
                <Space size={8}>
                  <AimOutlined />
                  竞品管理
                  <Badge
                    count={competitors.length}
                    overflowCount={99}
                    showZero
                    size="small"
                  />
                </Space>
              ),
              children: (
                <div className="overview-tab-panel">
                  <div className="overview-table-toolbar">
                    <SectionTitle
                      description="维护用于趋势和排名对比的品牌对象"
                      title="竞品目录"
                    />
                    <Space wrap>
                      <Input
                        allowClear
                        aria-label="搜索竞品"
                        className="overview-competitor-search"
                        onChange={(event) =>
                          setCompetitorQuery(event.target.value)
                        }
                        placeholder="搜索名称或别名"
                        prefix={<SearchOutlined />}
                        value={competitorQuery}
                      />
                      {canEdit ? (
                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => openEditor()}
                          type="primary"
                        >
                          添加竞品
                        </Button>
                      ) : null}
                    </Space>
                  </div>
                  <Table<Competitor>
                    key={`competitors-${organizationId}-${brandId}-${competitorQuery}`}
                    dataSource={filteredCompetitors}
                    loading={loading}
                    pagination={{
                      defaultPageSize: 10,
                      pageSizeOptions: [5, 10, 20],
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 个竞品`,
                    }}
                    rowKey="id"
                    tableLayout="fixed"
                    columns={[
                      {
                        title: "竞品名称",
                        dataIndex: "name",
                        ellipsis: true,
                        sorter: (a, b) => a.name.localeCompare(b.name, "zh-CN"),
                        render: (value: string) => (
                          <Typography.Text strong>{value}</Typography.Text>
                        ),
                      },
                      {
                        title: "别名",
                        dataIndex: "alias",
                        responsive: ["md" as const],
                        render: (value: string) =>
                          value ? (
                            <Tag>{value}</Tag>
                          ) : (
                            <Typography.Text type="secondary">
                              未设置
                            </Typography.Text>
                          ),
                      },
                      ...(canEdit
                        ? [
                            {
                              title: "操作",
                              width: compact ? 112 : 184,
                              align: "right" as const,
                              render: (_value: unknown, row: Competitor) => (
                                <Space size={4}>
                                  <Button
                                    aria-label={`编辑${row.name}`}
                                    icon={<EditOutlined />}
                                    onClick={() => openEditor(row)}
                                    size="small"
                                    type="text"
                                  >
                                    {compact ? null : "编辑"}
                                  </Button>
                                  <Popconfirm
                                    cancelText="取消"
                                    description="该操作会更新 AnswerBit 中的竞品数据"
                                    okButtonProps={{ danger: true }}
                                    okText="删除"
                                    onConfirm={() => removeCompetitor(row.id)}
                                    title="删除这个竞品？"
                                  >
                                    <Button
                                      aria-label={`删除${row.name}`}
                                      danger
                                      icon={<DeleteOutlined />}
                                      size="small"
                                      type="text"
                                    >
                                      {compact ? null : "删除"}
                                    </Button>
                                  </Popconfirm>
                                </Space>
                              ),
                            },
                          ]
                        : []),
                    ]}
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            competitorQuery
                              ? "没有匹配的竞品"
                              : "还没有添加竞品"
                          }
                        />
                      ),
                    }}
                  />
                </div>
              ),
            },
            {
              key: "actions",
              label: (
                <Space size={8}>
                  <ThunderboltOutlined />
                  增长行动
                </Space>
              ),
              children: (
                <div className="overview-tab-panel overview-actions-panel">
                  <div className="overview-signal-card">
                    <div className="overview-signal-icon">
                      <BulbOutlined />
                    </div>
                    <div>
                      <Tag color={analysisSignal.color}>
                        {analysisSignal.label}
                      </Tag>
                      <Typography.Title level={2}>
                        {analysisSignal.title}
                      </Typography.Title>
                      <Typography.Paragraph type="secondary">
                        {analysisSignal.description}
                      </Typography.Paragraph>
                    </div>
                  </div>
                  <div className="overview-action-grid">
                    <div className="overview-action-row">
                      <span>01</span>
                      <div>
                        <Typography.Text strong>检查高价值问题</Typography.Text>
                        <Typography.Text type="secondary">
                          定位品牌缺席或排名下降的主题
                        </Typography.Text>
                      </div>
                      <Button href="/dashboard/monitoring">查看问题</Button>
                    </div>
                    <div className="overview-action-row">
                      <span>02</span>
                      <div>
                        <Typography.Text strong>核对回答证据</Typography.Text>
                        <Typography.Text type="secondary">
                          对比模型回答、引用域名与文章来源
                        </Typography.Text>
                      </div>
                      <Button href="/dashboard/answers">查看证据</Button>
                    </div>
                    <div className="overview-action-row">
                      <span>03</span>
                      <div>
                        <Typography.Text strong>推进内容生产</Typography.Text>
                        <Typography.Text type="secondary">
                          把已确认机会转成可审核的内容任务
                        </Typography.Text>
                      </div>
                      <Button
                        href="/dashboard/content?stage=generate"
                        type="primary"
                      >
                        生成内容
                      </Button>
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? "编辑竞品" : "添加竞品"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => form.submit()}
        okText={editing ? "保存" : "添加"}
        cancelText="取消"
        width={720}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={saveCompetitor}
          requiredMark={false}
          size="large"
        >
          <Form.Item
            label="竞品名称"
            name="name"
            rules={[{ required: true, message: "请输入竞品名称" }]}
          >
            <Input maxLength={255} placeholder="例如：竞品品牌名称" />
          </Form.Item>
          <Form.Item label="竞品别名" name="alias">
            <Input maxLength={255} placeholder="可选，用于匹配品牌称呼" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
