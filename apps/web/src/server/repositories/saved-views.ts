import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  CreateSavedViewInput,
  UpdateSavedViewInput,
} from "@geo/contracts";
import {
  savedViews,
  withTenantDbContext,
  assertEnterpriseAccess,
  type DatabaseTransaction,
} from "@geo/db";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
type Row = typeof savedViews.$inferSelect;
type Audit = (tx: DatabaseTransaction, row: Row) => Promise<void>;
const conditions = (organizationId: string, userId: string, id?: string) => [
  eq(savedViews.organizationId, organizationId),
  eq(savedViews.userId, userId),
  id ? eq(savedViews.id, id) : undefined,
];
async function lock(
  tx: DatabaseTransaction,
  organizationId: string,
  userId: string,
) {
  await assertEnterpriseAccess(organizationId, false, tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["saved-view-user", organizationId, userId])}, 0))`,
  );
}
const fingerprint = (input: CreateSavedViewInput) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        {
          name: input.name,
          page: input.page,
          filters: input.filters,
          isDefault: input.isDefault ?? false,
        },
        (_, value) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([left], [right]) =>
                  left < right ? -1 : left > right ? 1 : 0,
                ),
              )
            : value,
      ),
    )
    .digest("hex");

// @project-doc docs/domains/geo_operations.md#report_exports
export const savedViewRepository = {
  list(organizationId: string, userId: string, page?: string) {
    return withTenantDbContext({ organizationId, userId }, (tx) =>
      tx
        .select()
        .from(savedViews)
        .where(
          and(
            ...conditions(organizationId, userId),
            isNull(savedViews.deletedAt),
            page ? eq(savedViews.page, page) : undefined,
          ),
        )
        .orderBy(desc(savedViews.isDefault), desc(savedViews.updatedAt)),
    );
  },
  find(id: string, organizationId: string, userId: string) {
    return withTenantDbContext({ organizationId, userId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(savedViews)
        .where(
          and(
            ...conditions(organizationId, userId, id),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1);
      return row;
    });
  },
  create(
    input: CreateSavedViewInput,
    userId: string,
    creationKey?: string,
    audit?: Audit,
  ) {
    const creationFingerprint = creationKey ? fingerprint(input) : undefined;
    return withTenantDbContext(
      { organizationId: input.organizationId, userId },
      async (tx) => {
        await lock(tx, input.organizationId, userId);
        if (creationKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["saved-view-create", input.organizationId, creationKey])}, 0))`,
          );
          const [existing] = await tx
            .select()
            .from(savedViews)
            .where(
              and(
                eq(savedViews.organizationId, input.organizationId),
                eq(savedViews.userId, userId),
                eq(savedViews.creationKey, creationKey),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.userId !== userId ||
              existing.creationFingerprint !== creationFingerprint
            )
              return { kind: "conflict" as const };
            if (existing.deletedAt) return { kind: "removed" as const };
            return { kind: "replayed" as const, row: existing };
          }
        }
        if (input.isDefault)
          await tx
            .update(savedViews)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                ...conditions(input.organizationId, userId),
                eq(savedViews.page, input.page),
                isNull(savedViews.deletedAt),
                eq(savedViews.isDefault, true),
              ),
            );
        const [row] = await tx
          .insert(savedViews)
          .values({ ...input, userId, creationKey, creationFingerprint })
          .returning();
        if (audit) await audit(tx, row);
        return { kind: "created" as const, row };
      },
    );
  },
  update(
    id: string,
    organizationId: string,
    userId: string,
    input: Omit<UpdateSavedViewInput, "organizationId">,
    audit?: Audit,
  ) {
    return withTenantDbContext({ organizationId, userId }, async (tx) => {
      await lock(tx, organizationId, userId);
      const [current] = await tx
        .select()
        .from(savedViews)
        .where(
          and(
            ...conditions(organizationId, userId, id),
            isNull(savedViews.deletedAt),
          ),
        )
        .for("update");
      if (!current) return { kind: "missing" as const };
      const { expected, ...changes } = input;
      const desired = Object.entries(changes).every(([field, value]) =>
        isDeepStrictEqual(current[field as keyof Row], value),
      );
      if (desired) return { kind: "replayed" as const, row: current };
      if (
        expected &&
        (!isDeepStrictEqual(current.filters, expected.filters) ||
          current.name !== expected.name ||
          current.isDefault !== expected.isDefault)
      )
        return { kind: "conflict" as const, row: current };
      if (changes.isDefault)
        await tx
          .update(savedViews)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              ...conditions(organizationId, userId),
              eq(savedViews.page, current.page),
              isNull(savedViews.deletedAt),
              ne(savedViews.id, id),
              eq(savedViews.isDefault, true),
            ),
          );
      const [row] = await tx
        .update(savedViews)
        .set({ ...changes, updatedAt: new Date() })
        .where(
          and(
            ...conditions(organizationId, userId, id),
            isNull(savedViews.deletedAt),
          ),
        )
        .returning();
      if (audit) await audit(tx, row);
      return { kind: "updated" as const, row };
    });
  },
  remove(id: string, organizationId: string, userId: string, audit?: Audit) {
    return withTenantDbContext({ organizationId, userId }, async (tx) => {
      await lock(tx, organizationId, userId);
      const [row] = await tx
        .update(savedViews)
        .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
        .where(
          and(
            ...conditions(organizationId, userId, id),
            isNull(savedViews.deletedAt),
          ),
        )
        .returning();
      if (row && audit) await audit(tx, row);
      return row;
    });
  },
};
