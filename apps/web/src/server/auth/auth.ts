import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@geo/db";
import * as schema from "@geo/db/schema";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { identityService } from "@/server/modules/identity/identity.service";
import { redisRateLimitStorage } from "@/server/redis";
import { getServerEnv } from "../env";
import { getTrustedOrigins } from "./trusted-origins";
import { getUserAccessState } from "./user-access";

const runtimeEnv = getServerEnv();
const trustedOrigins = Array.from(getTrustedOrigins());

// @project-doc docs/domains/identity_and_access.md#login_session
export const auth = betterAuth({
  appName: "AnswerBit GEO",
  baseURL: runtimeEnv.BETTER_AUTH_URL,
  trustedOrigins,
  secret: runtimeEnv.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  rateLimit: {
    enabled: true,
    customStorage: redisRateLimitStorage,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/username": { window: 60, max: 8 },
    },
  },
  user: {
    additionalFields: {
      status: {
        type: ["active", "disabled"],
        required: false,
        defaultValue: "active",
        input: false,
      },
      accountType: {
        type: ["admin", "agent", "customer"],
        required: false,
        defaultValue: "customer",
        input: false,
      },
      pricingTier: {
        type: ["retail", "bronze", "silver", "gold"],
        required: false,
        defaultValue: "retail",
        input: false,
      },
      agentValidFrom: {
        type: "date",
        required: false,
        input: false,
      },
      agentExpiresAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/username") return;

      const usernameValue = (context.body as { username?: unknown } | undefined)
        ?.username;
      if (typeof usernameValue !== "string") return;

      const user = await identityService.findByUsername(usernameValue);
      const accessState = user ? getUserAccessState(user) : "active";
      if (accessState === "disabled") {
        throw new APIError("FORBIDDEN", {
          message: "账户已停用，请联系管理员",
        });
      }
      if (accessState === "scheduled") {
        throw new APIError("FORBIDDEN", {
          message: "代理商账户尚未到生效时间，请联系管理员",
        });
      }
      if (accessState === "expired") {
        throw new APIError("FORBIDDEN", {
          message: "代理商账户有效期已结束，请联系管理员",
        });
      }
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true,
    cookieCache: { enabled: false },
  },
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: runtimeEnv.NODE_ENV === "production",
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => /^[a-z][a-z0-9_]{2,31}$/.test(value),
      usernameNormalization: (value) => value.trim().toLowerCase(),
      immutableUsername: true,
      displayUsername: false,
    }),
    nextCookies(),
  ],
});
