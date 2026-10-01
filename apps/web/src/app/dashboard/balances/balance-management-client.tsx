"use client";

import { SwapOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Row, Space, Statistic } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandAllocation } from "./brand-allocation";
import { EnterpriseLedger } from "./enterprise-ledger";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

type Asset = "answerbit_points" | "publication_cny";
type Account = {
  id: string;
  brandId: string | null;
  asset: Asset;
  balance: number;
};
const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(amount / 100);

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data as T;
}

export function BalanceManagementClient({
  organizations,
  userId,
}: {
  organizations: ScopeOrganization[];
  userId: string;
}) {
  const scope = useAnswerBitScope(organizations);
  const key = `${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    organization: Account[];
    brand: Account[];
  }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    if (!scope.organizationId || !scope.teamBindingId || !scope.brandId) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const brandQuery = scopeQuery({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
      });
      const [accounts, brand] = await Promise.all([
        request<Account[]>(
          `/api/v1/balances?organizationId=${scope.organizationId}`,
          { signal: controller.signal },
        ),
        request<Account[]>(`/api/v1/balances?${brandQuery}`, {
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      setSnapshot({
        key,
        organization: accounts.filter((a) => a.brandId === null),
        brand,
      });
    } catch (reason) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          key,
          message: reason instanceof Error ? reason.message : "资产读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [key, scope.brandId, scope.organizationId, scope.teamBindingId]);
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
  const readError = failure?.key === key ? failure.message : undefined;
  const data = !readError && snapshot?.key === key ? snapshot : undefined;
  const organizationAccounts = data?.organization ?? [],
    brandAccounts = data?.brand ?? [];
  const reading = loading || (!data && !readError && !scope.error);
  const onAllocated = useCallback(
    async (success: string) => {
      setMessage(success);
      setLedgerRefresh((n) => n + 1);
      await load();
    },
    [load],
  );

  const pool = (targetAsset: Asset) =>
    organizationAccounts.find((item) => item.asset === targetAsset)?.balance ??
    0;
  const brand = (targetAsset: Asset) =>
    brandAccounts.find((item) => item.asset === targetAsset)?.balance ?? 0;

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Card title="管理范围">
        <ScopeFields organizations={organizations} scope={scope} />
      </Card>

      {message ? (
        <Alert
          closable
          message={message}
          onClose={() => {
            setMessage("");
          }}
          showIcon
          type="success"
        />
      ) : null}

      {readError ? (
        <Alert
          type="error"
          showIcon
          message="资产读取失败"
          description={readError}
          action={
            <Button disabled={loading} onClick={() => void load()}>
              重试读取资产
            </Button>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              title="企业可分配积分"
              formatter={() =>
                data ? pool("answerbit_points").toLocaleString() : "—"
              }
              value={pool("answerbit_points")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              title="当前品牌积分"
              value={brand("answerbit_points")}
              formatter={() =>
                data ? brand("answerbit_points").toLocaleString() : "—"
              }
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              formatter={() => (data ? money(pool("publication_cny")) : "—")}
              title="企业可分配发布余额"
              value={pool("publication_cny")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              formatter={() => (data ? money(brand("publication_cny")) : "—")}
              title="当前品牌发布余额"
              value={brand("publication_cny")}
            />
          </Card>
        </Col>
      </Row>

      <Row align="stretch" gutter={[16, 16]}>
        <Col lg={8} xs={24}>
          <Card
            title="企业资产划拨"
            extra={<SwapOutlined />}
            style={{ height: "100%" }}
          >
            <BrandAllocation
              userId={userId}
              organizationId={scope.organizationId}
              organizationName={
                organizations.find((o) => o.id === scope.organizationId)
                  ?.name ?? ""
              }
              brandId={scope.brandId}
              brandName={scope.brand?.name ?? ""}
              canAllocate={scope.can("balance.allocate")}
              pointsExpired={scope.pointsExpired}
              onAllocated={onAllocated}
            />
          </Card>
        </Col>
        <Col lg={16} xs={24}>
          <EnterpriseLedger
            key={scope.organizationId}
            organizationId={scope.organizationId}
            brandId={scope.brandId}
            refreshVersion={ledgerRefresh}
            onRefreshAssets={() => void load()}
          />
        </Col>
      </Row>
    </Space>
  );
}
