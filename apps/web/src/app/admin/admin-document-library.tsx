"use client";

import { Empty, Flex, Select, Typography } from "antd";
import { useState } from "react";
import { DocumentLibrary } from "../dashboard/content/document-library";
import type { ScopeOrganization } from "../dashboard/use-answerbit-scope";

export function AdminDocumentLibrary({
  userId,
  organizations,
  onMessage,
}: {
  userId: string;
  organizations: (ScopeOrganization & { brandId: string })[];
  onMessage: (message: string) => void;
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id);
  const organization = organizations.find((item) => item.id === organizationId);
  return (
    <Flex gap={16} vertical>
      <Flex align="center" gap={12} wrap>
        <Typography.Text>企业／品牌</Typography.Text>
        <Select
          aria-label="选择文章库所属企业"
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 240, maxWidth: "100%" }}
          value={organizationId}
          onChange={setOrganizationId}
          options={organizations.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
      </Flex>
      {organization ? (
        <DocumentLibrary
          userId={userId}
          key={organization.id}
          scope={{
            organizationId: organization.id,
            teamBindingId: organization.teamBindingId,
            brandId: organization.brandId,
          }}
          canWrite
          canDelete
          canPublish={false}
          refreshToken=""
          onMessage={onMessage}
        />
      ) : (
        <Empty description="暂无可查看的企业文章库" />
      )}
    </Flex>
  );
}
