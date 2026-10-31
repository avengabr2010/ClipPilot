import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, asUserCommit, connect, createUser, expectError } from "./helpers";

let c: Client | null;
const OWNER_EMAIL = `owner-${Date.now()}@clippilot.test`;

beforeAll(async () => {
  c = await connect();
  if (c) await c.query("select public.bootstrap_owner($1)", [OWNER_EMAIL]);
});
afterAll(async () => {
  await c?.query("delete from public.app_config where key = 'owner_email'");
  await c?.end();
});

const db = () => {
  if (!c) throw new Error("no db");
  return c;
};
const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!c) ctx.skip();
    await fn();
  });

describe("provisioning & OWNER", () => {
  maybe("new users get a profile, USER role, free plan and a balance", async () => {
    const u = await createUser(db());
    const { rows } = await db().query(
      `select r.role, s.plan_id, b.minutes_used, p.email from public.user_roles r
       join public.subscriptions s using (user_id) join public.credit_balances b using (user_id)
       join public.profiles p on p.id = r.user_id where r.user_id = $1`,
      [u.id],
    );
    expect(rows[0]).toMatchObject({ role: "USER", plan_id: "free", email: u.email });
  });

  maybe("the configured owner email becomes OWNER only once verified", async () => {
    const o = await createUser(db(), { email: OWNER_EMAIL, confirmed: false });
    let { rows } = await db().query("select role from public.user_roles where user_id = $1", [o.id]);
    expect(rows[0].role).toBe("USER");
    await db().query("update auth.users set email_confirmed_at = now() where id = $1", [o.id]);
    ({ rows } = await db().query("select role from public.user_roles where user_id = $1", [o.id]));
    expect(rows[0].role).toBe("OWNER");

    const ent = await asUser(db(), o.id, async () => (await db().query("select public.get_entitlements() e")).rows[0].e);
    expect(ent).toMatchObject({ unlimited: true, watermark: false, max_resolution: 1080, minutes_limit: null, admin: true });
    expect(ent.features).toMatchObject({ hook_detector: true, virality_score: true, all_templates: true, experimental: true });
  });

  maybe("a user cannot self-assign OWNER or ADMIN", async () => {
    const u = await createUser(db());
    await asUser(db(), u.id, () =>
      expectError(db().query("update public.user_roles set role = 'OWNER' where user_id = $1", [u.id]), /permission denied/),
    );
    await asUser(db(), u.id, () =>
      expectError(db().query("select public.admin_set_role($1, 'ADMIN')", [u.id]), /only the owner/),
    );
    await asUser(db(), u.id, () => expectError(db().query("select public.bootstrap_owner($1)", [u.email]), /permission denied/));
  });

  maybe("even a direct write cannot create a second OWNER (trigger guard)", async () => {
    const u = await createUser(db());
    await expectError(db().query("update public.user_roles set role = 'OWNER' where user_id = $1", [u.id]), /OWNER role/);
  });

  maybe("the owner manages admins but can never grant OWNER", async () => {
    const { rows } = await db().query("select id from auth.users where email = $1", [OWNER_EMAIL]);
    const owner = rows[0].id as string;
    const u = await createUser(db());
    await asUserCommit(db(), owner, () => db().query("select public.admin_set_role($1, 'ADMIN')", [u.id]));
    expect((await db().query("select role from public.user_roles where user_id = $1", [u.id])).rows[0].role).toBe("ADMIN");
    await asUser(db(), owner, () => expectError(db().query("select public.admin_set_role($1, 'OWNER')", [u.id]), /invalid input|OWNER cannot/));
    // an ADMIN cannot demote the owner nor manage roles
    await asUser(db(), u.id, () => expectError(db().query("select public.admin_set_role($1, 'USER')", [owner]), /only the owner/));
  });
});

describe("credits cannot be manipulated", () => {
  maybe("users cannot update balances, subscriptions or transactions", async () => {
    const u = await createUser(db());
    await asUser(db(), u.id, async () => {
      await expectError(db().query("update public.credit_balances set minutes_used = 0 where user_id = $1", [u.id]), /permission denied/);
      await expectError(db().query("update public.subscriptions set plan_id = 'creator' where user_id = $1", [u.id]), /permission denied/);
      await expectError(
        db().query("insert into public.credit_transactions (user_id, kind, minutes) values ($1, 'admin_grant', 999)", [u.id]),
        /permission denied/,
      );
      await expectError(db().query("select public.consume_minutes($1, -100, gen_random_uuid())", [u.id]), /permission denied/);
      await expectError(db().query("select public.admin_grant_credits($1, 1000, 100, 'free money')", [u.id]), /forbidden/);
    });
  });

  maybe("free quota is enforced, debits are idempotent, refunds work", async () => {
    const u = await createUser(db());
    const v = "11111111-1111-4111-8111-" + u.id.slice(-12);
    await db().query("select public.consume_minutes($1, 20, $2)", [u.id, v]);
    await db().query("select public.consume_minutes($1, 20, $2)", [u.id, v]); // same video: no double charge
    let bal = (await db().query("select minutes_used from public.credit_balances where user_id = $1", [u.id])).rows[0];
    expect(Number(bal.minutes_used)).toBe(20);
    await expectError(db().query("select public.consume_minutes($1, 11, gen_random_uuid())", [u.id]), /insufficient_minutes/);
    await db().query("select public.refund_minutes($1, $2, 'test')", [u.id, v]);
    await db().query("select public.refund_minutes($1, $2, 'test')", [u.id, v]);
    bal = (await db().query("select minutes_used from public.credit_balances where user_id = $1", [u.id])).rows[0];
    expect(Number(bal.minutes_used)).toBe(0);
  });

  maybe("clip exports are limited per plan and the owner is unlimited", async () => {
    const u = await createUser(db());
    for (let i = 0; i < 3; i++) await db().query("select public.consume_clip($1, gen_random_uuid())", [u.id]);
    await expectError(db().query("select public.consume_clip($1, gen_random_uuid())", [u.id]), /insufficient_clips/);
    const owner = (await db().query("select id from auth.users where email = $1", [OWNER_EMAIL])).rows[0].id;
    for (let i = 0; i < 5; i++) await db().query("select public.consume_clip($1, gen_random_uuid())", [owner]);
    await db().query("select public.consume_minutes($1, 5000, gen_random_uuid())", [owner]);
  });

  maybe("expired periods reset usage", async () => {
    const u = await createUser(db());
    await db().query(
      "update public.credit_balances set minutes_used = 25, clips_used = 3, period_start = now() - interval '40 days', period_end = now() - interval '10 days' where user_id = $1",
      [u.id],
    );
    const ent = (await db().query("select public.get_entitlements($1) e", [u.id])).rows[0].e;
    expect(ent.minutes_used).toBe(0);
    expect(ent.clips_remaining).toBe(3);
    expect(new Date(ent.period_end).getTime()).toBeGreaterThan(Date.now());
  });

  maybe("admins grant credits with an audit log", async () => {
    const owner = (await db().query("select id from auth.users where email = $1", [OWNER_EMAIL])).rows[0].id;
    const u = await createUser(db());
    await asUserCommit(db(), owner, () => db().query("select public.admin_grant_credits($1, 60, 5, 'support')", [u.id]));
    const ent = (await db().query("select public.get_entitlements($1) e", [u.id])).rows[0].e;
    expect(ent.minutes_limit).toBe(90);
    expect(ent.clips_limit).toBe(8);
    const log = await db().query("select * from public.admin_logs where target_user_id = $1 and action = 'credits.grant'", [u.id]);
    expect(log.rowCount).toBe(1);
  });
});

describe("data isolation (RLS)", () => {
  maybe("users only see their own content; admins see everything", async () => {
    const a = await createUser(db());
    const b = await createUser(db());
    const p = (await db().query("insert into public.projects (user_id, name) values ($1, 'A') returning id", [a.id])).rows[0].id;
    await db().query(
      "insert into public.videos (user_id, project_id, original_filename, storage_path, mime_type, size_bytes) values ($1, $2, 'a.mp4', $3, 'video/mp4', 10)",
      [a.id, p, `${a.id}/x/source.mp4`],
    );
    const countFor = (uid: string) =>
      asUser(db(), uid, async () => (await db().query("select count(*)::int n from public.videos where user_id = $1", [a.id])).rows[0].n);
    expect(await countFor(a.id)).toBe(1);
    expect(await countFor(b.id)).toBe(0);
    const owner = (await db().query("select id from auth.users where email = $1", [OWNER_EMAIL])).rows[0].id;
    expect(await countFor(owner)).toBe(1);
    // B cannot read A's entitlements or write into A's project
    await asUser(db(), b.id, () => expectError(db().query("select public.get_entitlements($1)", [a.id]), /forbidden/));
    await asUser(db(), b.id, () =>
      expectError(db().query("insert into public.projects (user_id, name) values ($1, 'hack')", [a.id]), /row-level security/),
    );
    // anon sees nothing private
    await asUser(db(), null, () => expectError(db().query("select * from public.videos"), /permission denied/));
  });

  maybe("users can rename but not re-time or re-score their clips", async () => {
    const a = await createUser(db());
    const p = (await db().query("insert into public.projects (user_id, name) values ($1, 'A') returning id", [a.id])).rows[0].id;
    const v = (
      await db().query(
        "insert into public.videos (user_id, project_id, original_filename, storage_path, mime_type, size_bytes) values ($1, $2, 'a.mp4', $3, 'video/mp4', 10) returning id",
        [a.id, p, `${a.id}/y/source.mp4`],
      )
    ).rows[0].id;
    const clip = (
      await db().query(
        "insert into public.clips (user_id, video_id, project_id, title, start_seconds, end_seconds) values ($1, $2, $3, 't', 0, 20) returning id",
        [a.id, v, p],
      )
    ).rows[0].id;
    await asUser(db(), a.id, async () => {
      const r = await db().query("update public.clips set title = 'Nouveau' where id = $1", [clip]);
      expect(r.rowCount).toBe(1);
      await expectError(db().query("update public.clips set virality_score = 99 where id = $1", [clip]), /permission denied/);
      await expectError(db().query("update public.profiles set email = 'x@y.z' where id = $1", [a.id]), /permission denied/);
    });
  });

  maybe("uploads are only accepted at a reserved path", async () => {
    const a = await createUser(db());
    const p = (await db().query("insert into public.projects (user_id, name) values ($1, 'A') returning id", [a.id])).rows[0].id;
    const path = `${a.id}/v1/source.mp4`;
    await db().query(
      "insert into public.videos (user_id, project_id, original_filename, storage_path, mime_type, size_bytes, status) values ($1, $2, 'a.mp4', $3, 'video/mp4', 10, 'uploading')",
      [a.id, p, path],
    );
    await asUser(db(), a.id, async () => {
      await db().query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [path]);
      await expectError(
        db().query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [`${a.id}/other/evil.mp4`]),
        /row-level security/,
      );
      await expectError(db().query("insert into storage.objects (bucket_id, name) values ('exports', $1)", [`${a.id}/x.mp4`]), /row-level security/);
    });
  });
});

describe("job queue", () => {
  maybe("claim is exclusive, fair per user and retries with backoff", async () => {
    await db().query("update public.video_jobs set status = 'cancelled' where status in ('queued','running')");
    const u = await createUser(db());
    await db().query("insert into public.video_jobs (user_id, type, max_attempts) values ($1, 'process_video', 2), ($1, 'process_video', 2)", [u.id]);
    const j1 = (await db().query("select * from public.claim_next_job('w1', null)")).rows[0];
    expect(j1.status).toBe("running");
    // same user's second heavy job must wait (fairness)
    expect((await db().query("select * from public.claim_next_job('w2', null)")).rowCount).toBe(0);
    await db().query("update public.video_jobs set status = 'cancelled' where user_id = $1 and id <> $2", [u.id, j1.id]);
    expect((await db().query("select public.job_heartbeat($1, 'w2', 50, 'x') ok", [j1.id])).rows[0].ok).toBe(false);
    expect((await db().query("select public.fail_job($1, 'w1', 'boom', true) s", [j1.id])).rows[0].s).toBe("queued");
    const after = (await db().query("select status, run_after > now() later from public.video_jobs where id = $1", [j1.id])).rows[0];
    expect(after).toMatchObject({ status: "queued", later: true });
    await db().query("update public.video_jobs set run_after = now() where id = $1", [j1.id]);
    const again = (await db().query("select * from public.claim_next_job('w1', null)")).rows[0];
    expect(again.attempts).toBe(2);
    expect((await db().query("select public.fail_job($1, 'w1', 'boom', true) s", [again.id])).rows[0].s).toBe("failed");
    await db().query("update public.video_jobs set status = 'cancelled' where user_id = $1", [u.id]);
  });

  maybe("stale jobs are re-queued", async () => {
    const u = await createUser(db());
    const j = (await db().query("insert into public.video_jobs (user_id, type) values ($1, 'render_clip') returning id", [u.id])).rows[0];
    await db().query("update public.video_jobs set status = 'running', attempts = 1, heartbeat_at = now() - interval '1 hour' where id = $1", [j.id]);
    await db().query("select public.requeue_stale_jobs(300)");
    expect((await db().query("select status from public.video_jobs where id = $1", [j.id])).rows[0].status).toBe("queued");
    await db().query("update public.video_jobs set status = 'cancelled' where id = $1", [j.id]);
  });

  maybe("rate limiter blocks bursts", async () => {
    const key = `test:${Date.now()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push((await db().query("select public.rate_limit_hit($1, 60, 3) ok", [key])).rows[0].ok);
    expect(results).toEqual([true, true, true, false]);
  });
});
