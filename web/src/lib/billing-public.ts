import "server-only";

/** Whether paid plans can currently be purchased. Never throws (used on public pages). */
export async function isBillingOpen(): Promise<boolean> {
  try {
    const { billingEnabled } = await import("@/lib/stripe");
    return await billingEnabled();
  } catch {
    return false;
  }
}
