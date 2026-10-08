// Reads how many lifetime spots are used on each Stripe payment link and writes data/lifetime.json.
// Needs STRIPE_LIFETIME_KEY: a Stripe restricted key with "Payment Links: Read" (nothing else).
import fs from "node:fs";
const KEY = process.env.STRIPE_LIFETIME_KEY;
if (!KEY) { console.log("No STRIPE_LIFETIME_KEY secret yet, skipping."); process.exit(0); }
const FILE = "data/lifetime.json";
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
let changed = false;
for (const t of data.tiers) {
  const r = await fetch("https://api.stripe.com/v1/payment_links/" + t.plink, { headers: { Authorization: "Bearer " + KEY } });
  const j = await r.json();
  if (!r.ok) { console.log("Stripe error for " + t.id + ": " + (j.error && j.error.message)); process.exit(1); }
  const cs = (j.restrictions && j.restrictions.completed_sessions) || {};
  const next = { limit: cs.limit ?? t.limit, sold: cs.count ?? t.sold, active: !!j.active };
  for (const k of Object.keys(next)) if (t[k] !== next[k]) { t[k] = next[k]; changed = true; }
  console.log(`${t.id} $${t.price}: ${t.sold}/${t.limit} sold, link ${t.active ? "active" : "OFF"}`);
}
if (changed) { data.updated = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n"); console.log("Updated " + FILE); }
else console.log("No change.");
