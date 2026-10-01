"use client";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { createCompetitorSchema, updateCompetitorSchema } from "@geo/contracts";
import { useDirectoryAttempt } from "./directory-attempt";
import type { useDirectoryRead } from "./directory-read";
export type Competitor = { id: string; name: string; alias: string };
type Directory = ReturnType<typeof useDirectoryRead<Competitor[]>>;

// @project-doc docs/domains/geo_operations.md#competitor_workflow
export function CompetitorDirectory({
  userId,
  organizationId,
  teamBindingId,
  brandId,
  canCreate,
  canUpdate,
  canDelete,
  catalog,
}: {
  userId: string;
  organizationId: string;
  teamBindingId: string;
  brandId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  catalog: Directory;
}) {
  const { md } = Grid.useBreakpoint();
  const compact = !md;
  const scope = { organizationId, teamBindingId, brandId };
  const attempt = useDirectoryAttempt(
    `geo-competitor-attempt:${userId}:${organizationId}:${teamBindingId}:${brandId}`,
  );
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [deleting, setDeleting] = useState<Competitor | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [verifyFrom, setVerifyFrom] = useState<number | null>(null);
  const mountedRef = useRef(false),
    writingRef = useRef(false);
  const reloadRef = useRef(catalog.reload);
  const locked = busy || Boolean(attempt.pending) || !attempt.ready;
  const editorAllowed = Boolean(brandId) && (editingId ? canUpdate : canCreate);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    reloadRef.current = catalog.reload;
  }, [catalog.reload]);
  useEffect(() => {
    if (attempt.resolvedVersion) void reloadRef.current();
  }, [attempt.resolvedVersion]);
  useEffect(() => {
    const form = attempt.pending?.form;
    if (
      form?.kind === "competitor" &&
      attempt.pending?.operation !== "删除竞品"
    ) {
      setName(form.name);
      setAlias(form.alias);
      setEditingId(form.resourceId);
    }
  }, [attempt.pending]);
  const reviewed =
    verifyFrom !== null &&
    catalog.successVersion > verifyFrom &&
    !catalog.error &&
    !catalog.loading;
  useEffect(() => {
    const pending = attempt.pending,
      form = pending?.form;
    if (
      !reviewed ||
      attempt.inFlight ||
      form?.kind !== "competitor" ||
      !form.resourceId
    )
      return;
    const current = catalog.data?.find((item) => item.id === form.resourceId);
    const matched =
      pending?.operation === "删除竞品"
        ? !current
        : current?.name === form.name.trim() &&
          current?.alias === form.alias.trim();
    if (matched && attempt.finish()) {
      setEditorOpen(false);
      setDeleting(null);
      setVerifyFrom(null);
      setNotice({
        type: "success",
        text:
          pending?.operation === "删除竞品"
            ? "目录已确认该竞品不存在"
            : "目录已确认竞品名称与别名已更新",
      });
    }
  }, [reviewed, catalog.data, attempt]);
  function openEditor(item?: Competitor) {
    setNotice(null);
    setEditingId(item?.id);
    if (item && editingId !== item.id) {
      setName(item.name);
      setAlias(item.alias);
    } else if (!item && editingId) {
      setName("");
      setAlias("");
    }
    setEditorOpen(true);
  }
  async function write(operation: string, resourceId?: string) {
    if (writingRef.current || locked) return;
    const payload = {
      ...scope,
      competitorName: name.trim(),
      competitorAlias: alias.trim(),
    };
    const deletingOperation = operation === "删除竞品";
    if (!(deletingOperation ? canDelete : resourceId ? canUpdate : canCreate))
      return;
    if (
      !deletingOperation &&
      !(resourceId ? updateCompetitorSchema : createCompetitorSchema).safeParse(
        payload,
      ).success
    ) {
      setNotice({
        type: "error",
        text: "竞品名称须为 1–255 字，别名最多 255 字。",
      });
      return;
    }
    writingRef.current = true;
    setBusy(true);
    setNotice(null);
    setVerifyFrom(null);
    const id = crypto.randomUUID();
    attempt.begin({
      id,
      operation,
      submittedAt: new Date().toISOString(),
      details: [
        {
          label: "竞品名称",
          value: deletingOperation ? (deleting?.name ?? "") : name.trim(),
        },
        {
          label: "竞品别名",
          value: deletingOperation ? (deleting?.alias ?? "") : alias.trim(),
        },
      ],
      form: {
        kind: "competitor",
        name: deletingOperation ? (deleting?.name ?? "") : name,
        alias: deletingOperation ? (deleting?.alias ?? "") : alias,
        resourceId,
      },
    });
    try {
      const url = resourceId
        ? `/api/v1/answerbit/competitors/${encodeURIComponent(resourceId)}`
        : "/api/v1/answerbit/competitors";
      const response = await fetch(
        deletingOperation ? `${url}?${new URLSearchParams(scope)}` : url,
        {
          method: deletingOperation ? "DELETE" : resourceId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          ...(deletingOperation ? {} : { body: JSON.stringify(payload) }),
        },
      );
      const body = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) attempt.finish(id);
        throw new Error(body.error?.message ?? "操作失败，请核对结果");
      }
      attempt.finish(id);
      if (!mountedRef.current) return;
      setNotice({
        type: "success",
        text: deletingOperation
          ? "竞品已删除"
          : resourceId
            ? "竞品已更新"
            : "竞品已添加",
      });
      setEditorOpen(false);
      setDeleting(null);
      setName("");
      setAlias("");
      setEditingId(undefined);
    } catch (error) {
      if (mountedRef.current)
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "操作失败，请核对结果",
        });
    } finally {
      writingRef.current = false;
      attempt.settle(id);
      if (mountedRef.current) setBusy(false);
    }
  }
  const rows = (catalog.data ?? []).filter((item) =>
    `${item.name}\n${item.alias}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const error =
    notice?.type === "error" ? (
      <Alert
        showIcon
        type="error"
        message={notice.text}
        style={{ marginBottom: 16 }}
      />
    ) : null;
  return (
    <div className="overview-tab-panel">
      <div className="overview-table-toolbar">
        <Flex vertical gap={2}>
          <Typography.Text strong>竞品目录</Typography.Text>
          <Typography.Text type="secondary">
            维护用于趋势和排名对比的品牌对象
          </Typography.Text>
        </Flex>
        <Space wrap>
          <Input
            allowClear
            aria-label="搜索竞品"
            className="overview-competitor-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或别名"
            prefix={<SearchOutlined />}
          />
          <Button
            aria-label="刷新竞品"
            icon={<ReloadOutlined />}
            loading={catalog.loading}
            onClick={() => void catalog.reload()}
          >
            刷新
          </Button>
          {canCreate ? (
            <Button
              aria-label="添加竞品"
              disabled={locked || !brandId}
              icon={<PlusOutlined />}
              onClick={() => openEditor()}
              type="primary"
            >
              添加竞品
            </Button>
          ) : null}
        </Space>
      </div>
      {catalog.error ? (
        <Alert
          style={{ marginBottom: 16 }}
          showIcon
          type="error"
          message="竞品目录请求失败"
          description={catalog.error}
          action={
            <Button
              aria-label="重试竞品目录"
              loading={catalog.loading}
              onClick={() => void catalog.reload()}
            >
              重试目录
            </Button>
          }
        />
      ) : null}
      {notice ? (
        <Alert
          style={{ marginBottom: 16 }}
          showIcon
          type={notice.type}
          message={notice.text}
          closable
          onClose={() => setNotice(null)}
        />
      ) : null}
      {attempt.storageError ? (
        <Alert
          showIcon
          type="error"
          message={attempt.storageError}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {(attempt.pending || (!attempt.ready && attempt.storageError)) &&
      !busy ? (
        <Flex vertical gap={12} style={{ marginBottom: 16 }}>
          <Alert
            showIcon
            type="warning"
            message="上次竞品操作结果待核对"
            description={
              attempt.inFlight
                ? "原操作仍在提交，请等待结果后再核对。"
                : "原操作不会自动重发。请刷新实时目录，按原名称和别名核对后继续操作。"
            }
          />
          {attempt.pending?.details.map((detail) => (
            <Typography.Paragraph
              key={detail.label}
              style={{ marginBottom: 0, overflowWrap: "anywhere" }}
            >
              {detail.label}：{detail.value || "无"}
            </Typography.Paragraph>
          ))}
          <Space wrap>
            <Button
              aria-label="核对竞品目录"
              disabled={attempt.inFlight}
              loading={catalog.loading}
              onClick={() => {
                setEditorOpen(false);
                setDeleting(null);
                setVerifyFrom(catalog.successVersion);
                void catalog.reload();
              }}
            >
              核对竞品目录
            </Button>
            <Popconfirm
              title="已核对腾讯竞品目录中的操作结果？"
              description="只结束本次核对，不会再次发送原操作。"
              okText="结束本次操作"
              onConfirm={() => {
                if (attempt.finish()) {
                  setVerifyFrom(null);
                  setNotice({
                    type: "info",
                    text: "本次核对已结束，请根据目录结果继续操作。",
                  });
                }
              }}
            >
              <Button disabled={!reviewed || attempt.inFlight}>
                已核对，结束本次操作
              </Button>
            </Popconfirm>
          </Space>
        </Flex>
      ) : null}
      <Table<Competitor>
        key={query}
        dataSource={rows}
        loading={catalog.loading}
        rowKey="id"
        tableLayout="fixed"
        pagination={{
          defaultPageSize: 10,
          pageSizeOptions: [5, 10, 20],
          showSizeChanger: true,
          showTotal: (count) => `共 ${count} 个竞品`,
        }}
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
            responsive: ["md"],
            render: (value: string) =>
              value ? (
                <Tag>{value}</Tag>
              ) : (
                <Typography.Text type="secondary">未设置</Typography.Text>
              ),
          },
          ...(canUpdate || canDelete
            ? [
                {
                  title: "操作",
                  width: compact ? 112 : 184,
                  align: "right" as const,
                  render: (_: unknown, row: Competitor) => (
                    <Space size={4}>
                      {canUpdate ? (
                        <Button
                          aria-label={`编辑${row.name}`}
                          disabled={locked}
                          icon={<EditOutlined />}
                          onClick={() => openEditor(row)}
                          size="small"
                          type="text"
                        >
                          {compact ? null : "编辑"}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          aria-label={`删除${row.name}`}
                          disabled={locked}
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            setNotice(null);
                            setDeleting(row);
                          }}
                          size="small"
                          type="text"
                        >
                          {compact ? null : "删除"}
                        </Button>
                      ) : null}
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
                !brandId
                  ? "请先选择品牌"
                  : catalog.error && !catalog.data
                    ? "竞品尚未加载，请重试"
                    : query
                      ? "没有匹配的竞品"
                      : "还没有添加竞品"
              }
            />
          ),
        }}
      />
      <Modal
        title={editingId ? "编辑竞品" : "添加竞品"}
        open={editorOpen}
        width={720}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        cancelText="取消"
        cancelButtonProps={{ disabled: busy }}
        confirmLoading={busy}
        okText={editingId ? "保存竞品" : "添加竞品"}
        okButtonProps={{
          "aria-label": editingId ? "保存竞品" : "添加竞品",
          disabled: locked || !editorAllowed || !name.trim(),
        }}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void write(editingId ? "编辑竞品" : "添加竞品", editingId)}
      >
        {error}
        {!editorAllowed ? (
          <Alert
            showIcon
            type="warning"
            message={`当前品牌已没有${editingId ? "编辑" : "添加"}竞品权限`}
            description="原输入已保留，您可以复制或关闭弹窗；管理员恢复权限后可继续保存。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {attempt.pending && !busy ? (
          <Alert
            showIcon
            type="warning"
            message="操作结果待核对，请关闭弹窗查看原操作记录。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form layout="vertical" disabled={locked}>
          <Form.Item htmlFor="competitor-name" label="竞品名称" required>
            <Input
              id="competitor-name"
              readOnly={!editorAllowed}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：竞品品牌名称"
            />
          </Form.Item>
          <Form.Item htmlFor="competitor-alias" label="竞品别名">
            <Input
              id="competitor-alias"
              readOnly={!editorAllowed}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder="可选，用于匹配品牌称呼"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="删除这个竞品？"
        open={Boolean(deleting)}
        width={640}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        cancelText="取消"
        cancelButtonProps={{ disabled: busy }}
        confirmLoading={busy}
        okText="删除竞品"
        okButtonProps={{
          "aria-label": "删除竞品",
          danger: true,
          disabled: locked || !canDelete,
        }}
        onCancel={() => setDeleting(null)}
        onOk={() => void write("删除竞品", deleting?.id)}
      >
        {error}
        {!canDelete ? (
          <Alert
            showIcon
            type="warning"
            message="当前品牌已没有删除竞品权限"
            description="请关闭确认窗口，或联系管理员恢复权限后再操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Typography.Paragraph>
          将删除腾讯 AnswerBit 中的竞品“{deleting?.name}
          ”，之后的趋势与排名查询不再选择该竞品。
        </Typography.Paragraph>
        {attempt.pending && !busy ? (
          <Alert
            showIcon
            type="warning"
            message="删除结果待核对，请关闭弹窗查看原操作记录。"
          />
        ) : null}
      </Modal>
    </div>
  );
}
