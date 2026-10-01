"use client";

import {
  CrownOutlined,
  LockOutlined,
  SearchOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibleTable } from "../../../accessible-table";

type Access = {
  id: string;
  brandId: string;
  role: string;
};

type Member = {
  id: string;
  name: string;
  username: string | null;
  status: string;
  joinedAt: string | null;
  organizationRoles: string[];
  brandAccess: Access[];
};

type MemberForm = {
  name?: string;
  username: string;
  password?: string;
  role: string;
};

type ApiEnvelope<T> = {
  data: T;
  error?: { message?: string };
};

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const roleMeta: Record<
  string,
  { label: string; short: string; color: string; description: string }
> = {
  tenant_admin: {
    label: "企业管理员",
    short: "企业级",
    color: "blue",
    description: "管理成员、企业设置、余额划分及全部品牌业务。",
  },
  brand_admin: {
    label: "品牌管理员",
    short: "管理",
    color: "blue",
    description: "管理指定品牌资源，可创建发布单和导出报告。",
  },
  brand_editor: {
    label: "品牌编辑",
    short: "编辑",
    color: "geekblue",
    description: "编辑指定品牌资源并创建发布单。",
  },
  brand_viewer: {
    label: "品牌只读",
    short: "只读",
    color: "default",
    description: "只读访问指定品牌的数据、余额与通知。",
  },
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok)
    throw new RequestError(
      body.error?.message ?? `请求失败（${response.status}）`,
      response.status,
    );
  return body.data;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function MemberSettings({
  organizationId,
  organizationName,
  brandId,
  brandName,
}: {
  organizationId: string;
  organizationName: string;
  brandId: string;
  brandName: string;
}) {
  const screens = Grid.useBreakpoint();
  const compactTable = !screens.md;
  const [memberForm] = Form.useForm<MemberForm>();
  const [accessForm] = Form.useForm<MemberForm>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [success, setSuccess] = useState("");
  const busy = useRef(false);
  const pendingVerification = useRef<((rows: Member[]) => boolean) | null>(
    null,
  );
  const [needsVerification, setNeedsVerification] = useState(false);
  function clearVerification() {
    pendingVerification.current = null;
    setNeedsVerification(false);
  }
  const mounted = useRef(true);
  const readController = useRef<AbortController | null>(null);
  const [confirmation, setConfirmation] = useState<{
    key: string;
    memberLabel: string;
    title: string;
    description: string;
    okText: string;
    danger: boolean;
    success: string;
    task: () => Promise<void>;
    verify: (rows: Member[]) => boolean;
  } | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [accessMember, setAccessMember] = useState<Member | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRole, setSelectedRole] = useState("brand_viewer");
  const [accountMode, setAccountMode] = useState<"create" | "existing">(
    "create",
  );

  const load = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setReadError("");
    try {
      const result = await request<{ members: Member[] }>(
        `/api/v1/organizations/${organizationId}/members`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !mounted.current) return;
      setMembers(result.members);
    } catch (reason) {
      if (controller.signal.aborted || !mounted.current) return;
      setReadError(
        reason instanceof Error ? reason.message : "成员数据加载失败",
      );
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      readController.current?.abort();
    };
  }, [load]);

  const runAction = useCallback(
    async (
      key: string,
      successMessage: string,
      task: () => Promise<void>,
      verify?: (rows: Member[]) => boolean,
    ) => {
      if (busy.current) return false;
      busy.current = true;
      setAction(key);
      setError("");
      setSuccess("");
      try {
        if (pendingVerification.current) {
          try {
            const result = await request<{ members: Member[] }>(
              `/api/v1/organizations/${organizationId}/members`,
            );
            if (!mounted.current) return false;
            setMembers(result.members);
            setReadError("");
            const confirmed = pendingVerification.current(result.members);
            pendingVerification.current = null;
            setNeedsVerification(false);
            if (!confirmed) {
              setError("未查到已完成的变更，请再次确认提交。");
              return false;
            }
            setSuccess(successMessage);
            await load();
            return mounted.current;
          } catch (reason) {
            if (mounted.current)
              setError(
                reason instanceof Error
                  ? reason.message
                  : "结果核对失败，请重试核对",
              );
            return false;
          }
        }
        try {
          await task();
        } catch (reason) {
          // A failed response can follow a successful write. Read the directory
          // before offering another submission; never issue a second write here.
          let confirmed = false;
          if (
            verify &&
            mounted.current &&
            (!(reason instanceof RequestError) || reason.status >= 500)
          ) {
            try {
              const result = await request<{ members: Member[] }>(
                `/api/v1/organizations/${organizationId}/members`,
              );
              if (!mounted.current) return false;
              setMembers(result.members);
              setReadError("");
              confirmed = verify(result.members);
            } catch (readReason) {
              if (mounted.current) {
                pendingVerification.current = verify;
                setNeedsVerification(true);
                setReadError(
                  readReason instanceof Error
                    ? readReason.message
                    : "成员数据加载失败",
                );
              }
            }
          }
          if (!confirmed) {
            if (mounted.current)
              setError(
                pendingVerification.current
                  ? "提交结果尚未核实，请先核对结果，避免重复操作。"
                  : reason instanceof Error
                    ? reason.message
                    : "操作失败，请重试",
              );
            return false;
          }
        }
        if (!mounted.current) return false;
        setSuccess(successMessage);
        await load();
        return mounted.current;
      } finally {
        busy.current = false;
        if (mounted.current) setAction("");
      }
    },
    [load, organizationId],
  );

  function openMemberModal() {
    setError("");
    setAccountMode("create");
    setSelectedRole("brand_viewer");
    setMemberOpen(true);
  }

  useEffect(() => {
    if (!memberOpen) return;
    memberForm.resetFields();
  }, [memberForm, memberOpen]);

  async function addMember() {
    if (busy.current) return;
    let values: MemberForm;
    try {
      values = await memberForm.validateFields();
    } catch {
      return;
    }
    const username = values.username.trim().toLowerCase();
    const existed = members.some((member) => member.username === username);
    const completed = await runAction(
      "add-member",
      accountMode === "create"
        ? "客户账号已创建并加入企业"
        : "账号已加入企业，权限立即生效",
      async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members`,
          jsonRequest("POST", {
            username,
            role: values.role,
            ...(accountMode === "create"
              ? { name: values.name?.trim(), password: values.password }
              : {}),
          }),
        );
      },
      (rows) =>
        rows.some(
          (member) =>
            member.username === username &&
            member.status === "active" &&
            (accountMode !== "create" ||
              (!existed && member.name === values.name?.trim())) &&
            (values.role === "tenant_admin"
              ? member.organizationRoles.includes("tenant_admin")
              : member.brandAccess.some(
                  (access) =>
                    access.brandId === brandId && access.role === values.role,
                )),
        ),
    );
    if (completed) {
      memberForm.resetFields();
      setMemberOpen(false);
    }
  }

  function openAccessModal(member: Member) {
    setError("");
    setAccessMember(member);
  }

  useEffect(() => {
    if (!accessMember) return;
    accessForm.setFieldsValue({
      role:
        accessMember.brandAccess.find((access) => access.brandId === brandId)
          ?.role ?? "brand_viewer",
    });
  }, [accessForm, accessMember, brandId]);

  async function addAccess() {
    if (!accessMember || busy.current) return;
    let values: MemberForm;
    try {
      values = await accessForm.validateFields();
    } catch {
      return;
    }
    const memberId = accessMember.id;
    const completed = await runAction(
      `add-access-${memberId}`,
      "品牌访问范围已更新",
      async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${memberId}/brand-access`,
          jsonRequest("POST", { role: values.role }),
        );
      },
      (rows) =>
        rows.some(
          (member) =>
            member.id === memberId &&
            member.brandAccess.some(
              (access) =>
                access.brandId === brandId && access.role === values.role,
            ),
        ),
    );
    if (completed) setAccessMember(null);
  }

  function confirmToggle(member: Member) {
    const status = member.status === "active" ? "disabled" : "active";
    setError("");
    setConfirmation({
      memberLabel: `${member.name}${member.username ? `（@${member.username}）` : ""}`,
      key: `status-${member.id}`,
      title: status === "disabled" ? "停用这个成员？" : "恢复这个成员？",
      description:
        status === "disabled"
          ? "停用后现有会话中的企业权限立即失效，历史数据和审计记录仍会保留。"
          : "恢复后将重新获得已分配的企业与品牌权限。",
      okText: status === "disabled" ? "确认停用" : "确认恢复",
      danger: status === "disabled",
      success: status === "active" ? "成员已恢复" : "成员已停用",
      task: async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${member.id}`,
          jsonRequest("PATCH", { status }),
        );
      },
      verify: (rows) =>
        rows.some((row) => row.id === member.id && row.status === status),
    });
  }

  function confirmRemove(member: Member) {
    setError("");
    setConfirmation({
      memberLabel: `${member.name}${member.username ? `（@${member.username}）` : ""}`,
      key: `remove-${member.id}`,
      title: "从企业移除这个成员？",
      description:
        "企业成员关系及其全部品牌权限将被移除，账号本身仍由平台保留。",
      okText: "确认移除",
      danger: true,
      success: "成员已从企业移除",
      task: async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${member.id}`,
          { method: "DELETE" },
        );
      },
      verify: (rows) => !rows.some((row) => row.id === member.id),
    });
  }

  function confirmRemoveAccess(member: Member, access: Access) {
    setError("");
    setConfirmation({
      memberLabel: `${member.name}${member.username ? `（@${member.username}）` : ""}`,
      key: `remove-access-${access.id}`,
      title: "移除这个品牌权限？",
      description: `${member.name} 将不再能够访问品牌 ${access.brandId}。`,
      okText: "移除权限",
      danger: true,
      success: "品牌权限已移除",
      task: async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${member.id}/brand-access/${access.id}`,
          { method: "DELETE" },
        );
      },
      verify: (rows) =>
        !rows.some(
          (row) =>
            row.id === member.id &&
            row.brandAccess.some((item) => item.id === access.id),
        ),
    });
  }

  async function submitConfirmation() {
    if (!confirmation || busy.current) return;
    const completed = await runAction(
      confirmation.key,
      confirmation.success,
      confirmation.task,
      confirmation.verify,
    );
    if (completed) setConfirmation(null);
  }

  const filteredMembers = members.filter((member) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery =
      !normalizedQuery ||
      member.name.toLowerCase().includes(normalizedQuery) ||
      (member.username ?? "").toLowerCase().includes(normalizedQuery);
    const matchesStatus =
      statusFilter === "all" || member.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const activeMemberCount = members.filter(
    (member) => member.status === "active",
  ).length;
  const administratorCount = members.filter(
    (member) =>
      member.status === "active" &&
      member.organizationRoles.includes("tenant_admin"),
  ).length;
  const scopedMemberCount = members.filter(
    (member) => member.brandAccess.length > 0,
  ).length;

  const columns: TableColumnsType<Member> = [
    {
      title: "成员",
      key: "member",
      width: compactTable ? 160 : 250,
      render: (_, member) => (
        <Space size={12}>
          <Avatar size={compactTable ? 32 : 40}>
            {member.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{member.name}</Typography.Text>
            {!compactTable ? (
              <Typography.Text type="secondary">
                {"@" + (member.username ?? "legacy")}
              </Typography.Text>
            ) : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "企业角色",
      dataIndex: "organizationRoles",
      responsive: ["md"],
      width: 170,
      render: (roles: string[]) =>
        roles.length ? (
          <Space size={[0, 4]} wrap>
            {roles.map((role) => (
              <Tag color={roleMeta[role]?.color} key={role}>
                {roleMeta[role]?.label ?? role}
              </Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">品牌范围成员</Typography.Text>
        ),
    },
    {
      title: "品牌数据范围",
      dataIndex: "brandAccess",
      responsive: ["md"],
      width: 380,
      render: (accesses: Access[], member) =>
        accesses.length ? (
          <Space direction="vertical" size={4}>
            {accesses.map((access) => (
              <Tag
                closable={!action && !loading && !readError}
                color={roleMeta[access.role]?.color}
                key={access.id}
                onClose={(event) => {
                  event.preventDefault();
                  confirmRemoveAccess(member, access);
                }}
              >
                {"品牌 " +
                  access.brandId +
                  " / " +
                  (roleMeta[access.role]?.short ?? access.role)}
              </Tag>
            ))}
          </Space>
        ) : member.organizationRoles.includes("tenant_admin") ? (
          <Tag color="blue" icon={<CrownOutlined />}>
            全企业范围
          </Tag>
        ) : (
          <Typography.Text type="secondary">尚未分配品牌</Typography.Text>
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      responsive: ["md"],
      width: 110,
      render: (status: string) => (
        <Tag color={status === "active" ? "success" : "default"}>
          {status === "active" ? "正常" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: compactTable ? 156 : 320,
      render: (_, member) => {
        const isAdministrator =
          member.organizationRoles.includes("tenant_admin");
        return (
          <Space size={[8, 8]} wrap>
            <Button
              aria-label={"配置 " + member.name + " 的品牌权限"}
              disabled={
                isAdministrator ||
                !brandId ||
                Boolean(action) ||
                loading ||
                Boolean(readError)
              }
              icon={<LockOutlined />}
              onClick={() => openAccessModal(member)}
            >
              {compactTable ? null : "配置权限"}
            </Button>
            <Button
              aria-label={
                (member.status === "active" ? "停用成员 " : "恢复成员 ") +
                member.name
              }
              disabled={Boolean(action) || loading || Boolean(readError)}
              icon={<UserSwitchOutlined />}
              onClick={() => confirmToggle(member)}
            >
              {compactTable
                ? null
                : member.status === "active"
                  ? "停用"
                  : "恢复"}
            </Button>
            <Button
              aria-label={"将成员 " + member.name + " 移出企业"}
              danger
              disabled={Boolean(action) || loading || Boolean(readError)}
              icon={<UserDeleteOutlined />}
              onClick={() => confirmRemove(member)}
            >
              {compactTable ? null : "移出企业"}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic
              prefix={<TeamOutlined />}
              suffix="人"
              title="有效成员"
              value={activeMemberCount}
            />
            <Typography.Text type="secondary">
              共 {members.length} 个企业成员
            </Typography.Text>
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic
              prefix={<CrownOutlined />}
              suffix="人"
              title="企业管理员"
              value={administratorCount}
            />
            <Typography.Text type="secondary">始终至少保留一名</Typography.Text>
          </Card>
        </Col>
        <Col lg={8} sm={24} xs={24}>
          <Card>
            <Statistic
              prefix={<LockOutlined />}
              suffix="人"
              title="品牌范围成员"
              value={scopedMemberCount}
            />
            <Typography.Text type="secondary">按企业品牌隔离</Typography.Text>
          </Card>
        </Col>
      </Row>

      {success ? (
        <Alert
          type="success"
          showIcon
          message={success}
          closable
          onClose={() => setSuccess("")}
        />
      ) : null}
      {readError ? (
        <Alert
          type="error"
          showIcon
          message="成员目录加载失败"
          description={readError}
          action={
            <Button
              onClick={() => void load()}
              disabled={Boolean(action)}
              loading={loading}
              aria-label="重试加载成员"
            >
              重试加载成员
            </Button>
          }
        />
      ) : null}

      <Card
        extra={
          <Button
            aria-label="添加成员"
            disabled={loading || Boolean(readError) || Boolean(action)}
            icon={<UserAddOutlined />}
            onClick={openMemberModal}
            type="primary"
          >
            添加成员
          </Button>
        }
        title="成员目录"
      >
        <Flex gap={12} style={{ marginBottom: 16 }} wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load()}
            loading={loading}
            disabled={Boolean(action)}
            aria-label="刷新成员"
          >
            刷新成员
          </Button>
          <Input
            allowClear
            aria-label="搜索姓名或登录账号"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或登录账号"
            prefix={<SearchOutlined />}
            style={{ maxWidth: 320 }}
            value={query}
          />
          <Select
            aria-label="按成员状态筛选"
            onChange={setStatusFilter}
            options={[
              { label: "全部状态", value: "all" },
              { label: "正常", value: "active" },
              { label: "已停用", value: "disabled" },
            ]}
            style={{ width: 140 }}
            value={statusFilter}
          />
        </Flex>
        <AccessibleTable<Member>
          scrollRegionLabel="企业成员目录"
          loading={loading}
          columns={columns}
          dataSource={filteredMembers}
          locale={{
            emptyText: (
              <Empty
                description={
                  members.length ? "没有匹配的成员" : "当前企业还没有成员"
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={
            filteredMembers.length > 10
              ? { pageSize: 10, showSizeChanger: false }
              : false
          }
          rowKey="id"
          scroll={{ x: compactTable ? 620 : 1200 }}
        />
      </Card>

      <Modal
        forceRender
        cancelText="取消"
        confirmLoading={action === "add-member"}
        maskClosable={!action}
        okText={needsVerification ? "核对操作结果" : "添加并授权"}
        okButtonProps={{
          disabled: Boolean(action),
          "aria-label": needsVerification ? "核对操作结果" : "添加并授权",
        }}
        onCancel={() => {
          if (!action) {
            clearVerification();
            setMemberOpen(false);
          }
        }}
        onOk={() => void addMember()}
        open={memberOpen}
        title={
          <Space>
            <UserAddOutlined aria-hidden />
            添加企业成员
          </Space>
        }
        width={760}
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            message="添加成员未完成"
            description={error}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Typography.Paragraph type="secondary">
          当前企业：{organizationName}
        </Typography.Paragraph>
        <Segmented
          disabled={Boolean(action) || needsVerification}
          block
          onChange={(value) => {
            setAccountMode(value as "create" | "existing");
            setSelectedRole("brand_viewer");
            memberForm.setFieldValue("role", "brand_viewer");
          }}
          options={[
            { label: "创建客户账号", value: "create" },
            { label: "绑定已有账号", value: "existing" },
          ]}
          value={accountMode}
        />
        <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">
          {accountMode === "create"
            ? "填写登录信息并选择品牌权限，保存后账号即可登录。请将初始密码私下交给成员。"
            : "输入已有账号并授权。代理商账号由平台管理员创建，绑定为企业管理员后即可负责本企业。"}
        </Typography.Paragraph>
        <Form
          disabled={Boolean(action) || needsVerification}
          form={memberForm}
          name="member-account"
          initialValues={{ role: "brand_viewer" }}
          layout="vertical"
          onFinish={() => void addMember()}
          requiredMark="optional"
          size="large"
        >
          {accountMode === "create" ? (
            <Form.Item
              label="成员姓名"
              name="name"
              preserve={false}
              rules={[
                {
                  required: true,
                  min: 2,
                  max: 80,
                  message: "请输入 2–80 字的成员姓名",
                },
              ]}
            >
              <Input
                autoComplete="name"
                placeholder="例如：张三"
                size="large"
              />
            </Form.Item>
          ) : null}
          <Form.Item
            label="登录账号"
            name="username"
            normalize={(value: string) => value.trim().toLowerCase()}
            rules={[
              { required: true, message: "请输入登录账号" },
              {
                pattern: /^[a-z][a-z0-9_]{2,31}$/,
                message: "账号需以字母开头，只能包含小写字母、数字和下划线",
              },
            ]}
          >
            <Input
              autoComplete={
                accountMode === "create" ? "new-username" : "username"
              }
              placeholder="例如：brand_operator"
              size="large"
            />
          </Form.Item>
          {accountMode === "create" ? (
            <Form.Item
              extra="至少 12 位，包含字母和数字。"
              label="初始密码"
              name="password"
              preserve={false}
              rules={[
                { required: true, message: "请输入初始密码" },
                { min: 12, max: 128, message: "密码长度须为 12–128 位" },
                {
                  validator: async (_, value: string) => {
                    if (value && (!/[A-Za-z]/.test(value) || !/\d/.test(value)))
                      throw new Error("密码必须同时包含字母和数字");
                  },
                },
              ]}
            >
              <Input.Password autoComplete="new-password" size="large" />
            </Form.Item>
          ) : null}
          <Form.Item label="职责角色" name="role" rules={[{ required: true }]}>
            <Select
              onChange={setSelectedRole}
              options={Object.entries(roleMeta)
                .filter(
                  ([value]) =>
                    accountMode === "existing" || value !== "tenant_admin",
                )
                .map(([value, item]) => ({ value, label: item.label }))}
              size="large"
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {roleMeta[selectedRole]?.description}
            {selectedRole !== "tenant_admin"
              ? ` 权限应用到 ${brandName}（${brandId}）。`
              : ""}
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Modal
        forceRender
        cancelText="取消"
        confirmLoading={action.startsWith("add-access-")}
        maskClosable={!action}
        okText={needsVerification ? "核对操作结果" : "保存权限"}
        okButtonProps={{
          disabled: Boolean(action),
          "aria-label": needsVerification ? "核对操作结果" : "保存权限",
        }}
        onCancel={() => {
          if (!action) {
            clearVerification();
            setAccessMember(null);
          }
        }}
        onOk={() => void addAccess()}
        open={Boolean(accessMember)}
        title={
          <Space>
            <LockOutlined aria-hidden />
            配置品牌权限
          </Space>
        }
        width={720}
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            message="保存权限未完成"
            description={error}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Typography.Paragraph type="secondary">
          为 {accessMember?.name} 添加或更新一个品牌数据范围。
        </Typography.Paragraph>
        <Form
          disabled={Boolean(action) || needsVerification}
          form={accessForm}
          name="member-brand-access"
          initialValues={{ role: "brand_viewer" }}
          layout="vertical"
          onFinish={() => void addAccess()}
          size="large"
        >
          <Form.Item label="品牌角色" name="role" rules={[{ required: true }]}>
            <Select
              options={Object.entries(roleMeta)
                .filter(([value]) => value !== "tenant_admin")
                .map(([value, item]) => ({ value, label: item.label }))}
              size="large"
            />
          </Form.Item>
          <Typography.Text type="secondary">
            应用范围：{brandName}（{brandId}）
          </Typography.Text>
        </Form>
      </Modal>
      <Modal
        open={Boolean(confirmation)}
        title={confirmation?.title}
        okText={needsVerification ? "核对操作结果" : confirmation?.okText}
        okButtonProps={{
          danger: confirmation?.danger,
          disabled: Boolean(action),
          "aria-label": needsVerification
            ? "核对操作结果"
            : confirmation?.okText,
        }}
        confirmLoading={Boolean(action)}
        cancelText="取消"
        maskClosable={!action}
        onCancel={() => {
          if (!action) {
            clearVerification();
            setConfirmation(null);
          }
        }}
        onOk={() => void submitConfirmation()}
        width={640}
      >
        <Typography.Paragraph strong>
          {confirmation?.memberLabel}
        </Typography.Paragraph>
        <Typography.Paragraph>{confirmation?.description}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          当前企业：{organizationName}
        </Typography.Paragraph>
        {error ? (
          <Alert
            type="error"
            showIcon
            message="操作未完成"
            description={error}
          />
        ) : null}
      </Modal>
    </Space>
  );
}
