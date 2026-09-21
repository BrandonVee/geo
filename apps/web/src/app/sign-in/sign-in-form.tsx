"use client";

import {
  ArrowRightOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, Space } from "antd";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type SignInValues = {
  username: string;
  password: string;
  rememberMe: boolean;
};

export function SignInForm({ initialized = false }: { initialized?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(values: SignInValues) {
    setMessage("");
    setPending(true);
    const { error } = await authClient.signIn.username({
      username: values.username.trim().toLowerCase(),
      password: values.password,
      rememberMe: values.rememberMe,
    });
    setPending(false);

    if (error) {
      setMessage(
        error.status === 403
          ? (error.message ?? "账户已停用，请联系管理员")
          : "账号或密码错误",
      );
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      {initialized ? (
        <Alert
          description="初始管理员已经建立，现在可以使用刚创建的账号登录。"
          message="系统初始化完成"
          showIcon
          type="success"
        />
      ) : null}

      {message ? <Alert message={message} showIcon type="error" /> : null}

      <Form<SignInValues>
        initialValues={{ rememberMe: true }}
        layout="vertical"
        onFinish={signIn}
        requiredMark={false}
        size="large"
      >
        <Form.Item
          label="登录账号"
          name="username"
          normalize={(value: string) => value.trim().toLowerCase()}
          rules={[
            { required: true, message: "请输入登录账号" },
            {
              pattern: /^[a-z][a-z0-9_]{2,31}$/,
              message: "账号格式不正确",
            },
          ]}
        >
          <Input
            autoComplete="username"
            autoFocus
            prefix={<UserOutlined />}
            placeholder="输入登录账号"
          />
        </Form.Item>

        <Form.Item
          label="登录密码"
          name="password"
          rules={[{ required: true, message: "请输入登录密码" }]}
        >
          <Input.Password
            autoComplete="current-password"
            prefix={<LockOutlined />}
            placeholder="输入登录密码"
          />
        </Form.Item>

        <Form.Item name="rememberMe" valuePropName="checked">
          <Checkbox>7 天内保持登录</Checkbox>
        </Form.Item>

        <Button
          block
          htmlType="submit"
          icon={<ArrowRightOutlined />}
          iconPosition="end"
          loading={pending}
          type="primary"
        >
          进入工作台
        </Button>
      </Form>
    </Space>
  );
}
