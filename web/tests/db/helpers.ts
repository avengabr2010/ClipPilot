import { Client } from "pg";
import { randomUUID } from "node:crypto";

export const DSN = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/clippilot_test";

export async function connect(): Promise<Client | null> {
  const c = new Client({ connectionString: DSN });
  try {
    await c.connect();
    return c;
  } catch {
    return null;
  }
}

export async function createUser(c: Client, opts: { email?: string; confirmed?: boolean } = {}) {
  const id = randomUUID();
  const email = opts.email ?? `u-${id.slice(0, 8)}@example.com`;
  await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [
    id,
    email,
    opts.confirmed === false ? null : new Date(),
  ]);
  return { id, email };
}

/**
 * Runs `fn` as an authenticated Supabase user (RLS applies). Uses session-level
 * settings (no transaction) so that several expected failures can be asserted
 * in a row; the role is always reset afterwards.
 */
export async function asUser<T>(c: Client, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query(`set role ${userId ? "authenticated" : "anon"}`);
  await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(userId ? { sub: userId, role: "authenticated" } : {})]);
  try {
    return await fn();
  } finally {
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claims', '', false)");
  }
}

export const asUserCommit = asUser;

export async function expectError(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!re.test(msg)) throw new Error(`expected error matching ${re}, got: ${msg}`);
    return;
  }
  throw new Error(`expected error matching ${re}, but the query succeeded`);
}
