import type { AdminCreateUserInput, BootstrapAdminInput } from "@geo/contracts";
import { hashPassword } from "better-auth/crypto";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { identityRepository } from "./identity.repository";

const normalizeUsername = (username: string) => username.trim().toLowerCase();

async function hashCredential(password: string) {
  return hashPassword(password);
}

export const identityService = {
  isInitialized() {
    return identityRepository.isInitialized();
  },

  findByUsername(username: string) {
    return identityRepository.findByUsername(normalizeUsername(username));
  },

  async bootstrapAdministrator(input: BootstrapAdminInput) {
    try {
      const user = await identityRepository.bootstrapAdministrator({
        name: input.name,
        username: normalizeUsername(input.username),
        passwordHash: await hashCredential(input.password),
        accountType: "admin",
      });

      if (!user) {
        throw new ApiError(
          409,
          "SYSTEM_ALREADY_INITIALIZED",
          "系统已完成初始化",
        );
      }

      return { id: user.id, name: user.name, username: user.username };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (databaseErrorCode(error) === "23505") {
        throw new ApiError(409, "USERNAME_EXISTS", "该账号已存在");
      }
      if (
        error instanceof Error &&
        error.message === "SUPER_ADMIN_ROLE_NOT_SEEDED"
      ) {
        throw new ApiError(
          503,
          "SYSTEM_NOT_READY",
          "系统基础角色尚未初始化，请先执行数据库种子",
        );
      }
      throw error;
    }
  },

  async createManagedAccount(input: AdminCreateUserInput, actorUserId: string) {
    try {
      return await identityRepository.createManagedAccount(
        {
          name: input.name,
          username: normalizeUsername(input.username),
          passwordHash: await hashCredential(input.password),
          accountType: input.accountType,
          pricingTier:
            input.accountType === "agent"
              ? (input.pricingTier ?? "bronze")
              : "retail",
          agentValidFrom: input.agentValidFrom
            ? new Date(input.agentValidFrom)
            : null,
          agentExpiresAt: input.agentExpiresAt
            ? new Date(input.agentExpiresAt)
            : null,
        },
        actorUserId,
      );
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        throw new ApiError(409, "USERNAME_EXISTS", "该账号已存在");
      }
      if (
        error instanceof Error &&
        error.message === "SUPER_ADMIN_ROLE_NOT_SEEDED"
      ) {
        throw new ApiError(
          409,
          "ROLE_NOT_READY",
          "管理员角色尚未初始化，请先运行数据库种子",
        );
      }
      throw error;
    }
  },
};
