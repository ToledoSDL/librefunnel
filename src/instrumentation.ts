export async function register() {
  // Next also builds this file for the edge runtime, which has neither process.exit nor the database drivers.
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./jobs")).start();
}
