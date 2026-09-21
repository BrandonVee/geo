import { db, platformUserRoles, pool, roles, users } from "./index";
import { eq } from "drizzle-orm";

const identity = process.argv[2] ?? process.env.PLATFORM_ADMIN_IDENTITY;
if (!identity) throw new Error("用法: pnpm db:grant-admin <账号或用户 UUID>");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    identity,
  );
const identityCondition = uuid
  ? eq(users.id, identity)
  : eq(users.username, identity.toLowerCase());
const [user] = await db
  .select({ id: users.id, name: users.name })
  .from(users)
  .where(identityCondition)
  .limit(1);
if (!user) throw new Error("未找到指定用户");
await db
  .update(users)
  .set({ accountType: "admin", status: "active", updatedAt: new Date() })
  .where(eq(users.id, user.id));
const [role] = await db
  .select({ id: roles.id })
  .from(roles)
  .where(eq(roles.code, "super_admin"))
  .limit(1);
if (!role) throw new Error("super_admin 角色尚未初始化，请先运行 db:seed");
await db
  .insert(platformUserRoles)
  .values({ userId: user.id, roleId: role.id, grantedBy: user.id })
  .onConflictDoNothing();
console.info(`已授予平台管理员：${user.name} (${user.id})`);
await pool.end();
