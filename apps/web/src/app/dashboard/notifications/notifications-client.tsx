"use client";
import { EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

type RuleType = "low_credits" | "connection_failure" | "metric_anomaly";
type Metric = "exposure" | "score" | "avg_rank";
type Rule = {
  id: string;
  organizationId: string;
  teamBindingId: string;
  teamName: string | null;
  teamId: string;
  brandId: string | null;
  brandName: string | null;
  type: RuleType;
  metric: Metric | null;
  threshold: number;
  windowDays: number | null;
  cooldownMinutes: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastEvaluationError: string | null;
};
type Notice = {
  id: string;
  teamBindingId: string | null;
  brandId: string | null;
  type: RuleType;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  readAt: string | null;
};
type NoticePage = {
  list: Notice[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
};
const emptyNoticePage = (): NoticePage => ({
  list: [],
  total: 0,
  unreadCount: 0,
  page: 1,
  pageSize: 50,
});
const typeNames: Record<RuleType, string> = {
  low_credits: "积分不足",
  connection_failure: "连接连续失败",
  metric_anomaly: "核心指标异常",
};
const metricNames: Record<Metric, string> = {
  exposure: "品牌提及率",
  score: "GEO 得分",
  avg_rank: "平均排名",
};
async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data as T;
}

export function NotificationsClient({
  organizations,
}: {
  organizations: ScopeOrganization[];
}) {
  const scope = useAnswerBitScope(organizations);
  const [notices, setNotices] = useState<NoticePage>(emptyNoticePage);
  const [rules, setRules] = useState<Rule[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<RuleType>("low_credits");
  const [metric, setMetric] = useState<Metric>("exposure");
  const [threshold, setThreshold] = useState(1000);
  const [windowDays, setWindowDays] = useState(7);
  const [cooldownMinutes, setCooldownMinutes] = useState(1440);
  const [ruleCreateOpen, setRuleCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editingThreshold, setEditingThreshold] = useState<number | null>(null);
  const loadEpoch = useRef(0);
  const activeOrganizationId = useRef(scope.organizationId);
  const canManage = useMemo(
    () =>
      organizations.find((item) => item.id === scope.organizationId)?.role ===
      "tenant_admin",
    [organizations, scope.organizationId],
  );
  useEffect(() => {
    activeOrganizationId.current = scope.organizationId;
  }, [scope.organizationId]);
  const load = useCallback(async () => {
    if (scope.organizationId !== activeOrganizationId.current) return;
    const epoch = ++loadEpoch.current;
    if (!scope.organizationId) {
      setNotices(emptyNoticePage());
      setRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const noticeParams = scopeQuery({
        organizationId: scope.organizationId,
        page: "1",
        pageSize: "50",
        unreadOnly: String(unreadOnly),
      });
      const [nextNotices, nextRules] = await Promise.all([
        fetch(`/api/v1/notifications?${noticeParams}`, {
          cache: "no-store",
        }).then(json<NoticePage>),
        canManage
          ? fetch(
              `/api/v1/notification-rules?${scopeQuery({ organizationId: scope.organizationId })}`,
              { cache: "no-store" },
            ).then(json<Rule[]>)
          : Promise.resolve([] as Rule[]),
      ]);
      if (
        epoch !== loadEpoch.current ||
        scope.organizationId !== activeOrganizationId.current
      )
        return;
      setNotices(nextNotices);
      setRules(nextRules);
      setMessage("");
    } catch (error) {
      if (
        epoch !== loadEpoch.current ||
        scope.organizationId !== activeOrganizationId.current
      )
        return;
      setMessage(error instanceof Error ? error.message : "通知加载失败");
    } finally {
      if (
        epoch === loadEpoch.current &&
        scope.organizationId === activeOrganizationId.current
      )
        setLoading(false);
    }
  }, [scope.organizationId, unreadOnly, canManage]);
  useEffect(() => {
    loadEpoch.current += 1;
    setNotices(emptyNoticePage());
    setRules([]);
    setMessage("");
    setBusy("");
    setLoading(false);
    setRuleCreateOpen(false);
    setEditingRule(null);
  }, [scope.organizationId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && navigator.onLine) void load();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);
  useEffect(() => {
    setThreshold(
      type === "low_credits" ? 1000 : type === "connection_failure" ? 3 : 20,
    );
  }, [type]);
  const enabledRules = useMemo(
    () => rules.filter((rule) => rule.enabled),
    [rules],
  );
  const failedRules = useMemo(
    () => enabledRules.filter((rule) => rule.lastEvaluationError),
    [enabledRules],
  );
  const body = (rule?: Rule, overrides: Partial<Rule> = {}) => {
    const source = { ...rule, ...overrides };
    const selectedType = source.type ?? type;
    const common = {
      organizationId: scope.organizationId,
      teamBindingId: source.teamBindingId ?? scope.teamBindingId,
      type: selectedType,
      threshold: source.threshold ?? threshold,
      cooldownMinutes: source.cooldownMinutes ?? cooldownMinutes,
      enabled: source.enabled ?? true,
    };
    return selectedType === "metric_anomaly"
      ? {
          ...common,
          brandId: source.brandId ?? scope.brandId,
          metric: source.metric ?? metric,
          windowDays: source.windowDays ?? windowDays,
        }
      : common;
  };
  async function createRule() {
    if (!scope.teamBindingId || (type === "metric_anomaly" && !scope.brandId))
      return setMessage("请先选择企业和品牌范围");
    const organizationId = scope.organizationId;
    setBusy("create");
    setMessage("");
    try {
      await json(
        await fetch("/api/v1/notification-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body()),
        }),
      );
      if (organizationId !== activeOrganizationId.current) return;
      await load();
      setRuleCreateOpen(false);
    } catch (error) {
      if (organizationId !== activeOrganizationId.current) return;
      setMessage(error instanceof Error ? error.message : "规则创建失败");
    } finally {
      if (organizationId === activeOrganizationId.current) setBusy("");
    }
  }
  async function updateRule(rule: Rule, changes: Partial<Rule>) {
    const organizationId = scope.organizationId;
    setBusy(rule.id);
    setMessage("");
    try {
      await json(
        await fetch(`/api/v1/notification-rules/${rule.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body(rule, changes)),
        }),
      );
      if (organizationId !== activeOrganizationId.current) return;
      await load();
    } catch (error) {
      if (organizationId !== activeOrganizationId.current) return;
      setMessage(error instanceof Error ? error.message : "规则更新失败");
    } finally {
      if (organizationId === activeOrganizationId.current) setBusy("");
    }
  }
  function editRule(rule: Rule) {
    setEditingRule(rule);
    setEditingThreshold(rule.threshold);
  }
  async function setRead(notice: Notice, read: boolean) {
    const organizationId = scope.organizationId;
    setBusy(notice.id);
    try {
      await json(
        await fetch(`/api/v1/notifications/${notice.id}/read`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: scope.organizationId, read }),
        }),
      );
      if (organizationId !== activeOrganizationId.current) return;
      await load();
    } catch (error) {
      if (organizationId !== activeOrganizationId.current) return;
      setMessage(error instanceof Error ? error.message : "读取状态更新失败");
    } finally {
      if (organizationId === activeOrganizationId.current) setBusy("");
    }
  }
  const ruleColumns: TableColumnsType<Rule> = [
    {
      title: "规则",
      key: "rule",
      render: (_, rule) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {typeNames[rule.type]}
            {rule.metric ? " · " + metricNames[rule.metric] : ""}
          </Typography.Text>
          <Typography.Text type="secondary">
            {rule.brandName ?? "企业级规则"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "阈值",
      dataIndex: "threshold",
      width: 100,
      render: (value: number, rule) =>
        String(value) + (rule.type === "metric_anomaly" ? "%" : ""),
    },
    {
      title: "冷却时间",
      dataIndex: "cooldownMinutes",
      width: 120,
      render: (value: number) => value + " 分钟",
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 100,
      render: (enabled: boolean, rule) => (
        <Badge
          status={
            enabled && rule.lastEvaluationError
              ? "error"
              : enabled
                ? "success"
                : "default"
          }
          text={
            enabled && rule.lastEvaluationError
              ? "评估异常"
              : enabled
                ? "启用"
                : "停用"
          }
        />
      ),
    },
    {
      title: "最近评估",
      dataIndex: "lastEvaluatedAt",
      width: 180,
      render: (value: string | null, rule) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary">
            {value ? new Date(value).toLocaleString() : "尚未评估"}
          </Typography.Text>
          {rule.lastEvaluationError ? (
            <Typography.Text type="danger">
              {rule.lastEvaluationError}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 170,
      render: (_, rule) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => editRule(rule)}
            size="small"
          >
            阈值
          </Button>
          <Button
            loading={busy === rule.id}
            onClick={() => void updateRule(rule, { enabled: !rule.enabled })}
            size="small"
          >
            {rule.enabled ? "停用" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        <Col md={canManage ? 6 : 12} sm={12} xs={24}>
          <Card>
            <Statistic title="未读通知" value={notices.unreadCount} />
          </Card>
        </Col>
        <Col md={canManage ? 6 : 12} sm={12} xs={24}>
          <Card>
            <Statistic title="通知总数" value={notices.total} />
          </Card>
        </Col>
        {canManage ? (
          <>
            <Col md={6} sm={12} xs={24}>
              <Card>
                <Statistic title="启用检测规则" value={enabledRules.length} />
              </Card>
            </Col>
            <Col md={6} sm={12} xs={24}>
              <Card>
                <Statistic
                  title="规则评估异常"
                  value={failedRules.length}
                  valueStyle={failedRules.length ? { color: "#dc2626" } : {}}
                />
              </Card>
            </Col>
          </>
        ) : null}
      </Row>

      <Card title="通知范围">
        <Flex align="flex-end" gap={16} wrap>
          <div style={{ flex: "1 1 560px" }}>
            <ScopeFields organizations={organizations} scope={scope} />
          </div>
          <Space>
            <Typography.Text>只看未读</Typography.Text>
            <Switch
              aria-label="仅显示未读通知"
              checked={unreadOnly}
              onChange={setUnreadOnly}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void load()}
            >
              刷新通知
            </Button>
          </Space>
        </Flex>
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

      {canManage && failedRules.length ? (
        <Alert
          action={
            <Button loading={loading} onClick={() => void load()} size="small">
              重新检查
            </Button>
          }
          description="规则仍保持启用；Worker 会在下一个周期继续重试，处理前可在规则列表查看错误码与最近评估时间。"
          message={`${failedRules.length} 条持续检测规则最近评估异常`}
          showIcon
          type="warning"
        />
      ) : null}

      <Row align="stretch" gutter={[16, 16]}>
        <Col xxl={10} xs={24}>
          <Card
            extra={
              <Typography.Text type="secondary">按触发时间倒序</Typography.Text>
            }
            title="站内通知"
          >
            {notices.list.length ? (
              <List
                dataSource={notices.list}
                pagination={
                  notices.list.length > 10
                    ? { pageSize: 10, showSizeChanger: false }
                    : false
                }
                renderItem={(notice) => (
                  <List.Item
                    actions={[
                      <Button
                        key="read"
                        loading={busy === notice.id}
                        onClick={() => void setRead(notice, !notice.readAt)}
                        size="small"
                      >
                        {notice.readAt ? "标为未读" : "标为已读"}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <Badge
                          status={
                            notice.severity === "critical"
                              ? "error"
                              : notice.severity === "warning"
                                ? "warning"
                                : "processing"
                          }
                        />
                      }
                      description={
                        <Space direction="vertical" size={4}>
                          <Typography.Text>{notice.message}</Typography.Text>
                          <Typography.Text type="secondary">
                            {new Date(notice.occurredAt).toLocaleString()}
                            {notice.brandId ? " · 品牌 " + notice.brandId : ""}
                          </Typography.Text>
                        </Space>
                      }
                      title={
                        <Space wrap>
                          <Typography.Text
                            strong={!notice.readAt}
                            type={notice.readAt ? "secondary" : undefined}
                          >
                            {notice.title}
                          </Typography.Text>
                          <Tag>{typeNames[notice.type]}</Tag>
                          {!notice.readAt ? <Tag color="blue">未读</Tag> : null}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty
                description={unreadOnly ? "没有未读通知" : "暂无站内通知"}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                <Typography.Text type="secondary">
                  创建阈值规则后，系统会定时评估积分、连接与核心指标。
                </Typography.Text>
              </Empty>
            )}
          </Card>
        </Col>
        {canManage ? (
          <Col xxl={14} xs={24}>
            <Card
              extra={
                <Space wrap>
                  <Tag color="blue">仅企业管理员可配置</Tag>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setRuleCreateOpen(true)}
                    type="primary"
                  >
                    新增规则
                  </Button>
                </Space>
              }
              title="企业通知阈值"
            >
              <Table<Rule>
                columns={ruleColumns}
                dataSource={rules}
                locale={{
                  emptyText: (
                    <Empty
                      description="暂无通知规则"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ),
                }}
                onHeaderRow={() => ({ tabIndex: 0 })}
                pagination={false}
                rowKey="id"
                scroll={{ x: 900 }}
              />
            </Card>
          </Col>
        ) : null}
      </Row>

      {canManage ? (
        <Modal
          cancelText="取消"
          confirmLoading={busy === "create"}
          okButtonProps={{
            disabled:
              !scope.teamBindingId ||
              (type === "metric_anomaly" && !scope.brandId),
          }}
          okText="创建规则"
          onCancel={() => setRuleCreateOpen(false)}
          onOk={() => void createRule()}
          open={ruleCreateOpen}
          title="新增通知规则"
          width={760}
        >
          <Flex gap={16} vertical>
            <Row gutter={[12, 12]}>
              <Col md={12} xs={24}>
                <label htmlFor="notification-rule-type">
                  <Typography.Text type="secondary">通知类型</Typography.Text>
                </label>
                <Select
                  id="notification-rule-type"
                  onChange={(value: RuleType) => setType(value)}
                  options={Object.entries(typeNames).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  style={{ width: "100%" }}
                  value={type}
                />
              </Col>
              {type === "metric_anomaly" ? (
                <Col md={12} xs={24}>
                  <label htmlFor="notification-rule-metric">
                    <Typography.Text type="secondary">指标</Typography.Text>
                  </label>
                  <Select
                    id="notification-rule-metric"
                    onChange={(value: Metric) => setMetric(value)}
                    options={Object.entries(metricNames).map(
                      ([value, label]) => ({ value, label }),
                    )}
                    style={{ width: "100%" }}
                    value={metric}
                  />
                </Col>
              ) : null}
              <Col md={12} xs={24}>
                <label htmlFor="notification-rule-threshold">
                  <Typography.Text type="secondary">阈值</Typography.Text>
                </label>
                <InputNumber
                  id="notification-rule-threshold"
                  max={
                    type === "connection_failure"
                      ? 20
                      : type === "metric_anomaly"
                        ? 100
                        : undefined
                  }
                  min={type === "low_credits" ? 0 : 1}
                  onChange={(value) => setThreshold(value ?? 0)}
                  style={{ width: "100%" }}
                  value={threshold}
                />
              </Col>
              {type === "metric_anomaly" ? (
                <Col md={12} xs={24}>
                  <label htmlFor="notification-rule-window-days">
                    <Typography.Text type="secondary">观察天数</Typography.Text>
                  </label>
                  <InputNumber
                    id="notification-rule-window-days"
                    max={90}
                    min={1}
                    onChange={(value) => setWindowDays(value ?? 1)}
                    style={{ width: "100%" }}
                    value={windowDays}
                  />
                </Col>
              ) : null}
              <Col md={12} xs={24}>
                <label htmlFor="notification-rule-cooldown">
                  <Typography.Text type="secondary">冷却分钟</Typography.Text>
                </label>
                <InputNumber
                  id="notification-rule-cooldown"
                  max={10080}
                  min={5}
                  onChange={(value) => setCooldownMinutes(value ?? 5)}
                  style={{ width: "100%" }}
                  value={cooldownMinutes}
                />
              </Col>
            </Row>
          </Flex>
        </Modal>
      ) : null}

      <Modal
        cancelText="取消"
        confirmLoading={Boolean(editingRule && busy === editingRule.id)}
        okButtonProps={{
          disabled:
            editingThreshold === null || !Number.isInteger(editingThreshold),
        }}
        okText="保存"
        onCancel={() => setEditingRule(null)}
        onOk={async () => {
          if (!editingRule || editingThreshold === null) return;
          await updateRule(editingRule, { threshold: editingThreshold });
          setEditingRule(null);
        }}
        open={Boolean(editingRule)}
        title="修改通知阈值"
        width={640}
      >
        <Typography.Paragraph type="secondary">
          {editingRule?.type === "low_credits"
            ? "可用积分低于该值时通知。"
            : editingRule?.type === "connection_failure"
              ? "连接连续失败达到该次数时通知。"
              : "指标波动达到该百分比时通知。"}
        </Typography.Paragraph>
        <label htmlFor="notification-edit-threshold">
          <Typography.Text type="secondary">通知阈值</Typography.Text>
        </label>
        <InputNumber
          id="notification-edit-threshold"
          max={
            editingRule?.type === "connection_failure"
              ? 20
              : editingRule?.type === "metric_anomaly"
                ? 100
                : undefined
          }
          min={editingRule?.type === "low_credits" ? 0 : 1}
          onChange={setEditingThreshold}
          style={{ width: "100%" }}
          value={editingThreshold}
        />
      </Modal>
    </Space>
  );
}
