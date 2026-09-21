import { PgBoss } from "pg-boss";
import { getServerEnv } from "../env";
const globalBoss = globalThis as typeof globalThis & {
  geoBoss?: PgBoss;
  geoBossStart?: Promise<PgBoss>;
};
export function getBoss() {
  if (!globalBoss.geoBoss) {
    const runtimeEnv = getServerEnv();
    globalBoss.geoBoss = new PgBoss({
      connectionString: runtimeEnv.DATABASE_URL,
      application_name: `${runtimeEnv.DB_APPLICATION_NAME.slice(0, 58)}-jobs`,
      max: runtimeEnv.JOB_DB_POOL_MAX,
      connectionTimeoutMillis: runtimeEnv.DB_CONNECT_TIMEOUT_MS,
    });
    globalBoss.geoBoss.on("error", (error) => {
      const errorCode =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "JOB_DATABASE_ERROR";
      console.error(
        JSON.stringify({
          event: "job-database.error",
          component: "web",
          errorCode,
        }),
      );
    });
  }
  return globalBoss.geoBoss;
}
async function startBoss() {
  if (!globalBoss.geoBossStart)
    globalBoss.geoBossStart = (async () => {
      const boss = getBoss();
      await boss.start();
      await boss.createQueue("article-generation");
      await boss.createQueue("report-export");
      return boss;
    })();
  return globalBoss.geoBossStart;
}
export async function enqueueArticleGeneration(data: {
  organizationId: string;
  jobId: string;
}) {
  const boss = await startBoss();
  const queueJobId = await boss.send("article-generation", data, {
    singletonKey: data.jobId,
    retryLimit: 0,
    expireInSeconds: 300,
  });
  if (!queueJobId) throw new Error("ARTICLE_JOB_ENQUEUE_FAILED");
  return queueJobId;
}
export async function cancelArticleGeneration(queueJobId: string) {
  const boss = await startBoss();
  await boss.cancel("article-generation", queueJobId);
}
export async function enqueueReportExport(data: {
  organizationId: string;
  exportId: string;
}) {
  const boss = await startBoss();
  const id = await boss.send("report-export", data, {
    singletonKey: data.exportId,
    retryLimit: 0,
    expireInSeconds: 600,
  });
  if (!id) throw new Error("REPORT_EXPORT_ENQUEUE_FAILED");
  return id;
}
