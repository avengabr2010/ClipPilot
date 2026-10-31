// Secure OWNER initialisation.
//   cd web && npm run owner:init
// Reads OWNER_EMAIL + SUPABASE_SERVICE_ROLE_KEY from the environment (or .env.local),
// records the owner e-mail server-side and promotes that account once its
// e-mail is verified. Re-run it after changing OWNER_EMAIL: the previous owner
// is demoted automatically (there is always at most one OWNER).
import { existsSync, readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.OWNER_EMAIL;
if (!url || !key || !email) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OWNER_EMAIL.");
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/rpc/bootstrap_owner`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_email: email }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Owner bootstrap failed:", body);
  process.exit(1);
}
console.log("Owner configuration:", body);
if (!body.user_found) console.log(`→ Create an account with ${email}; it becomes OWNER as soon as the e-mail is verified.`);
else if (!body.email_confirmed) console.log(`→ Verify the e-mail of ${email}; it becomes OWNER automatically.`);
else console.log(`→ ${email} is now OWNER (unlimited premium, admin panel).`);
