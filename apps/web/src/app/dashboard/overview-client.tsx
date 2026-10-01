"use client";

import {
  AimOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  LineChartOutlined,
  MinusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Line } from "@ant-design/charts";
import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Grid,
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
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getApiData } from "@/lib/http-client";
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
  selectScopeId,
  readStoredBrandId,
  readStoredOrganizationId,
  storeBrandId,
  storeOrganizationId,
} from "./scope-storage";

import { CompetitorDirectory, type Competitor } from "./competitor-directory";
import { useDirectoryRead } from "./directory-read";
import { useWorkspaceAccess, workspacePermission } from "./workspace-access";

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
      height={screens.md ? 220 : 196}
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
    <Flex className="overview-section-heading" gap={2} vertical>
      <Typography.Text className="overview-section-title" strong title={title}>
        {title}
      </Typography.Text>
      {description ? (
        <Typography.Text
          className="overview-section-description"
          title={description}
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
  userId,
}: {
  organizations: Organization[];
  userId: string;
}) {
  const { token } = theme.useToken();
  const searchParams = useSearchParams();
  const requestedOrganizationId = searchParams.get("organizationId");
  const requestedBrandId = searchParams.get("brandId");
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const [range, setRange] = useState<[Dayjs, Dayjs]>(initialRange);
  const [organizationId, setOrganizationIdState] = useState(
    organizations[0]?.id ?? "",
  );
  const organizationIdRef = useRef(organizations[0]?.id ?? "");
  const [brandId, setBrandId] = useState("");
  const [brandScopeKey, setBrandScopeKey] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trends, setTrends] = useState<ExposureTrends | null>(null);
  const [scoreTrends, setScoreTrends] = useState<ScoreTrends | null>(null);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [scoreRanks, setScoreRanks] = useState<ScoreRank[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [activeTab, setActiveTab] = useState<OverviewTab>("trend");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [scopeRestored, setScopeRestored] = useState(false);
  const analyticsRequestIdRef = useRef(0);
  const analyticsSnapshotRef = useRef("");

  const clearAnalytics = useCallback(() => {
    setMetrics(null);
    setTrends(null);
    setScoreTrends(null);
    setRanks([]);
    setScoreRanks([]);
    setLastSyncedAt(null);
    setLoading(false);
    setAnalyticsError("");
    analyticsSnapshotRef.current = "";
  }, []);

  const selectOrganization = useCallback(
    (nextOrganizationId: string) => {
      if (organizationIdRef.current === nextOrganizationId) return;
      organizationIdRef.current = nextOrganizationId;
      const url = new URL(window.location.href);
      if (url.searchParams.get("organizationId") !== nextOrganizationId)
        url.searchParams.delete("brandId");
      url.searchParams.set("organizationId", nextOrganizationId);
      window.history.replaceState(window.history.state, "", url);
      analyticsRequestIdRef.current += 1;
      setOrganizationIdState(nextOrganizationId);
      setBrandId("");
      setBrandScopeKey("");
      setBrands([]);
      setSelectedPlatforms([]);
      setPlatforms({});
      clearAnalytics();
    },
    [clearAnalytics],
  );

  const selectBrand = useCallback(
    (nextBrandId: string) => {
      analyticsRequestIdRef.current += 1;
      setBrandId(nextBrandId);
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
  const access = useWorkspaceAccess();
  const workspace = access.organizations.find(
    (item) => item.id === organizationId,
  );
  const competitorRead = useDirectoryRead<Competitor[]>(
    scopeReady
      ? `/api/v1/answerbit/competitors?${qs({ organizationId, teamBindingId: teamId, brandId })}`
      : null,
  );
  const competitors = competitorRead.data ?? [];
  const competitorIds = competitors.map((item) => item.id).join(",");
  const [analysisRefresh, setAnalysisRefresh] = useState(0);
  const beginDate = range[0].format("YYYY-MM-DD");
  const endDate = range[1].format("YYYY-MM-DD");
  const rangeDays = range[1].diff(range[0], "day") + 1;

  useEffect(() => {
    const availableIds = organizations.map((item) => item.id);
    selectOrganization(
      selectScopeId(
        requestedOrganizationId,
        readStoredOrganizationId(availableIds),
        availableIds,
      ),
    );
    setScopeRestored(true);
  }, [organizations, requestedOrganizationId, selectOrganization]);

  useEffect(() => {
    if (!scopeRestored || !organizationId) return;
    storeOrganizationId(organizationId);
  }, [organizationId, scopeRestored]);

  const brandRead = useDirectoryRead<Brand[]>(
    scopeRestored && teamId
      ? `/api/v1/answerbit/brands?${qs({ organizationId, teamBindingId: teamId })}`
      : null,
  );
  const platformRead = useDirectoryRead<Record<string, string>>(
    scopeRestored && teamId
      ? `/api/v1/answerbit/dashboard/platforms?${qs({ organizationId, teamBindingId: teamId })}`
      : null,
  );
  useEffect(() => {
    if (!brandRead.data) return;
    const nextBrands = brandRead.data;
    setBrands(nextBrands);
    setBrandId((current) =>
      selectScopeId(
        requestedBrandId,
        nextBrands.some((item) => item.id === current)
          ? current
          : readStoredBrandId(
              organizationId,
              nextBrands.map((item) => item.id),
            ),
        nextBrands.map((item) => item.id),
      ),
    );
    setBrandScopeKey(currentScopeKey);
  }, [brandRead.data, currentScopeKey, organizationId, requestedBrandId]);
  useEffect(() => {
    setPlatforms(platformRead.data ?? {});
  }, [platformRead.data]);

  useEffect(() => {
    if (organizationId && brandId && scopeReady) {
      storeBrandId(organizationId, brandId);
      const url = new URL(window.location.href);
      if (
        url.searchParams.get("organizationId") !== organizationId ||
        url.searchParams.get("brandId") !== brandId
      ) {
        url.searchParams.set("organizationId", organizationId);
        url.searchParams.set("brandId", brandId);
        window.history.replaceState(window.history.state, "", url);
      }
    }
  }, [organizationId, brandId, scopeReady]);

  const analyticsInput = JSON.stringify(
    scopeReady && brands.some((item) => item.id === brandId)
      ? {
          organizationId,
          teamId,
          brandId,
          beginDate,
          endDate,
          selectedPlatforms,
          competitorIds,
          directoryReady: Boolean(competitorRead.data || competitorRead.error),
          directoryVersion: competitorRead.successVersion,
        }
      : null,
  );
  const loadAnalytics = useCallback(async () => {
    const input = JSON.parse(analyticsInput) as {
      organizationId: string;
      teamId: string;
      brandId: string;
      beginDate: string;
      endDate: string;
      selectedPlatforms: string[];
      competitorIds: string;
      directoryReady: boolean;
    } | null;
    if (!input?.directoryReady) return;
    const {
      organizationId,
      teamId,
      brandId,
      beginDate,
      endDate,
      selectedPlatforms,
      competitorIds,
    } = input;
    const requestId = ++analyticsRequestIdRef.current;
    const snapshot = JSON.stringify([
      organizationId,
      teamId,
      brandId,
      beginDate,
      endDate,
      selectedPlatforms,
      competitorIds,
    ]);
    if (analyticsSnapshotRef.current !== snapshot) {
      clearAnalytics();
      analyticsSnapshotRef.current = snapshot;
    }
    setLoading(true);
    setAnalyticsError("");
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
      const ids = competitorIds ? competitorIds.split(",") : [];
      const batches: string[][] = [];
      for (let offset = 0; offset < ids.length; offset += 100)
        batches.push(ids.slice(offset, offset + 100));
      if (!batches.length) batches.push([]);
      const comparisons = batches.map((items) =>
        items.length ? { ...common, competitorIds: items.join(",") } : common,
      );
      const readComparisons = <T,>(path: string) =>
        Promise.all(
          comparisons.map((query) => getApiData<T>(`${path}?${qs(query)}`)),
        );
      const [
        nextMetrics,
        nextTrends,
        nextRanks,
        nextScoreTrends,
        nextScoreRanks,
      ] = await Promise.allSettled([
        getApiData<Metrics>(`/answerbit/dashboard?${qs(common)}`),
        readComparisons<ExposureTrends>(
          "/answerbit/dashboard/exposure-trends",
        ).then((rows) => ({
          ...rows[0],
          competitor_statistics: rows.flatMap(
            (row) => row.competitor_statistics,
          ),
        })),
        readComparisons<Rank[]>("/answerbit/dashboard/exposure-rank").then(
          (rows) => [
            ...new Map(
              rows.flat().map((row) => [row.competitor_id, row]),
            ).values(),
          ],
        ),
        readComparisons<ScoreTrends>("/answerbit/dashboard/score-trends").then(
          (rows) => ({
            ...rows[0],
            competitor_statistics: rows.flatMap(
              (row) => row.competitor_statistics,
            ),
          }),
        ),
        readComparisons<ScoreRank[]>("/answerbit/dashboard/score-rank").then(
          (rows) => [
            ...new Map(
              rows.flat().map((row) => [row.competitor_id, row]),
            ).values(),
          ],
        ),
      ]);
      if (analyticsRequestIdRef.current !== requestId) return;
      setMetrics(nextMetrics.status === "fulfilled" ? nextMetrics.value : null);
      setTrends(nextTrends.status === "fulfilled" ? nextTrends.value : null);
      setScoreTrends(
        nextScoreTrends.status === "fulfilled" ? nextScoreTrends.value : null,
      );
      setRanks(nextRanks.status === "fulfilled" ? nextRanks.value : []);
      setScoreRanks(
        nextScoreRanks.status === "fulfilled" ? nextScoreRanks.value : [],
      );
      const outcomes = [
        nextMetrics,
        nextTrends,
        nextRanks,
        nextScoreTrends,
        nextScoreRanks,
      ];
      const labels = [
        "核心指标",
        "曝光趋势",
        "曝光排行",
        "得分趋势",
        "得分排行",
      ];
      setAnalyticsError(
        outcomes
          .flatMap((outcome, index) =>
            outcome.status === "rejected"
              ? [
                  `${labels[index]}：${outcome.reason instanceof Error ? outcome.reason.message : "请求失败"}`,
                ]
              : [],
          )
          .join("；"),
      );
      setLastSyncedAt(
        outcomes.some((outcome) => outcome.status === "fulfilled")
          ? new Date()
          : null,
      );
    } catch (error) {
      if (analyticsRequestIdRef.current !== requestId) return;
      setAnalyticsError(
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
  }, [analyticsInput, clearAnalytics]);

  useEffect(() => {
    void loadAnalytics();
    return () => {
      analyticsRequestIdRef.current += 1;
    };
  }, [loadAnalytics, analysisRefresh]);

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
              onClick={() => {
                void competitorRead.reload();
                setAnalysisRefresh((value) => value + 1);
              }}
            >
              重新查询
            </Button>
          </div>
        </div>
      </Card>

      {brandRead.error ? (
        <Alert
          showIcon
          type="error"
          message="品牌目录请求失败"
          description={brandRead.error}
          action={
            <Button
              aria-label="重试品牌目录"
              loading={brandRead.loading}
              onClick={() => void brandRead.reload()}
            >
              重试品牌
            </Button>
          }
        />
      ) : null}
      {platformRead.error ? (
        <Alert
          showIcon
          type="error"
          message="模型目录请求失败"
          description={platformRead.error}
          action={
            <Button
              aria-label="重试模型目录"
              loading={platformRead.loading}
              onClick={() => void platformRead.reload()}
            >
              重试模型
            </Button>
          }
        />
      ) : null}
      {analyticsError ? (
        <Alert
          showIcon
          type="error"
          message="分析数据请求失败"
          description={analyticsError}
          action={
            <Button
              aria-label="重试分析数据"
              loading={loading}
              onClick={() => void loadAnalytics()}
            >
              重试分析
            </Button>
          }
        />
      ) : null}
      <Card
        className="overview-panel overview-workspace-card"
        styles={{ body: { padding: 0 } }}
      >
        <Tabs
          activeKey={activeTab}
          animated={{ inkBar: true, tabPane: false }}
          className="overview-tabs"
          onChange={(key) => setActiveTab(key as OverviewTab)}
          tabBarGutter={compact ? 8 : 32}
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
                <Space size={compact ? 4 : 8}>
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
                <Space size={compact ? 4 : 8}>
                  <AimOutlined />
                  竞品管理
                  <Badge
                    count={competitorRead.data ? competitors.length : "—"}
                    overflowCount={99}
                    showZero
                    size="small"
                  />
                </Space>
              ),
              children: (
                <CompetitorDirectory
                  key={`${organizationId}:${teamId}:${brandId}`}
                  userId={userId}
                  organizationId={organizationId}
                  teamBindingId={teamId}
                  brandId={scopeReady ? brandId : ""}
                  catalog={competitorRead}
                  canCreate={
                    scopeReady &&
                    workspacePermission(
                      workspace,
                      selectedBrand?.accessRole,
                      "resource.create",
                      "geo_insights",
                    )
                  }
                  canUpdate={
                    scopeReady &&
                    workspacePermission(
                      workspace,
                      selectedBrand?.accessRole,
                      "resource.update",
                      "geo_insights",
                    )
                  }
                  canDelete={
                    scopeReady &&
                    workspacePermission(
                      workspace,
                      selectedBrand?.accessRole,
                      "resource.delete",
                      "geo_insights",
                    )
                  }
                />
              ),
            },
            {
              key: "actions",
              label: (
                <Space size={compact ? 4 : 8}>
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
                      <Button
                        href={`/dashboard/monitoring?${qs({ organizationId, brandId })}`}
                      >
                        查看问题
                      </Button>
                    </div>
                    <div className="overview-action-row">
                      <span>02</span>
                      <div>
                        <Typography.Text strong>核对回答证据</Typography.Text>
                        <Typography.Text type="secondary">
                          对比模型回答、引用域名与文章来源
                        </Typography.Text>
                      </div>
                      <Button
                        href={`/dashboard/answers?${qs({ organizationId, brandId })}`}
                      >
                        查看证据
                      </Button>
                    </div>
                    {workspacePermission(
                      workspace,
                      selectedBrand?.accessRole,
                      "resource.read",
                      "content",
                    ) ? (
                      <div className="overview-action-row">
                        <span>03</span>
                        <div>
                          <Typography.Text strong>推进内容生产</Typography.Text>
                          <Typography.Text type="secondary">
                            把已确认机会转成可审核的内容任务
                          </Typography.Text>
                        </div>
                        <Button
                          href={`/dashboard/content?${qs({ stage: workspacePermission(workspace, selectedBrand?.accessRole, "resource.create", "content") ? "generate" : "library", organizationId, brandId })}`}
                          type="primary"
                        >
                          {workspacePermission(
                            workspace,
                            selectedBrand?.accessRole,
                            "resource.create",
                            "content",
                          )
                            ? "生成内容"
                            : "查看内容库"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
