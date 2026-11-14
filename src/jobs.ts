import { migrate } from "./lib/db";
import * as guard from "./lib/guard";
import * as media from "./lib/media";
import * as messages from "./lib/messages";
import * as orders from "./lib/orders";
import * as tracking from "./lib/tracking";
import { checkRelease } from "./lib/updates";

declare global {
  var libreFunnelJobs: boolean | undefined;
}

const TICK_MS = 30_000;

export async function start() {
  if (process.env.NEXT_PHASE === "phase-production-build" || globalThis.libreFunnelJobs) return;
  globalThis.libreFunnelJobs = true;

  const problems = guard.envProblems();
  if (problems.length) {
    for (const problem of problems) console.error(`[librefunnel] refusing to start: ${problem}`);
    process.exit(1);
  }
  if (process.env.TRUST_PROXY !== "1")
    console.warn(
      "[librefunnel] TRUST_PROXY is not 1: every visitor shares one rate-limit bucket and no IP reaches Meta",
    );
  await migrate();
  await messages.requeueStuck();

  const jobs = [
    orders.expireOrders,
    orders.attachCharges,
    orders.refreshWebhookKeys,
    orders.checkCharges,
    messages.queueRecovery,
    messages.sendMessages,
    messages.refreshPhotos,
    tracking.sendConversions,
    media.transcodeVideos,
    checkRelease,
  ];

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    for (const job of jobs) {
      try {
        await job();
      } catch (error) {
        console.warn(`[librefunnel] job ${job.name} failed`, error);
      }
    }
    running = false;
  };

  setInterval(tick, TICK_MS).unref();
  void tick();
}
