"use client";

import {
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  ImportOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
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
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scopeQuery } from "../use-answerbit-scope";

type Scope = {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
};
type DocumentStatus = "draft" | "ready" | "archived";
type DocumentSource = "manual" | "imported" | "ai_generated";
type DocumentListItem = {
  id: string;
  folderId: string | null;
  folderName: string | null;
  source: DocumentSource;
  sourceJobId: string | null;
  sourceUrl: string | null;
  title: string;
  bodyPreview: string;
  contentLength: number;
  status: DocumentStatus;
  language: string;
  tags: string[];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};
type DocumentDetail = Omit<
  DocumentListItem,
  "bodyPreview" | "contentLength"
> & {
  body: string;
  versions: {
    id: string;
    version: number;
    status: DocumentStatus;
    changeSummary: string;
    createdBy: string;
    createdAt: string;
  }[];
};
type Folder = {
  id: string;
  name: string;
  documentCount: number;
};
type EditorValues = {
  title: string;
  body: string;
  status: "draft" | "ready";
  source: "manual" | "imported";
  sourceUrl?: string;
  folderId?: string;
  language: string;
  tags: string[];
  changeSummary?: string;
};

const statusMeta: Record<DocumentStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "gold" },
  ready: { label: "已定稿", color: "green" },
  archived: { label: "已归档", color: "default" },
};
const sourceMeta: Record<DocumentSource, { label: string; color: string }> = {
  manual: { label: "手工创作", color: "blue" },
  imported: { label: "外部导入", color: "cyan" },
  ai_generated: { label: "AI 生成", color: "purple" },
};
const languageOptions = [
  { label: "简体中文", value: "zh-CN" },
  { label: "繁体中文", value: "zh-TW" },
  { label: "English (US)", value: "en-US" },
  { label: "日本語", value: "ja-JP" },
];

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "操作失败");
  return body.data as T;
}

export function DocumentLibrary({
  scope,
  canWrite,
  canDelete,
  canPublish = true,
  refreshToken,
  onMessage,
}: {
  scope: Scope;
  canWrite: boolean;
  canDelete: boolean;
  canPublish?: boolean;
  refreshToken: string;
  onMessage: (message: string) => void;
}) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [total, setTotal] = useState(0);
  const [pagination, setPagination] = useState({ filterKey: "", page: 1 });
  const loadVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "active">(
    "active",
  );
  const [sourceFilter, setSourceFilter] = useState<DocumentSource | "all">(
    "all",
  );
  const [detail, setDetail] = useState<DocumentDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentDetail>();
  const [saving, setSaving] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder>();
  const [folderSaving, setFolderSaving] = useState(false);
  const [editorForm] = Form.useForm<EditorValues>();
  const [folderForm] = Form.useForm<{ name: string }>();
  const scopeParams = useMemo(
    () => ({
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
    }),
    [scope.brandId, scope.organizationId, scope.teamBindingId],
  );

  const filterKey = JSON.stringify([
    scopeParams,
    query,
    folderFilter,
    statusFilter,
    sourceFilter,
  ]);
  const page = pagination.filterKey === filterKey ? pagination.page : 1;
  const queryString = useMemo(() => {
    const values: Record<string, string> = {
      ...scopeParams,
      limit: "20",
      offset: String((page - 1) * 20),
    };
    if (query.trim()) values.q = query.trim();
    if (folderFilter === "unfiled") values.unfiled = "true";
    else if (folderFilter !== "all") values.folderId = folderFilter;
    if (statusFilter !== "active") values.status = statusFilter;
    if (sourceFilter !== "all") values.source = sourceFilter;
    return scopeQuery(values);
  }, [folderFilter, query, scopeParams, sourceFilter, statusFilter, page]);

  const load = useCallback(async () => {
    if (!scopeParams.brandId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [documentData, folderData] = await Promise.all([
        api<{ list: DocumentListItem[]; total: number }>(
          `/api/v1/content-documents?${queryString}`,
        ),
        api<Folder[]>(`/api/v1/content-folders?${scopeQuery(scopeParams)}`),
      ]);
      if (version !== loadVersion.current) return;
      setDocuments(documentData.list);
      setTotal(documentData.total);
      setFolders(folderData);
    } catch (error) {
      if (version === loadVersion.current)
        onMessage(error instanceof Error ? error.message : "文档库加载失败");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [onMessage, queryString, scopeParams]);

  useEffect(() => {
    void load();
    return () => {
      loadVersion.current += 1;
    };
  }, [load, refreshToken]);

  async function loadDetail(documentId: string) {
    setDetailLoading(true);
    try {
      const value = await api<DocumentDetail>(
        `/api/v1/content-documents/${documentId}?${scopeQuery(scopeParams)}`,
      );
      setDetail(value);
      return value;
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "文档读取失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreate(source: "manual" | "imported") {
    setEditing(undefined);
    editorForm.resetFields();
    editorForm.setFieldsValue({
      source,
      status: "draft",
      language: "zh-CN",
      tags: [],
      folderId:
        folderFilter !== "all" && folderFilter !== "unfiled"
          ? folderFilter
          : undefined,
    });
    setEditorOpen(true);
  }

  function openEdit(document: DocumentDetail) {
    setEditing(document);
    editorForm.setFieldsValue({
      title: document.title,
      body: document.body,
      status: document.status === "archived" ? "draft" : document.status,
      source: document.source === "imported" ? "imported" : "manual",
      sourceUrl: document.sourceUrl ?? undefined,
      folderId: document.folderId ?? undefined,
      language: document.language,
      tags: document.tags,
      changeSummary: "",
    });
    setEditorOpen(true);
  }

  async function saveDocument(values: EditorValues) {
    setSaving(true);
    try {
      const payload = {
        ...scopeParams,
        title: values.title,
        body: values.body ?? "",
        status: values.status,
        sourceUrl: values.sourceUrl || undefined,
        folderId: values.folderId ?? null,
        language: values.language,
        tags: values.tags ?? [],
        ...(editing
          ? { changeSummary: values.changeSummary || "编辑文档" }
          : { source: values.source }),
      };
      const saved = editing
        ? await api<DocumentDetail>(`/api/v1/content-documents/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await api<DocumentDetail>("/api/v1/content-documents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      setEditorOpen(false);
      onMessage(editing ? "文档已保存为新版本" : "文档已保存到内容库");
      await load();
      await loadDetail(saved.id);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "文档保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createFolder(values: { name: string }) {
    setFolderSaving(true);
    try {
      await api<Folder>(
        editingFolder
          ? `/api/v1/content-folders/${editingFolder.id}`
          : "/api/v1/content-folders",
        {
          method: editingFolder ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...scopeParams, name: values.name }),
        },
      );
      folderForm.resetFields();
      setFolderModalOpen(false);
      setEditingFolder(undefined);
      onMessage(editingFolder ? "文件夹已重命名" : "文件夹已创建");
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "文件夹创建失败");
    } finally {
      setFolderSaving(false);
    }
  }

  async function deleteFolder(folderId: string) {
    try {
      await api(
        `/api/v1/content-folders/${folderId}?${scopeQuery(scopeParams)}`,
        { method: "DELETE" },
      );
      if (folderFilter === folderId) setFolderFilter("all");
      onMessage("文件夹已删除，原有文档已移至未归档");
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "文件夹删除失败");
    }
  }

  async function archiveDocument(documentId: string) {
    try {
      await api(
        `/api/v1/content-documents/${documentId}?${scopeQuery(scopeParams)}`,
        { method: "DELETE" },
      );
      setDetail(undefined);
      onMessage("文档已归档，可通过状态筛选查看");
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "文档归档失败");
    }
  }

  async function restoreVersion(documentId: string, version: number) {
    try {
      await api(
        `/api/v1/content-documents/${documentId}/versions/${version}/restorations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...scopeParams,
            changeSummary: `恢复历史版本 v${version}`,
          }),
        },
      );
      onMessage(`已恢复 v${version}，并保存为最新版本`);
      await load();
      await loadDetail(documentId);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "版本恢复失败");
    }
  }

  const columns: TableColumnsType<DocumentListItem> = [
    {
      title: "文档",
      dataIndex: "title",
      render: (title: string, item) => (
        <Space direction="vertical" size={3}>
          <Space wrap>
            <Typography.Link onClick={() => void loadDetail(item.id)} strong>
              {title}
            </Typography.Link>
            <Tag color={statusMeta[item.status].color}>
              {statusMeta[item.status].label}
            </Tag>
            <Tag color={sourceMeta[item.source].color}>
              {sourceMeta[item.source].label}
            </Tag>
          </Space>
          <Typography.Text ellipsis style={{ maxWidth: 520 }} type="secondary">
            {item.bodyPreview || "暂无正文"}
          </Typography.Text>
          {item.tags.length ? (
            <Space size={[2, 2]} wrap>
              {item.tags.slice(0, 5).map((tag) => (
                <Tag bordered={false} key={tag}>
                  {tag}
                </Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: "文件夹",
      dataIndex: "folderName",
      responsive: ["lg"],
      width: 150,
      render: (value: string | null) => value ?? "未归档",
    },
    {
      title: "版本",
      dataIndex: "currentVersion",
      responsive: ["md"],
      width: 90,
      render: (value: number) => `v${value}`,
    },
    {
      title: "字数",
      dataIndex: "contentLength",
      responsive: ["xl"],
      width: 100,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: "最近更新",
      dataIndex: "updatedAt",
      responsive: ["lg"],
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 90,
      render: (_, item) => (
        <Button onClick={() => void loadDetail(item.id)} size="small">
          打开
        </Button>
      ),
    },
  ];

  const folderItems = [
    { id: "all", name: "全部文档", documentCount: total },
    { id: "unfiled", name: "未归档", documentCount: undefined },
    ...folders,
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="当前结果" value={total} suffix="篇" />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              title="草稿"
              value={documents.filter((item) => item.status === "draft").length}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic
              title="已定稿"
              value={documents.filter((item) => item.status === "ready").length}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="文件夹" value={folders.length} />
          </Card>
        </Col>
      </Row>

      <Row align="stretch" gutter={[16, 16]}>
        <Col xl={5} xs={24}>
          <Card
            extra={
              canWrite ? (
                <Button
                  icon={<FolderAddOutlined />}
                  onClick={() => {
                    setEditingFolder(undefined);
                    folderForm.resetFields();
                    setFolderModalOpen(true);
                  }}
                  size="small"
                  type="text"
                />
              ) : null
            }
            title="内容目录"
          >
            <List
              dataSource={folderItems}
              renderItem={(folder) => (
                <List.Item
                  actions={
                    !["all", "unfiled"].includes(folder.id) && canWrite
                      ? [
                          <Button
                            aria-label="重命名文件夹"
                            icon={<EditOutlined />}
                            key="edit"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingFolder(folder as Folder);
                              folderForm.setFieldsValue({ name: folder.name });
                              setFolderModalOpen(true);
                            }}
                            size="small"
                            type="text"
                          />,
                          ...(canDelete
                            ? [
                                <Popconfirm
                                  description="其中的文档会移至未归档。"
                                  key="delete"
                                  onConfirm={(event) => {
                                    event?.stopPropagation();
                                    void deleteFolder(folder.id);
                                  }}
                                  title="删除文件夹？"
                                >
                                  <Button
                                    aria-label="删除文件夹"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={(event) => event.stopPropagation()}
                                    size="small"
                                    type="text"
                                  />
                                </Popconfirm>,
                              ]
                            : []),
                        ]
                      : []
                  }
                  onClick={() => setFolderFilter(folder.id)}
                  style={{
                    background:
                      folderFilter === folder.id ? "#f0f5ff" : undefined,
                    borderRadius: 8,
                    cursor: "pointer",
                    marginBottom: 4,
                    paddingInline: 10,
                  }}
                >
                  <Space>
                    <FolderOpenOutlined />
                    <Typography.Text strong={folderFilter === folder.id}>
                      {folder.name}
                    </Typography.Text>
                  </Space>
                  {folder.documentCount !== undefined ? (
                    <Tag>{folder.documentCount}</Tag>
                  ) : null}
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xl={19} xs={24}>
          <Card
            extra={
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void load()}
                >
                  刷新
                </Button>
                <Button
                  disabled={!canWrite}
                  icon={<ImportOutlined />}
                  onClick={() => openCreate("imported")}
                >
                  导入文章
                </Button>
                <Button
                  disabled={!canWrite}
                  icon={<FileAddOutlined />}
                  onClick={() => openCreate("manual")}
                  type="primary"
                >
                  新建文档
                </Button>
              </Space>
            }
            title="企业文章库"
          >
            <Flex gap={10} style={{ marginBottom: 16 }} wrap>
              <Input.Search
                allowClear
                onSearch={setQuery}
                placeholder="搜索标题或正文"
                style={{ flex: "1 1 260px", maxWidth: 420 }}
              />
              <Select
                onChange={setStatusFilter}
                options={[
                  { label: "使用中的文档", value: "active" },
                  { label: "草稿", value: "draft" },
                  { label: "已定稿", value: "ready" },
                  { label: "已归档", value: "archived" },
                ]}
                style={{ width: 150 }}
                value={statusFilter}
              />
              <Select
                onChange={setSourceFilter}
                options={[
                  { label: "全部来源", value: "all" },
                  { label: "AI 生成", value: "ai_generated" },
                  { label: "手工创作", value: "manual" },
                  { label: "外部导入", value: "imported" },
                ]}
                style={{ width: 140 }}
                value={sourceFilter}
              />
            </Flex>
            <Table<DocumentListItem>
              columns={columns}
              dataSource={documents}
              loading={loading}
              locale={{
                emptyText: (
                  <Empty
                    description="当前目录还没有文档"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={{
                current: page,
                pageSize: 20,
                total,
                showSizeChanger: false,
                showTotal: (count) => `共 ${count} 篇`,
                onChange: (nextPage) =>
                  setPagination({ filterKey, page: nextPage }),
              }}
              rowKey="id"
              scroll={{ x: 900 }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => {
          setFolderModalOpen(false);
          setEditingFolder(undefined);
        }}
        open={folderModalOpen}
        title={editingFolder ? "重命名文件夹" : "新建文件夹"}
      >
        <Form
          form={folderForm}
          layout="vertical"
          onFinish={(values) => void createFolder(values)}
        >
          <Form.Item
            label="文件夹名称"
            name="name"
            rules={[{ required: true, max: 80 }]}
          >
            <Input autoFocus placeholder="例如：品牌案例" />
          </Form.Item>
          <Flex justify="flex-end">
            <Button htmlType="submit" loading={folderSaving} type="primary">
              {editingFolder ? "保存" : "创建"}
            </Button>
          </Flex>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setEditorOpen(false)}
        open={editorOpen}
        title={
          editing ? `编辑文档 · v${editing.currentVersion}` : "保存到文档库"
        }
        width={900}
      >
        <Form<EditorValues>
          form={editorForm}
          layout="vertical"
          onFinish={(values) => void saveDocument(values)}
        >
          <Row gutter={12}>
            <Col md={16} xs={24}>
              <Form.Item
                label="标题"
                name="title"
                rules={[{ required: true, max: 500 }]}
              >
                <Input placeholder="文章标题" />
              </Form.Item>
            </Col>
            <Col md={8} xs={24}>
              <Form.Item
                label="状态"
                name="status"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { label: "草稿", value: "draft" },
                    { label: "已定稿", value: "ready" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          {!editing ? (
            <Form.Item label="内容来源" name="source">
              <Select
                disabled
                options={[
                  { label: "手工创作", value: "manual" },
                  { label: "外部导入", value: "imported" },
                ]}
              />
            </Form.Item>
          ) : null}
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) =>
              previous.source !== current.source
            }
          >
            {({ getFieldValue }) =>
              getFieldValue("source") === "imported" ||
              editing?.source === "imported" ? (
                <Form.Item
                  label="来源链接"
                  name="sourceUrl"
                  rules={[{ required: !editing, type: "url" }]}
                >
                  <Input placeholder="https://example.com/article" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Row gutter={12}>
            <Col md={8} xs={24}>
              <Form.Item label="文件夹" name="folderId">
                <Select
                  allowClear
                  options={folders.map((folder) => ({
                    label: folder.name,
                    value: folder.id,
                  }))}
                  placeholder="未归档"
                />
              </Form.Item>
            </Col>
            <Col md={8} xs={24}>
              <Form.Item label="语言" name="language">
                <Select options={languageOptions} />
              </Form.Item>
            </Col>
            <Col md={8} xs={24}>
              <Form.Item label="标签" name="tags">
                <Select
                  maxCount={20}
                  mode="tags"
                  placeholder="输入后回车"
                  tokenSeparators={[",", "，"]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="正文" name="body" rules={[{ max: 500_000 }]}>
            <Input.TextArea
              placeholder="支持纯文本或 HTML 正文"
              rows={16}
              showCount
            />
          </Form.Item>
          {editing ? (
            <Form.Item
              label="版本说明"
              name="changeSummary"
              rules={[{ max: 500 }]}
            >
              <Input placeholder="例如：补充产品数据并调整结尾" />
            </Form.Item>
          ) : null}
          <Flex justify="flex-end">
            <Button htmlType="submit" loading={saving} type="primary">
              {editing ? "保存新版本" : "保存文档"}
            </Button>
          </Flex>
        </Form>
      </Modal>

      <Drawer
        loading={detailLoading}
        onClose={() => setDetail(undefined)}
        open={Boolean(detail)}
        title={detail?.title ?? "文档详情"}
        width={840}
      >
        {detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Flex justify="space-between" wrap gap={12}>
              <Space wrap>
                <Tag color={statusMeta[detail.status].color}>
                  {statusMeta[detail.status].label}
                </Tag>
                <Tag color={sourceMeta[detail.source].color}>
                  {sourceMeta[detail.source].label}
                </Tag>
                <Tag>v{detail.currentVersion}</Tag>
              </Space>
              <Space wrap>
                <Button
                  disabled={!canWrite}
                  icon={<EditOutlined />}
                  onClick={() => openEdit(detail)}
                >
                  编辑
                </Button>
                {canPublish && detail.status === "ready" ? (
                  <Button
                    href={`/dashboard/publication/new?${new URLSearchParams({ title: detail.title, sourceDocumentId: detail.id }).toString()}`}
                    icon={<SendOutlined />}
                    type="primary"
                  >
                    选择渠道发布
                  </Button>
                ) : null}
                {canDelete && detail.status !== "archived" ? (
                  <Popconfirm
                    description="归档后可在状态筛选中找回。"
                    onConfirm={() => void archiveDocument(detail.id)}
                    title="确认归档文档？"
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      归档
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            </Flex>
            <Descriptions
              column={2}
              items={[
                {
                  key: "folder",
                  label: "文件夹",
                  children: detail.folderName ?? "未归档",
                },
                { key: "language", label: "语言", children: detail.language },
                {
                  key: "updated",
                  label: "最近更新",
                  children: new Date(detail.updatedAt).toLocaleString("zh-CN"),
                },
                {
                  key: "sourceUrl",
                  label: "来源链接",
                  children: detail.sourceUrl ? (
                    <Typography.Link href={detail.sourceUrl} target="_blank">
                      打开原文
                    </Typography.Link>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
            {detail.tags.length ? (
              <Space size={[4, 4]} wrap>
                {detail.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            ) : null}
            <Card
              size="small"
              title={
                <Space>
                  <FileTextOutlined />
                  正文
                </Space>
              }
            >
              <Typography.Paragraph
                style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
              >
                {detail.body || "暂无正文"}
              </Typography.Paragraph>
            </Card>
            <Card
              size="small"
              title={
                <Space>
                  <HistoryOutlined />
                  版本记录
                </Space>
              }
            >
              <List
                dataSource={detail.versions}
                renderItem={(version) => (
                  <List.Item
                    actions={
                      version.version === detail.currentVersion || !canWrite
                        ? []
                        : [
                            <Popconfirm
                              key="restore"
                              onConfirm={() =>
                                void restoreVersion(detail.id, version.version)
                              }
                              title={`恢复 v${version.version}？`}
                              description="历史内容会保存为一个新的最新版本。"
                            >
                              <Button size="small">恢复此版本</Button>
                            </Popconfirm>,
                          ]
                    }
                  >
                    <List.Item.Meta
                      description={`${new Date(version.createdAt).toLocaleString("zh-CN")} · ${version.changeSummary || "内容更新"}`}
                      title={
                        <Space>
                          <Typography.Text strong>
                            v{version.version}
                          </Typography.Text>
                          <Tag color={statusMeta[version.status].color}>
                            {statusMeta[version.status].label}
                          </Tag>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
