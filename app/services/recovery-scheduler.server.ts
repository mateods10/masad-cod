const workerState = globalThis as typeof globalThis & {
  masadRecoveryTimer?: NodeJS.Timeout;
  masadRecoveryStarting?: NodeJS.Timeout;
};

async function runRecoveryQueue() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) return;

  try {
    const response = await fetch(new URL("/jobs/send-recoveries", appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) console.error(`La cola de recuperación respondió ${response.status}`);
  } catch (error) {
    console.error("No se pudo procesar la cola de recuperación", error);
  }
}

export function startRecoveryScheduler() {
  if (workerState.masadRecoveryTimer || !process.env.RAILWAY_ENVIRONMENT) return;
  workerState.masadRecoveryStarting = setTimeout(runRecoveryQueue, 30_000);
  workerState.masadRecoveryStarting.unref();
  workerState.masadRecoveryTimer = setInterval(runRecoveryQueue, 5 * 60_000);
  workerState.masadRecoveryTimer.unref();
}
