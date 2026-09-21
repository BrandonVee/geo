import { count, eq, sql } from "drizzle-orm";
import { accounts, db, platformUserRoles, roles, users } from "@geo/db";

export type NewLocalAccount = {
  name: string;
  username: string;
  passwordHash: string;
  accountType: "admin" | "agent" | "customer";
  pricingTier?: "retail" | "bronze" | "silver" | "gold";
  agentValidFrom?: Date | null;
  agentExpiresAt?: Date | null;
};

const syntheticEmail = (username: string) => `${username}@accounts.invalid`;

async function insertLocalAccount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: NewLocalAccount,
) {
  const [user] = await tx
    .insert(users)
    .values({
      name: input.name,
      username: input.username,
      email: syntheticEmail(input.username),
      emailVerified: true,
      accountType: input.accountType,
      pricingTier: input.pricingTier ?? "retail",
      agentValidFrom: input.agentValidFrom,
      agentExpiresAt: input.agentExpiresAt,
      status: "active",
    })
    .returning();

  await tx.insert(accounts).values({
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: input.passwordHash,
  });

  return user;
}

export const identityRepository = {
  async isInitialized() {
    const [result] = await db
      .select({ value: count() })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(eq(accounts.providerId, "credential"));

    return Number(result?.value ?? 0) > 0;
  },

  findByUsername(username: string) {
    return db.query.users.findFirst({
      where: eq(users.username, username),
    });
  },

  // @project-doc docs/domains/identity_and_access.md#bootstrap_flow
  async bootstrapAdministrator(input: NewLocalAccount) {
    return db.transaction(async (tx) => {
      // Serialize the one-time bootstrap across every web instance.
      await tx.execute(sql`select pg_advisory_xact_lock(718246319)`);

      const [existing] = await tx
        .select({ value: count() })
        .from(accounts)
        .where(eq(accounts.providerId, "credential"));

      if (Number(existing?.value ?? 0) > 0) return undefined;

      const [superAdminRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "super_admin"))
        .limit(1);

      if (!superAdminRole) throw new Error("SUPER_ADMIN_ROLE_NOT_SEEDED");

      const user = await insertLocalAccount(tx, {
        ...input,
        accountType: "admin",
      });

      await tx.insert(platformUserRoles).values({
        userId: user.id,
        roleId: superAdminRole.id,
        grantedBy: user.id,
      });

      return user;
    });
  },

  async createManagedAccount(input: NewLocalAccount, actorUserId: string) {
    return db.transaction(async (tx) => {
      const user = await insertLocalAccount(tx, input);

      if (input.accountType === "admin") {
        const [superAdminRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, "super_admin"))
          .limit(1);

        if (!superAdminRole) throw new Error("SUPER_ADMIN_ROLE_NOT_SEEDED");

        await tx.insert(platformUserRoles).values({
          userId: user.id,
          roleId: superAdminRole.id,
          grantedBy: actorUserId,
        });
      }

      return user;
    });
  },
};
