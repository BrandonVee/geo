"use client";

import {
  CrownOutlined,
  LockOutlined,
  SearchOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
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
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useState } from "react";

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
  username: string;
  role: string;
};

type ApiEnvelope<T> = {
  data: T;
  error?: { message?: string };
};

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
    color: "cyan",
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
    throw new Error(body.error?.message ?? `请求失败（${response.status}）`);
  return body.data;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function MemberSettings({
  organizationId,
  brandId,
  brandName,
}: {
  organizationId: string;
  organizationName: string;
  brandId: string;
  brandName: string;
}) {
  const { message, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const compactTable = !screens.md;
  const [memberForm] = Form.useForm<MemberForm>();
  const [accessForm] = Form.useForm<MemberForm>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [accessMember, setAccessMember] = useState<Member | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRole, setSelectedRole] = useState("brand_viewer");

  const load = useCallback(
    async (showSkeleton = true) => {
      if (showSkeleton) setLoading(true);
      setError("");
      try {
        const memberData = await request<{ members: Member[] }>(
          `/api/v1/organizations/${organizationId}/members`,
        );
        setMembers(memberData.members);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "成员数据加载失败");
      } finally {
        setLoading(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (key: string, successMessage: string, task: () => Promise<void>) => {
      setAction(key);
      setError("");
      try {
        await task();
        message.success(successMessage);
        await load(false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      } finally {
        setAction("");
      }
    },
    [load, message],
  );

  function openMemberModal() {
    setSelectedRole("brand_viewer");
    setMemberOpen(true);
  }

  useEffect(() => {
    if (!memberOpen) return;
    memberForm.resetFields();
  }, [memberForm, memberOpen]);

  async function addMember() {
    const values = await memberForm.validateFields();
    await runAction("add-member", "账号已加入企业，权限立即生效", async () => {
      await request(
        `/api/v1/organizations/${organizationId}/members`,
        jsonRequest("POST", {
          username: values.username.trim().toLowerCase(),
          role: values.role,
        }),
      );
      memberForm.resetFields();
      setMemberOpen(false);
    });
  }

  function openAccessModal(member: Member) {
    setAccessMember(member);
  }

  useEffect(() => {
    if (!accessMember) return;
    accessForm.resetFields();
  }, [accessForm, accessMember]);

  async function addAccess() {
    if (!accessMember) return;
    const values = await accessForm.validateFields();
    await runAction(
      `add-access-${accessMember.id}`,
      "品牌访问范围已更新",
      async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${accessMember.id}/brand-access`,
          jsonRequest("POST", {
            role: values.role,
          }),
        );
        accessForm.resetFields();
        setAccessMember(null);
      },
    );
  }

  async function toggleMember(member: Member) {
    const status = member.status === "active" ? "disabled" : "active";
    await runAction(
      `status-${member.id}`,
      status === "active" ? "成员已恢复" : "成员已停用",
      async () => {
        await request(
          `/api/v1/organizations/${organizationId}/members/${member.id}`,
          jsonRequest("PATCH", { status }),
        );
      },
    );
  }

  function confirmToggle(member: Member) {
    modal.confirm({
      title: member.status === "active" ? "停用这个成员？" : "恢复这个成员？",
      content:
        member.status === "active"
          ? "停用后现有会话中的企业权限立即失效，历史数据和审计记录仍会保留。"
          : "恢复后将重新获得已分配的企业与品牌权限。",
      okText: member.status === "active" ? "确认停用" : "确认恢复",
      okButtonProps: { danger: member.status === "active" },
      cancelText: "取消",
      onOk: () => toggleMember(member),
    });
  }

  function confirmRemove(member: Member) {
    modal.confirm({
      title: "从企业移除这个成员？",
      content: "企业成员关系及其全部品牌权限将被移除，账号本身仍由平台保留。",
      okText: "确认移除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () =>
        runAction(`remove-${member.id}`, "成员已从企业移除", async () => {
          await request(
            `/api/v1/organizations/${organizationId}/members/${member.id}`,
            { method: "DELETE" },
          );
        }),
    });
  }

  function confirmRemoveAccess(member: Member, access: Access) {
    modal.confirm({
      title: "移除这个品牌权限？",
      content: `${member.name} 将不再能够访问品牌 ${access.brandId}。`,
      okText: "移除权限",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () =>
        runAction(`remove-access-${access.id}`, "品牌权限已移除", async () => {
          await request(
            `/api/v1/organizations/${organizationId}/members/${member.id}/brand-access/${access.id}`,
            { method: "DELETE" },
          );
        }),
    });
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
  const administratorCount = members.filter((member) =>
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
                closable
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
              disabled={isAdministrator || !brandId}
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

  if (loading) {
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Skeleton active paragraph={{ rows: 3 }} />
        </Card>
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      </Space>
    );
  }

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

      {error ? (
        <Alert
          action={
            <Button onClick={() => void load()} size="small">
              重试
            </Button>
          }
          closable
          description={error}
          message="成员设置操作未完成"
          onClose={() => setError("")}
          showIcon
          type="error"
        />
      ) : null}

      <Card
        extra={
          <Button
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
          <Input
            allowClear
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
        <Table<Member>
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
        cancelText="取消"
        confirmLoading={action === "add-member"}
        maskClosable={!action}
        okText="添加并授权"
        onCancel={() => !action && setMemberOpen(false)}
        onOk={() => void addMember()}
        open={memberOpen}
        title={
          <Space>
            <UserAddOutlined />
            添加企业成员
          </Space>
        }
        width={760}
      >
        <Typography.Paragraph type="secondary">
          输入平台已创建的登录账号，并授予最小必要权限。
        </Typography.Paragraph>
        <Form
          form={memberForm}
          initialValues={{ role: "brand_viewer" }}
          layout="vertical"
          onFinish={() => void addMember()}
          requiredMark="optional"
          size="large"
        >
          <Form.Item
            extra="新账号需先由平台管理员在平台管理端创建。"
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
            <Input placeholder="例如：brand_operator" size="large" />
          </Form.Item>
          <Form.Item label="职责角色" name="role" rules={[{ required: true }]}>
            <Select
              onChange={setSelectedRole}
              options={Object.entries(roleMeta).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
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
        cancelText="取消"
        confirmLoading={action.startsWith("add-access-")}
        maskClosable={!action}
        okText="保存权限"
        onCancel={() => !action && setAccessMember(null)}
        onOk={() => void addAccess()}
        open={Boolean(accessMember)}
        title={
          <Space>
            <LockOutlined />
            配置品牌权限
          </Space>
        }
        width={720}
      >
        <Typography.Paragraph type="secondary">
          为 {accessMember?.name} 添加或更新一个品牌数据范围。
        </Typography.Paragraph>
        <Form
          form={accessForm}
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
    </Space>
  );
}
