export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.KLIERLY_DISABLE_JOBS !== "1") {
    const { startJobLoop } = await import("@/lib/ingest/jobs");
    startJobLoop();
  }
}
