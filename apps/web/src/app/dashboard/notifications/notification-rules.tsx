"use client";
import {
  notificationRuleSchema,
  type NotificationRuleInput,
} from "@geo/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Flex,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibleTable } from "../../accessible-table";

type RuleType = NotificationRuleInput["type"];
type Metric = "exposure" | "score" | "avg_rank";
type Rule = {
  id: string;
  organizationId: string;
  teamBindingId: string;
  brandId: string | null;
  brandName?: string | null;
  type: RuleType;
  metric: Metric | null;
  threshold: number;
  windowDays: number | null;
  cooldownMinutes: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastEvaluationError: string | null;
};
type Command = { input: NotificationRuleInput; original?: Rule };
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
function config(rule: Rule): NotificationRuleInput {
  const common = {
    organizationId: rule.organizationId,
    teamBindingId: rule.teamBindingId,
    type: rule.type,
    threshold: rule.threshold,
    cooldownMinutes: rule.cooldownMinutes,
    enabled: rule.enabled,
  };
  return notificationRuleSchema.parse(
    rule.type === "metric_anomaly"
      ? {
          ...common,
          brandId: rule.brandId,
          metric: rule.metric,
          windowDays: rule.windowDays,
        }
      : common,
  );
}
function matches(rule: Rule, input: NotificationRuleInput) {
  const current = config(rule);
  return Object.entries(input).every(
    ([key, value]) => current[key as keyof NotificationRuleInput] === value,
  );
}

export function NotificationRules({
  organizationId,
  userId,
  teamBindingId,
  brandId,
}: {
  organizationId: string;
  userId: string;
  teamBindingId: string;
  brandId: string;
}) {
  const [rules, setRules] = useState<Rule[]>();
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [type, setType] = useState<RuleType>("low_credits"),
    [metric, setMetric] = useState<Metric>("exposure");
  const [threshold, setThreshold] = useState<number | null>(1000),
    [windowDays, setWindowDays] = useState<number | null>(7),
    [cooldown, setCooldown] = useState<number | null>(1440);
  const [createOpen, setCreateOpen] = useState(false),
    [editingRule, setEditingRule] = useState<Rule>(),
    [editingThreshold, setEditingThreshold] = useState<number | null>(null);
  const [pending, setPending] = useState<Command>(),
    [canRetry, setCanRetry] = useState(false),
    [conflict, setConflict] = useState<Rule>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    mounted = useRef(true),
    controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const storageKey = `geo:notification-rule-pending:v1:${userId}:${organizationId}`;
  const remember = (command?: Command) => {
    try {
      if (command) sessionStorage.setItem(storageKey, JSON.stringify(command));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The unique rule scope and expected configuration still make retries safe. */
    }
  };
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const command = JSON.parse(saved) as Command;
      const input = notificationRuleSchema.parse(command.input);
      if (input.organizationId !== organizationId)
        throw new Error("scope mismatch");
      if (command.original) {
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            command.original.id,
          ) ||
          config(command.original).organizationId !== organizationId
        )
          throw new Error("original scope mismatch");
      }
      setPending({ ...command, input });
      setError("已恢复上次尚未核实的规则保存，请先核对结果。");
    } catch {
      setError("上次规则保存记录无法恢复，请先刷新规则核对当前配置。");
    }
  }, [storageKey, organizationId]);
  const fetchRules = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/v1/notification-rules?organizationId=${organizationId}`,
        { signal, cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "规则读取失败");
      return body.data as Rule[];
    },
    [organizationId],
  );
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReading(true);
    setReadError("");
    try {
      const rows = await fetchRules(controller.signal);
      if (!controller.signal.aborted && controllerRef.current === controller)
        setRules(rows);
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        setRules(undefined);
        setReadError(error instanceof Error ? error.message : "规则读取失败");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setReading(false);
      }
    }
  }, [fetchRules]);
  useEffect(() => {
    void load();
    const poll = () => {
      if (!document.hidden && navigator.onLine && !controllerRef.current)
        void load();
    };
    const timer = window.setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
    };
  }, [load]);
  function finish(text: string) {
    remember();
    setPending(undefined);
    setCanRetry(false);
    setConflict(undefined);
    setError("");
    setMessage(text);
    setCreateOpen(false);
    setEditingRule(undefined);
    void load();
  }
  async function verify(command: Command) {
    try {
      const rows = await fetchRules();
      if (!mounted.current) return;
      const rule = rows.find((row) =>
        command.original
          ? row.id === command.original.id
          : row.type === command.input.type &&
            row.teamBindingId === command.input.teamBindingId &&
            row.brandId ===
              (command.input.type === "metric_anomaly"
                ? command.input.brandId
                : null),
      );
      if (rule && matches(rule, command.input))
        finish("已核对：通知规则已保存");
      else {
        setCanRetry(true);
        setError("当前未核实这次保存，可以继续核对或按原内容重试。");
      }
    } catch (error) {
      if (mounted.current)
        setError(
          `保存结果暂时无法核对：${error instanceof Error ? error.message : "请重试"}`,
        );
    }
  }
  async function send(command: Command) {
    remember(command);
    setPending(command);
    setCanRetry(false);
    setConflict(undefined);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        command.original
          ? `/api/v1/notification-rules/${command.original.id}`
          : "/api/v1/notification-rules",
        {
          method: command.original ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            command.original
              ? { ...command.input, expected: config(command.original) }
              : command.input,
          ),
        },
      );
      const body = await response.json();
      if (!mounted.current) return;
      if (response.ok) {
        finish(
          command.original
            ? "通知规则已保存"
            : body.data.replayed
              ? "已找到这条通知规则"
              : "通知规则已创建",
        );
        return;
      }
      if (response.status >= 500) {
        await verify(command);
        return;
      }
      remember();
      setPending(undefined);
      setError(body.error?.message ?? "通知规则保存失败");
      if (body.error?.code === "NOTIFICATION_RULE_CONFLICT") {
        setConflict({ ...command.original!, ...body.error.details.current });
        void load();
      }
    } catch {
      if (mounted.current) await verify(command);
    }
  }
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function validate(value: unknown): NotificationRuleInput | undefined {
    const parsed = notificationRuleSchema.safeParse(value);
    if (!parsed.success) {
      setError(
        "请填写有效整数：积分阈值 0 至 10 亿，连接阈值 1 至 20，异常阈值 1 至 100，观察天数 1 至 90，冷却时间 5 至 10080 分钟。",
      );
      return;
    }
    return parsed.data;
  }
  function create() {
    const common = {
      organizationId,
      teamBindingId,
      type,
      threshold,
      cooldownMinutes: cooldown,
      enabled: true,
    };
    const input = validate(
      type === "metric_anomaly"
        ? { ...common, brandId, metric, windowDays }
        : common,
    );
    if (input) void run(() => send({ input }));
  }
  function save() {
    if (!editingRule) return;
    const input = validate({
      ...config(editingRule),
      threshold: editingThreshold,
    });
    if (input) void run(() => send({ input, original: editingRule }));
  }
  const locked = busy || Boolean(pending);
  const feedback = error ? (
    <Alert
      type={pending ? "warning" : "error"}
      showIcon
      message={error}
      style={{ marginBottom: 16 }}
    />
  ) : null;
  const recovery = pending ? (
    <Space wrap>
      <Button disabled={busy} onClick={() => void run(() => verify(pending))}>
        核对上次保存
      </Button>
      {canRetry ? (
        <Button disabled={busy} onClick={() => void run(() => send(pending))}>
          按原内容重试
        </Button>
      ) : null}
    </Space>
  ) : null;
  const columns: TableColumnsType<Rule> = [
    {
      title: "规则",
      key: "rule",
      width: 200,
      render: (_, rule) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {typeNames[rule.type]}
            {rule.metric ? ` · ${metricNames[rule.metric]}` : ""}
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
        `${value}${rule.type === "metric_anomaly" ? "%" : ""}`,
    },
    {
      title: "冷却时间",
      dataIndex: "cooldownMinutes",
      width: 120,
      render: (value: number) => `${value} 分钟`,
    },
    {
      title: "状态",
      key: "state",
      width: 100,
      render: (_, rule) => (
        <Badge
          status={
            rule.enabled && rule.lastEvaluationError
              ? "error"
              : rule.enabled
                ? "success"
                : "default"
          }
          text={
            rule.enabled && rule.lastEvaluationError
              ? "评估异常"
              : rule.enabled
                ? "启用"
                : "停用"
          }
        />
      ),
    },
    {
      title: "最近评估",
      key: "evaluation",
      width: 180,
      render: (_, rule) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary">
            {rule.lastEvaluatedAt
              ? new Date(rule.lastEvaluatedAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })
              : "尚未评估"}
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
      width: 180,
      render: (_, rule) => (
        <Space>
          <Button
            disabled={locked}
            onClick={() => {
              setEditingRule(rule);
              setEditingThreshold(rule.threshold);
              setError("");
              setConflict(undefined);
            }}
          >
            阈值
          </Button>
          <Button
            disabled={locked}
            onClick={() =>
              void run(() =>
                send({
                  input: { ...config(rule), enabled: !rule.enabled },
                  original: rule,
                }),
              )
            }
          >
            {rule.enabled ? "停用" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];
  const enabled = rules?.filter((rule) => rule.enabled),
    failures = enabled?.filter((rule) => rule.lastEvaluationError);
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={12}>
          <Card>
            <Statistic
              title="启用检测规则"
              value={enabled?.length}
              formatter={() => (rules ? enabled?.length : "—")}
            />
          </Card>
        </Col>
        <Col xs={12}>
          <Card>
            <Statistic
              title="规则评估异常"
              value={failures?.length}
              formatter={() => (rules ? failures?.length : "—")}
            />
          </Card>
        </Col>
      </Row>
      <Card
        title="企业通知阈值"
        extra={
          <Space wrap>
            <Button loading={reading} onClick={() => void load()}>
              刷新规则
            </Button>
            <Button
              type="primary"
              disabled={locked || !teamBindingId}
              onClick={() => {
                setCreateOpen(true);
                setError("");
              }}
            >
              新增规则
            </Button>
          </Space>
        }
      >
        {message ? (
          <Alert
            type="success"
            showIcon
            closable
            message={message}
            onClose={() => setMessage("")}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {readError ? (
          <Alert
            type="error"
            showIcon
            message="规则读取失败"
            description={readError}
            action={
              <Button disabled={reading} onClick={() => void load()}>
                重试读取规则
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {!createOpen && !editingRule ? (
          <>
            {feedback}
            {pending ? (
              <Typography.Paragraph>
                待核实：{typeNames[pending.input.type]}，阈值{" "}
                {pending.input.threshold}，
                {pending.input.enabled ? "启用" : "停用"}
              </Typography.Paragraph>
            ) : null}
            {recovery}
          </>
        ) : null}
        <AccessibleTable
          rowKey="id"
          columns={columns}
          dataSource={rules ?? []}
          loading={reading}
          pagination={false}
          scroll={{ x: 900 }}
          scrollRegionLabel="通知规则，可横向滚动"
        />
      </Card>
      <Modal
        open={createOpen}
        title="新增通知规则"
        okText="创建规则"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            Boolean(pending) ||
            !teamBindingId ||
            (type === "metric_anomaly" && !brandId),
        }}
        onOk={create}
        onCancel={() => {
          if (!locked) setCreateOpen(false);
        }}
        closable={!locked}
        maskClosable={!locked}
        keyboard={!locked}
        cancelButtonProps={{ disabled: locked }}
        width={640}
      >
        {feedback}
        {recovery}
        <Flex gap={16} vertical style={{ marginTop: 16 }}>
          <label htmlFor="notification-rule-type">通知类型</label>
          <Select
            id="notification-rule-type"
            disabled={locked}
            value={type}
            onChange={(next) => {
              setType(next);
              setThreshold(
                next === "low_credits"
                  ? 1000
                  : next === "connection_failure"
                    ? 3
                    : 20,
              );
            }}
            options={Object.entries(typeNames).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          {type === "metric_anomaly" ? (
            <>
              <label htmlFor="notification-rule-metric">指标</label>
              <Select
                id="notification-rule-metric"
                disabled={locked}
                value={metric}
                onChange={setMetric}
                options={Object.entries(metricNames).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <label htmlFor="notification-rule-window">观察天数</label>
              <InputNumber
                id="notification-rule-window"
                disabled={locked}
                value={windowDays}
                onChange={setWindowDays}
                style={{ width: "100%" }}
              />
            </>
          ) : null}
          <label htmlFor="notification-rule-threshold">阈值</label>
          <InputNumber
            id="notification-rule-threshold"
            disabled={locked}
            value={threshold}
            onChange={setThreshold}
            style={{ width: "100%" }}
          />
          <label htmlFor="notification-rule-cooldown">冷却分钟</label>
          <InputNumber
            id="notification-rule-cooldown"
            disabled={locked}
            value={cooldown}
            onChange={setCooldown}
            style={{ width: "100%" }}
          />
        </Flex>
      </Modal>
      <Modal
        open={Boolean(editingRule)}
        title="修改通知阈值"
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: Boolean(pending) || Boolean(conflict) }}
        onOk={save}
        onCancel={() => {
          if (!locked) setEditingRule(undefined);
        }}
        closable={!locked}
        maskClosable={!locked}
        keyboard={!locked}
        cancelButtonProps={{ disabled: locked }}
        width={640}
      >
        {feedback}
        {recovery}
        {conflict ? (
          <Alert
            type="warning"
            showIcon
            message={`最新阈值为 ${conflict.threshold}，您的输入仍保留`}
            action={
              <Button
                onClick={() => {
                  setEditingRule(conflict);
                  setConflict(undefined);
                  setError("");
                }}
              >
                以最新配置继续编辑
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <label htmlFor="notification-edit-threshold">通知阈值</label>
        <InputNumber
          id="notification-edit-threshold"
          disabled={locked}
          value={editingThreshold}
          onChange={setEditingThreshold}
          style={{ width: "100%" }}
        />
      </Modal>
    </Space>
  );
}
