"use client";
import { Card, Col, Row, Space } from "antd";
import {
  ScopeFields,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";
import { NoticeHistory } from "./notice-history";
import { NotificationRules } from "./notification-rules";

export function NotificationsClient({
  organizations,
  userId,
}: {
  organizations: ScopeOrganization[];
  userId: string;
}) {
  const scope = useAnswerBitScope(organizations);
  const canManage =
    organizations.find((item) => item.id === scope.organizationId)?.role ===
    "tenant_admin";
  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Card title="通知范围">
        <ScopeFields
          organizations={organizations}
          scope={scope}
          showBrand={false}
        />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xxl={canManage ? 12 : 24} xs={24}>
          {scope.organizationId ? (
            <NoticeHistory
              key={scope.organizationId}
              organizationId={scope.organizationId}
              brandId={scope.brandId}
            />
          ) : null}
        </Col>
        {canManage && scope.organizationId ? (
          <Col xxl={12} xs={24}>
            <NotificationRules
              key={scope.organizationId}
              organizationId={scope.organizationId}
              userId={userId}
              teamBindingId={scope.teamBindingId}
              brandId={scope.brandId}
            />
          </Col>
        ) : null}
      </Row>
    </Space>
  );
}
