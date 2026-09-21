"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CrownOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, Button, Form, Input } from "antd";
import { useEffect, useState } from "react";
import { isBootstrapComplete, submitBootstrap } from "./bootstrap-client";

type SetupValues = {
  name: string;
  username: string;
  password: string;
  confirmation: string;
};

export function SetupForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    async function reconcile() {
      if ((await isBootstrapComplete()) && active) {
        setCompleted(true);
        window.location.replace("/sign-in?initialized=1");
      }
    }
    void reconcile();
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    return () => {
      active = false;
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
    };
  }, []);

  async function initialize(values: SetupValues) {
    setMessage("");
    setPending(true);

    try {
      const result = await submitBootstrap({
        name: values.name,
        username: values.username.trim().toLowerCase(),
        password: values.password,
      });

      if (!result.complete) {
        setMessage(result.message);
        return;
      }

      // 初始化会改变服务端路由守卫状态，硬导航可绕过客户端缓存和刷新竞态。
      setCompleted(true);
      window.location.replace("/sign-in?initialized=1");
    } catch {
      setMessage("服务暂时不可用，请检查网络和数据库连接后重试");
    } finally {
      setPending(false);
    }
  }

  if (completed) {
    return (
      <Alert
        action={
          <Button href="/sign-in?initialized=1" type="primary">
            前往登录
          </Button>
        }
        description="初始化入口已经关闭，后续账号请在平台管理中创建。"
        message="系统已完成初始化，正在进入登录页"
        showIcon
        type="success"
      />
    );
  }

  return (
    <>
      <Form<SetupValues>
        autoComplete="off"
        disabled={pending}
        layout="vertical"
        onFinish={initialize}
        requiredMark={false}
        size="large"
      >
        <Form.Item
          label="管理员名称"
          name="name"
          rules={[
            { required: true, message: "请输入管理员名称" },
            { min: 2, max: 80, message: "名称长度需为 2–80 个字符" },
          ]}
        >
          <Input
            prefix={<CrownOutlined />}
            placeholder="例如：系统管理员"
            autoComplete="name"
            autoFocus
          />
        </Form.Item>

        <Form.Item
          label="管理员账号"
          name="username"
          normalize={(value: string) => value.trim().toLowerCase()}
          rules={[
            { required: true, message: "请输入管理员账号" },
            {
              pattern: /^[a-z][a-z0-9_]{2,31}$/,
              message: "以字母开头，仅支持小写字母、数字和下划线",
            },
          ]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="例如：admin"
            autoComplete="username"
          />
        </Form.Item>

        <Form.Item
          label="管理员密码"
          name="password"
          rules={[
            { required: true, message: "请输入管理员密码" },
            { min: 12, max: 128, message: "密码长度需为 12–128 位" },
            {
              pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
              message: "密码必须同时包含字母和数字",
            },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="至少 12 位，同时包含字母和数字"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label="确认密码"
          name="confirmation"
          dependencies={["password"]}
          rules={[
            { required: true, message: "请再次输入密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue("password") === value
                  ? Promise.resolve()
                  : Promise.reject(new Error("两次输入的密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<SafetyCertificateOutlined />}
            placeholder="再次输入管理员密码"
            autoComplete="new-password"
          />
        </Form.Item>

        {message && (
          <Alert
            className="form-error"
            type="error"
            showIcon
            message={message}
          />
        )}

        <Button
          block
          htmlType="submit"
          icon={<ArrowRightOutlined />}
          iconPosition="end"
          loading={pending}
          type="primary"
        >
          完成初始化
        </Button>
      </Form>

      <Alert
        description="初始化接口使用数据库事务锁，多个实例并发提交时仍只允许创建一个初始管理员。"
        icon={<CheckCircleFilled />}
        message="密码经 scrypt 单向哈希后保存"
        showIcon
        style={{ marginTop: 20 }}
        type="info"
      />
    </>
  );
}
