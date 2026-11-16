import { leadJobs, migrate, nightlyDemoReset } from "./lib/db";
import * as guard from "./lib/guard";
import * as invoices from "./lib/invoices";
import { sendBackup } from "./lib/media/backup";
import { bucket } from "./lib/media/bucket";
import { applyCors, setUpR2 } from "./lib/media/storage";
import { sweepMedia } from "./lib/media/sweep";
import { transcodeVideos } from "./lib/media/video";
import * as messages from "./lib/messages";
import { attachCharges, checkCharges } from "./lib/orders/charges";
import { expireOrders } from "./lib/orders/checkout";
import { convertToCrypto } from "./lib/orders/crypto";
import { refreshWebhookKeys } from "./lib/orders/woovi";
import { pruneSessions } from "./lib/sessions";
import * as tracking from "./lib/tracking/conversions";
import { checkRelease } from "./lib/updates";

declare global {
  var libreFunnelJobs: boolean | undefined;
}

const TICK_MS = 30_000;
const DRAIN_MS = 5_000;

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

  // The image sets NEXT_MANUAL_SIG_HANDLE so Next does not exit at once: requests in flight finish while the new container takes over.
  if (process.env.NEXT_MANUAL_SIG_HANDLE) process.once("SIGTERM", () => setTimeout(() => process.exit(0), DRAIN_MS));

  // deploy/install.sh starts the store once with its Cloudflare token and reads this line to tell the seller whether R2 is on.
  const cloudflareToken = process.env.CLOUDFLARE_TOKEN;
  if (cloudflareToken)
    void setUpR2(cloudflareToken)
      .then((code) => console.info(`[librefunnel] r2: ${code ?? "OK"}`))
      .catch(() => console.warn("[librefunnel] r2: STORAGE_UNREACHABLE"));
  else
    void bucket()
      .then((target) => target && applyCors(target))
      .catch(() => console.warn("[librefunnel] storage: the CORS rule could not be updated"));

  const jobs = [
    expireOrders,
    attachCharges,
    refreshWebhookKeys,
    checkCharges,
    convertToCrypto,
    messages.queueRecovery,
    messages.sendMessages,
    messages.refreshPhotos,
    tracking.sendConversions,
    invoices.issueInvoices,
    transcodeVideos,
    sweepMedia,
    sendBackup,
    pruneSessions,
    checkRelease,
    nightlyDemoReset,
  ];

  let running = false;
  let leading = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const lead = await leadJobs();
      // Messages left "sending" belong to the container that held the lock before and is gone now.
      if (lead && !leading) await messages.requeueStuck();
      leading = lead;
    } catch (error) {
      leading = false;
      console.warn("[librefunnel] could not take the jobs lock", error);
    }
    for (const job of leading ? jobs : []) {
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
