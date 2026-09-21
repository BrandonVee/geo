import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import {
  answerbitBrandMappings,
  answerbitConnections,
  answerbitCredentialAssignments,
  answerbitTeamBindings,
  db,
  organizations,
} from "@geo/db";

const credentialSelection = {
  id: answerbitCredentialAssignments.id,
  organizationId: answerbitCredentialAssignments.organizationId,
  organizationName: organizations.name,
  teamBindingId: answerbitCredentialAssignments.teamBindingId,
  teamId: answerbitTeamBindings.teamId,
  teamDisplayName: answerbitTeamBindings.displayName,
  connectionId: answerbitCredentialAssignments.connectionId,
  displayName: answerbitCredentialAssignments.displayName,
  scopeType: answerbitCredentialAssignments.scopeType,
  brandId: answerbitCredentialAssignments.brandId,
  permissions: answerbitCredentialAssignments.permissions,
  priority: answerbitCredentialAssignments.priority,
  status: answerbitConnections.status,
  encryptedApiKey: answerbitConnections.encryptedApiKey,
  apiKeyHint: answerbitConnections.apiKeyHint,
  keyVersion: answerbitConnections.keyVersion,
  lastCheckedAt: answerbitConnections.lastCheckedAt,
  createdAt: answerbitCredentialAssignments.createdAt,
  updatedAt: answerbitCredentialAssignments.updatedAt,
};

export const answerBitCredentialRepository = {
  list() {
    return db
      .select(credentialSelection)
      .from(answerbitCredentialAssignments)
      .innerJoin(
        answerbitConnections,
        and(
          eq(
            answerbitConnections.id,
            answerbitCredentialAssignments.connectionId,
          ),
          eq(
            answerbitConnections.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(
            answerbitTeamBindings.id,
            answerbitCredentialAssignments.teamBindingId,
          ),
          eq(
            answerbitTeamBindings.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, answerbitCredentialAssignments.organizationId),
      )
      .orderBy(
        desc(answerbitCredentialAssignments.updatedAt),
        asc(answerbitCredentialAssignments.priority),
      );
  },

  listForOrganization(organizationId: string) {
    return db
      .select(credentialSelection)
      .from(answerbitCredentialAssignments)
      .innerJoin(
        answerbitConnections,
        and(
          eq(
            answerbitConnections.id,
            answerbitCredentialAssignments.connectionId,
          ),
          eq(
            answerbitConnections.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(
            answerbitTeamBindings.id,
            answerbitCredentialAssignments.teamBindingId,
          ),
          eq(
            answerbitTeamBindings.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, answerbitCredentialAssignments.organizationId),
      )
      .where(eq(answerbitCredentialAssignments.organizationId, organizationId))
      .orderBy(
        desc(answerbitCredentialAssignments.updatedAt),
        asc(answerbitCredentialAssignments.priority),
      );
  },

  async findById(credentialId: string) {
    const [credential] = await db
      .select(credentialSelection)
      .from(answerbitCredentialAssignments)
      .innerJoin(
        answerbitConnections,
        and(
          eq(
            answerbitConnections.id,
            answerbitCredentialAssignments.connectionId,
          ),
          eq(
            answerbitConnections.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(
            answerbitTeamBindings.id,
            answerbitCredentialAssignments.teamBindingId,
          ),
          eq(
            answerbitTeamBindings.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, answerbitCredentialAssignments.organizationId),
      )
      .where(eq(answerbitCredentialAssignments.id, credentialId))
      .limit(1);
    return credential;
  },

  listForTeam(organizationId: string, teamBindingId: string) {
    return db
      .select(credentialSelection)
      .from(answerbitCredentialAssignments)
      .innerJoin(
        answerbitConnections,
        and(
          eq(
            answerbitConnections.id,
            answerbitCredentialAssignments.connectionId,
          ),
          eq(
            answerbitConnections.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(
            answerbitTeamBindings.id,
            answerbitCredentialAssignments.teamBindingId,
          ),
          eq(
            answerbitTeamBindings.organizationId,
            answerbitCredentialAssignments.organizationId,
          ),
        ),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, answerbitCredentialAssignments.organizationId),
      )
      .where(
        and(
          eq(answerbitCredentialAssignments.organizationId, organizationId),
          eq(answerbitCredentialAssignments.teamBindingId, teamBindingId),
        ),
      )
      .orderBy(
        asc(answerbitCredentialAssignments.priority),
        desc(answerbitCredentialAssignments.updatedAt),
      );
  },

  async findTeamByExternalId(teamId: string) {
    const [team] = await db
      .select()
      .from(answerbitTeamBindings)
      .where(eq(answerbitTeamBindings.teamId, teamId))
      .limit(1);
    return team;
  },

  async organizationExists(organizationId: string) {
    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return Boolean(organization);
  },

  async brandMappingExists(
    organizationId: string,
    teamBindingId: string,
    brandId: string,
  ) {
    const [brand] = await db
      .select({ id: answerbitBrandMappings.id })
      .from(answerbitBrandMappings)
      .where(
        and(
          eq(answerbitBrandMappings.organizationId, organizationId),
          eq(answerbitBrandMappings.teamBindingId, teamBindingId),
          eq(answerbitBrandMappings.brandId, brandId),
        ),
      )
      .limit(1);
    return Boolean(brand);
  },

  create(input: {
    organizationId: string;
    teamId: string;
    displayName?: string;
    scopeType: "team" | "brand";
    brandId?: string;
    brandName?: string;
    permissions: string[];
    priority: number;
    actorUserId: string;
    encryptedApiKey: string;
    apiKeyFingerprint: string;
    apiKeyHint: string;
  }) {
    return db.transaction(async (tx) => {
      const now = new Date();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.apiKeyFingerprint}))`,
      );
      const [existingKey] = await tx
        .select({ id: answerbitConnections.id })
        .from(answerbitConnections)
        .where(
          eq(answerbitConnections.apiKeyFingerprint, input.apiKeyFingerprint),
        )
        .limit(1);
      if (existingKey)
        throw Object.assign(new Error("ANSWERBIT_KEY_ASSIGNED"), {
          domainCode: "ANSWERBIT_KEY_ASSIGNED",
        });
      const [existingTeam] = await tx
        .select()
        .from(answerbitTeamBindings)
        .where(eq(answerbitTeamBindings.teamId, input.teamId))
        .limit(1);
      if (existingTeam && existingTeam.organizationId !== input.organizationId)
        throw Object.assign(new Error("TEAM_BINDING_ASSIGNED"), {
          domainCode: "TEAM_BINDING_ASSIGNED",
        });

      const [connection] = await tx
        .insert(answerbitConnections)
        .values({
          organizationId: input.organizationId,
          encryptedApiKey: input.encryptedApiKey,
          apiKeyFingerprint: input.apiKeyFingerprint,
          apiKeyHint: input.apiKeyHint,
          keyVersion: 1,
          status: "active",
          managedByPlatform: true,
          createdBy: input.actorUserId,
        })
        .returning();

      let team = existingTeam;
      if (!team) {
        const [{ value: teamCount }] = await tx
          .select({ value: sql<number>`count(*)` })
          .from(answerbitTeamBindings)
          .where(
            eq(answerbitTeamBindings.organizationId, input.organizationId),
          );
        [team] = await tx
          .insert(answerbitTeamBindings)
          .values({
            organizationId: input.organizationId,
            connectionId: connection.id,
            teamId: input.teamId,
            isDefault: Number(teamCount) === 0,
            status: "active",
          })
          .returning();
      } else {
        [team] = await tx
          .update(answerbitTeamBindings)
          .set({
            connectionId: connection.id,
            status: "active",
            lastErrorCode: null,
            updatedAt: now,
          })
          .where(eq(answerbitTeamBindings.id, team.id))
          .returning();
      }

      const [assignment] = await tx
        .insert(answerbitCredentialAssignments)
        .values({
          organizationId: input.organizationId,
          teamBindingId: team.id,
          connectionId: connection.id,
          displayName: input.displayName,
          scopeType: input.scopeType,
          brandId: input.scopeType === "brand" ? input.brandId : null,
          permissions: input.permissions,
          priority: input.priority,
          createdBy: input.actorUserId,
        })
        .returning();

      if (input.scopeType === "brand" && input.brandId) {
        await tx
          .insert(answerbitBrandMappings)
          .values({
            organizationId: input.organizationId,
            teamBindingId: team.id,
            brandId: input.brandId,
            brandName: input.brandName ?? input.brandId,
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              answerbitBrandMappings.organizationId,
              answerbitBrandMappings.teamBindingId,
              answerbitBrandMappings.brandId,
            ],
            set: {
              brandName: input.brandName ?? input.brandId,
              syncedAt: now,
              updatedAt: now,
            },
          });
        const [{ value: brandCount }] = await tx
          .select({ value: sql<number>`count(*)` })
          .from(answerbitBrandMappings)
          .where(
            and(
              eq(answerbitBrandMappings.organizationId, input.organizationId),
              eq(answerbitBrandMappings.teamBindingId, team.id),
            ),
          );
        await tx
          .update(answerbitTeamBindings)
          .set({ brandCount: Number(brandCount), updatedAt: now })
          .where(eq(answerbitTeamBindings.id, team.id));
      }

      return assignment;
    });
  },

  async update(
    credentialId: string,
    input: {
      displayName?: string | null;
      permissions?: string[];
      priority?: number;
      status?: "active" | "disabled";
      encryptedApiKey?: string;
      apiKeyFingerprint?: string;
      apiKeyHint?: string;
    },
  ) {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          assignment: answerbitCredentialAssignments,
          connection: answerbitConnections,
        })
        .from(answerbitCredentialAssignments)
        .innerJoin(
          answerbitConnections,
          eq(
            answerbitConnections.id,
            answerbitCredentialAssignments.connectionId,
          ),
        )
        .where(eq(answerbitCredentialAssignments.id, credentialId))
        .limit(1);
      if (!current) return undefined;
      const now = new Date();
      if (input.apiKeyFingerprint) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${input.apiKeyFingerprint}))`,
        );
        const [existingKey] = await tx
          .select({ id: answerbitConnections.id })
          .from(answerbitConnections)
          .where(
            and(
              eq(
                answerbitConnections.apiKeyFingerprint,
                input.apiKeyFingerprint,
              ),
              ne(answerbitConnections.id, current.connection.id),
            ),
          )
          .limit(1);
        if (existingKey)
          throw Object.assign(new Error("ANSWERBIT_KEY_ASSIGNED"), {
            domainCode: "ANSWERBIT_KEY_ASSIGNED",
          });
      }
      await tx
        .update(answerbitCredentialAssignments)
        .set({
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          ...(input.permissions ? { permissions: input.permissions } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          updatedAt: now,
        })
        .where(eq(answerbitCredentialAssignments.id, credentialId));
      await tx
        .update(answerbitConnections)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.encryptedApiKey
            ? {
                encryptedApiKey: input.encryptedApiKey,
                apiKeyFingerprint: input.apiKeyFingerprint!,
                apiKeyHint: input.apiKeyHint!,
                keyVersion: sql`${answerbitConnections.keyVersion} + 1`,
                status: input.status ?? "active",
                lastCheckedAt: null,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(answerbitConnections.id, current.connection.id));
      if (input.status || input.encryptedApiKey) {
        const [{ value: activeCredentialCount }] = await tx
          .select({ value: sql<number>`count(*)` })
          .from(answerbitCredentialAssignments)
          .innerJoin(
            answerbitConnections,
            eq(
              answerbitConnections.id,
              answerbitCredentialAssignments.connectionId,
            ),
          )
          .where(
            and(
              eq(
                answerbitCredentialAssignments.teamBindingId,
                current.assignment.teamBindingId,
              ),
              eq(answerbitConnections.status, "active"),
            ),
          );
        const hasActiveCredential = Number(activeCredentialCount) > 0;
        await tx
          .update(answerbitTeamBindings)
          .set({
            status: hasActiveCredential ? "active" : "invalid",
            lastErrorCode: hasActiveCredential
              ? null
              : "ANSWERBIT_KEY_NOT_CONFIGURED",
            updatedAt: now,
          })
          .where(
            and(
              eq(answerbitTeamBindings.id, current.assignment.teamBindingId),
              ne(answerbitTeamBindings.status, "disabled"),
            ),
          );
      }
      return credentialId;
    });
  },

  async disable(credentialId: string) {
    const current = await this.findById(credentialId);
    if (!current) return undefined;
    await this.update(credentialId, { status: "disabled" });
    return current;
  },
};
