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
  Alert,
  App,
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
  theme,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scopeQuery } from "../use-answerbit-scope";
import { AccessibleSelect } from "../../accessible-select";
import {
  readDocumentDrafts,
  removeDocumentDraft,
  saveDocumentDraft,
  type DocumentDraft,
} from "./document-draft";

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
  draft: { label: "草稿", color: "warning" },
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
  if (!response.ok)
    throw new DocumentApiError(
      body.error?.message ?? "操作失败",
      body.error?.code,
    );
  return body.data as T;
}

class DocumentApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
const isConflict = (error: unknown) =>
  error instanceof DocumentApiError &&
  error.code === "CONTENT_DOCUMENT_VERSION_CONFLICT";

export function DocumentLibrary({
  userId,
  scope,
  canWrite,
  canDelete,
  canPublish = true,
  refreshToken,
  onMessage,
}: {
  userId: string;
  scope: Scope;
  canWrite: boolean;
  canDelete: boolean;
  canPublish?: boolean;
  refreshToken: string;
  onMessage: (message: string) => void;
}) {
  const { token } = theme.useToken();
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
  const [editorInitialValues, setEditorInitialValues] =
    useState<Partial<EditorValues>>();
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorConflict, setEditorConflict] = useState(false);
  const [latestDocument, setLatestDocument] = useState<DocumentDetail>();
  const [conflictLoading, setConflictLoading] = useState(false);
  const [drafts, setDrafts] = useState<DocumentDraft[]>([]);
  const [recoveringDraft, setRecoveringDraft] = useState(false);
  const draftWarning = useRef(false);
  const mounted = useRef(true);
  const detailRead = useRef(0);
  const editorRead = useRef(0);
  const submitting = useRef(false);
  const { modal } = App.useApp();
  const [folderForm] = Form.useForm<{ name: string }>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailRead.current += 1;
      editorRead.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!editorOpen || !editorDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDirty, editorOpen]);
  const scopeParams = useMemo(
    () => ({
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
    }),
    [scope.brandId, scope.organizationId, scope.teamBindingId],
  );
  const draftScope = useMemo(
    () => ({ ...scopeParams, userId }),
    [scopeParams, userId],
  );
  useEffect(() => {
    setDrafts(readDocumentDrafts(draftScope));
  }, [draftScope]);
  function draftIdentity() {
    return {
      documentId: editing?.id,
      values: {
        source: editorForm.getFieldValue("source") ?? "manual",
      } as DocumentDraft["values"],
    };
  }
  function keepEditorDraft(values: EditorValues) {
    setEditorDirty(true);
    const stored = saveDocumentDraft(draftScope, {
      documentId: editing?.id,
      expectedVersion: editing?.currentVersion,
      updatedAt: Date.now(),
      values: {
        ...values,
        source:
          values.source ??
          (editing?.source === "imported" ? "imported" : "manual"),
      },
    });
    if (!stored && !draftWarning.current) {
      draftWarning.current = true;
      onMessage("浏览器无法暂存编辑，请保持页面打开并保存到文档库。");
    }
    return stored;
  }
  function forgetEditorDraft() {
    removeDocumentDraft(draftScope, draftIdentity());
    setDrafts(readDocumentDrafts(draftScope));
  }
  async function recoverDraft(draft: DocumentDraft) {
    if (recoveringDraft) return;
    const read = ++editorRead.current;
    setRecoveringDraft(true);
    try {
      const current = draft.documentId
        ? await api<DocumentDetail>(
            `/api/v1/content-documents/${draft.documentId}?${scopeQuery(scopeParams)}`,
          )
        : undefined;
      if (!mounted.current || read !== editorRead.current) return;
      setEditing(
        current
          ? { ...current, currentVersion: draft.expectedVersion! }
          : undefined,
      );
      setEditorInitialValues(draft.values);
      setEditorDirty(true);
      const changed = Boolean(
        current && current.currentVersion !== draft.expectedVersion,
      );
      setEditorConflict(changed);
      setLatestDocument(changed ? current : undefined);
      setEditorOpen(true);
    } catch (error) {
      if (mounted.current)
        onMessage(
          error instanceof Error
            ? error.message
            : "暂存编辑恢复失败，内容仍保留，可重试",
        );
    } finally {
      if (mounted.current) setRecoveringDraft(false);
    }
  }

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
    const read = ++detailRead.current;
    setDetailLoading(true);
    try {
      const value = await api<DocumentDetail>(
        `/api/v1/content-documents/${documentId}?${scopeQuery(scopeParams)}`,
      );
      if (!mounted.current || read !== detailRead.current) return;
      setDetail(value);
      return value;
    } catch (error) {
      if (mounted.current && read === detailRead.current)
        onMessage(error instanceof Error ? error.message : "文档读取失败");
    } finally {
      if (mounted.current && read === detailRead.current)
        setDetailLoading(false);
    }
  }

  function openCreate(source: "manual" | "imported") {
    const draft = readDocumentDrafts(draftScope).find(
      (item) => !item.documentId && item.values.source === source,
    );
    if (draft) {
      void recoverDraft(draft);
      return;
    }
    editorRead.current += 1;
    setConflictLoading(false);
    setEditorConflict(false);
    setLatestDocument(undefined);
    setEditing(undefined);
    setEditorInitialValues({
      source,
      status: "draft",
      language: "zh-CN",
      tags: [],
      folderId:
        folderFilter !== "all" && folderFilter !== "unfiled"
          ? folderFilter
          : undefined,
    });
    setEditorDirty(false);
    setEditorOpen(true);
  }

  function openEdit(document: DocumentDetail, useStoredDraft = true) {
    const draft =
      useStoredDraft &&
      readDocumentDrafts(draftScope).find(
        (item) => item.documentId === document.id,
      );
    if (draft) {
      void recoverDraft(draft);
      return;
    }
    editorRead.current += 1;
    setConflictLoading(false);
    setEditorConflict(false);
    setLatestDocument(undefined);
    setEditing(document);
    setEditorInitialValues({
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
    setEditorDirty(false);
    setEditorOpen(true);
  }
  useEffect(() => {
    if (!editorOpen) return;
    editorForm.resetFields();
    editorForm.setFieldsValue(editorInitialValues ?? {});
  }, [editorOpen, editorForm, editorInitialValues]);
  function closeEditor() {
    if (saving) return;
    if (!editorDirty) {
      editorRead.current += 1;
      return setEditorOpen(false);
    }
    modal.confirm({
      title: "放弃尚未保存的修改？",
      content: "关闭后本次编辑内容不会保存。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      okButtonProps: { danger: true },
      onOk: () => {
        editorRead.current += 1;
        forgetEditorDraft();
        setEditorDirty(false);
        setEditorOpen(false);
      },
    });
  }

  async function readLatestDocument() {
    if (!editing) return;
    const read = ++editorRead.current;
    setConflictLoading(true);
    try {
      const latest = await api<DocumentDetail>(
        `/api/v1/content-documents/${editing.id}?${scopeQuery(scopeParams)}`,
      );
      if (mounted.current && read === editorRead.current)
        setLatestDocument(latest);
    } catch (error) {
      if (mounted.current && read === editorRead.current)
        onMessage(
          error instanceof Error ? error.message : "最新文档读取失败，可重试",
        );
    } finally {
      if (mounted.current && read === editorRead.current)
        setConflictLoading(false);
    }
  }

  async function saveDocument(
    values: EditorValues,
    expectedVersion?: number,
    asCopy = false,
  ) {
    if (submitting.current) return;
    submitting.current = true;
    const submittedDraft = readDocumentDrafts(draftScope).find((draft) =>
      editing
        ? draft.documentId === editing.id
        : !draft.documentId && draft.values.source === values.source,
    );
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
        ...(editing && !asCopy
          ? {
              changeSummary: values.changeSummary || "编辑文档",
              expectedVersion: expectedVersion ?? editing.currentVersion,
            }
          : {
              source:
                values.source ??
                (editing?.source === "imported" ? "imported" : "manual"),
            }),
      };
      const saved =
        editing && !asCopy
          ? await api<DocumentDetail>(
              `/api/v1/content-documents/${editing.id}`,
              {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              },
            )
          : await api<DocumentDetail>("/api/v1/content-documents", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
      // Clear the old scope's draft even if navigation completed during saving.
      if (submittedDraft)
        removeDocumentDraft(draftScope, submittedDraft, submittedDraft);
      if (!mounted.current) return;
      setDrafts(readDocumentDrafts(draftScope));
      editorRead.current += 1;
      setEditorOpen(false);
      setEditorDirty(false);
      onMessage(
        asCopy
          ? "编辑内容已另存为新文档"
          : editing
            ? "文档已保存为新版本"
            : "文档已保存到内容库",
      );
      await load();
      await loadDetail(saved.id);
    } catch (error) {
      if (!mounted.current) return;
      if (isConflict(error)) {
        setEditorConflict(true);
        setLatestDocument(undefined);
        await readLatestDocument();
      }
      onMessage(
        error instanceof TypeError
          ? "连接中断，编辑内容已保留，请重试"
          : error instanceof Error
            ? error.message
            : "文档保存失败",
      );
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function saveMergedDocument() {
    if (!latestDocument) return;
    const values = await editorForm.validateFields().catch(() => undefined);
    if (!values) return;
    modal.confirm({
      title: `将当前编辑内容保存为 v${latestDocument.currentVersion + 1}？`,
      content: "请确认已核对最新内容并完成合并。最新版本会保留在历史记录中。",
      okText: "确认保存",
      cancelText: "继续核对",
      onOk: () => saveDocument(values, latestDocument.currentVersion),
    });
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
      if (!mounted.current) return;
      folderForm.resetFields();
      setFolderModalOpen(false);
      setEditingFolder(undefined);
      onMessage(editingFolder ? "文件夹已重命名" : "文件夹已创建");
      await load();
    } catch (error) {
      if (mounted.current)
        onMessage(error instanceof Error ? error.message : "文件夹创建失败");
    } finally {
      if (mounted.current) setFolderSaving(false);
    }
  }

  async function deleteFolder(folderId: string) {
    try {
      await api(
        `/api/v1/content-folders/${folderId}?${scopeQuery(scopeParams)}`,
        { method: "DELETE" },
      );
      if (!mounted.current) return;
      if (folderFilter === folderId) setFolderFilter("all");
      onMessage("文件夹已删除，原有文档已移至未归档");
      await load();
    } catch (error) {
      if (mounted.current)
        onMessage(error instanceof Error ? error.message : "文件夹删除失败");
    }
  }

  async function archiveDocument(document: DocumentDetail) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await api(
        `/api/v1/content-documents/${document.id}?${scopeQuery({ ...scopeParams, expectedVersion: String(document.currentVersion) })}`,
        { method: "DELETE" },
      );
      if (!mounted.current) return;
      setDetail(undefined);
      onMessage("文档已归档，可通过状态筛选查看");
      await load();
    } catch (error) {
      if (!mounted.current) return;
      onMessage(error instanceof Error ? error.message : "文档归档失败");
      if (isConflict(error)) await loadDetail(document.id);
    } finally {
      submitting.current = false;
    }
  }

  async function restoreVersion(documentId: string, version: number) {
    if (submitting.current || !detail) return;
    submitting.current = true;
    try {
      await api(
        `/api/v1/content-documents/${documentId}/versions/${version}/restorations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...scopeParams,
            expectedVersion: detail.currentVersion,
            changeSummary: `恢复历史版本 v${version}`,
          }),
        },
      );
      if (!mounted.current) return;
      onMessage(`已恢复 v${version}，并保存为最新版本`);
      await load();
      await loadDetail(documentId);
    } catch (error) {
      if (!mounted.current) return;
      onMessage(error instanceof Error ? error.message : "版本恢复失败");
      if (isConflict(error)) await loadDetail(documentId);
    } finally {
      submitting.current = false;
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
      {drafts.length && canWrite && !editorOpen ? (
        <Alert
          type="info"
          showIcon
          message="有尚未保存的编辑"
          description={
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text>
                暂存在当前浏览器标签页，保留 24 小时；恢复后再保存到文档库。
              </Typography.Text>
              {drafts.map((draft) => (
                <Flex
                  key={draft.documentId ?? draft.values.source}
                  gap={8}
                  align="center"
                  wrap
                >
                  <Typography.Text>
                    {draft.values.title || "未命名文档"}
                  </Typography.Text>
                  <Button
                    size="small"
                    loading={recoveringDraft}
                    onClick={() => void recoverDraft(draft)}
                  >
                    继续编辑
                  </Button>
                  <Popconfirm
                    title="丢弃这份暂存编辑？"
                    onConfirm={() => {
                      removeDocumentDraft(draftScope, draft);
                      setDrafts(readDocumentDrafts(draftScope));
                    }}
                  >
                    <Button size="small" danger>
                      丢弃暂存
                    </Button>
                  </Popconfirm>
                </Flex>
              ))}
            </Space>
          }
        />
      ) : null}
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
                      folderFilter === folder.id
                        ? token.colorPrimaryBg
                        : undefined,
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
                aria-label="筛选文档状态"
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
                aria-label="筛选文档来源"
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
        onCancel={closeEditor}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        open={editorOpen}
        title={
          editing ? `编辑文档 · v${editing.currentVersion}` : "保存到文档库"
        }
        width={900}
      >
        {editorConflict ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="文档已有新版本，你的编辑内容仍在这里"
            description={
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>
                  请核对最新内容并在下方合并，也可以另存为新文档。
                </Typography.Text>
                {latestDocument ? (
                  <details>
                    <summary>
                      查看最新版本 v{latestDocument.currentVersion}：
                      {latestDocument.title}
                    </summary>
                    <Typography.Paragraph
                      copyable
                      style={{
                        whiteSpace: "pre-wrap",
                        maxHeight: 240,
                        overflow: "auto",
                        marginTop: 12,
                      }}
                    >
                      {latestDocument.body || "暂无正文"}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary">
                      状态：{statusMeta[latestDocument.status].label} · 语言：
                      {latestDocument.language} · 标签：
                      {latestDocument.tags.join("、") || "无"} · 文件夹：
                      {latestDocument.folderName || "未归档"}
                    </Typography.Text>
                    {latestDocument.sourceUrl ? (
                      <Typography.Paragraph copyable>
                        {latestDocument.sourceUrl}
                      </Typography.Paragraph>
                    ) : null}
                  </details>
                ) : null}
                <Space wrap>
                  <Button
                    loading={conflictLoading}
                    disabled={saving}
                    onClick={() => void readLatestDocument()}
                  >
                    刷新最新内容
                  </Button>
                  <Button
                    disabled={!latestDocument || saving}
                    onClick={() => {
                      if (!latestDocument) return;
                      modal.confirm({
                        title: "载入最新版本？",
                        content: "当前未保存的编辑会被替换，可先另存为新文档。",
                        okText: "载入最新版本",
                        cancelText: "保留编辑",
                        onOk: () => {
                          forgetEditorDraft();
                          openEdit(latestDocument, false);
                        },
                      });
                    }}
                  >
                    载入最新版本
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() =>
                      void editorForm
                        .validateFields()
                        .then((values) => saveDocument(values, undefined, true))
                        .catch(() => {})
                    }
                  >
                    另存为新文档
                  </Button>
                </Space>
              </Space>
            }
          />
        ) : null}
        <Form<EditorValues>
          form={editorForm}
          layout="vertical"
          onFinish={(values) =>
            editorConflict
              ? void saveMergedDocument()
              : void saveDocument(values)
          }
          onValuesChange={(_, values) => keepEditorDraft(values)}
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
                <AccessibleSelect
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
          <Flex justify="space-between" gap={8} wrap>
            <Button
              disabled={saving || !editorDirty}
              onClick={() => {
                if (keepEditorDraft(editorForm.getFieldsValue())) {
                  editorRead.current += 1;
                  setDrafts(readDocumentDrafts(draftScope));
                  setEditorOpen(false);
                }
              }}
            >
              暂存并关闭
            </Button>
            <Button
              htmlType="submit"
              loading={saving}
              disabled={editorConflict && !latestDocument}
              type="primary"
            >
              {editorConflict
                ? "合并后保存新版本"
                : editing
                  ? "保存新版本"
                  : "保存文档"}
            </Button>
          </Flex>
        </Form>
      </Modal>

      <Drawer
        loading={detailLoading}
        onClose={() => {
          detailRead.current += 1;
          setDetail(undefined);
          setDetailLoading(false);
        }}
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
                {canPublish && canWrite && detail.status === "ready" ? (
                  <Button
                    href={`/dashboard/publication/new?${new URLSearchParams({ organizationId: scope.organizationId, brandId: scope.brandId, title: detail.title, sourceDocumentId: detail.id }).toString()}`}
                    icon={<SendOutlined />}
                    type="primary"
                  >
                    选择渠道发布
                  </Button>
                ) : null}
                {canDelete && detail.status !== "archived" ? (
                  <Popconfirm
                    description="归档后可在状态筛选中找回。"
                    onConfirm={() => void archiveDocument(detail)}
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
