// Read-only listing of document keys in R2 buckets for scripts/r2_doc_audit.mjs. GET only (CF-ESTATE-1 style).
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID in env; node scripts/r2_list_keys.mjs qnfo-projects qnfo-ddocs > keys.jsonl
const tok = process.env.CLOUDFLARE_API_TOKEN, acct = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!tok || !acct) { console.error("r2_list_keys: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required"); process.exit(2); }
for (const bucket of process.argv.slice(2)) {
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/${bucket}/objects`);
    u.searchParams.set("per_page", "1000");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!j.success) { console.error(`r2_list_keys: ${bucket} failed ${r.status} ${JSON.stringify(j.errors).slice(0, 200)}`); process.exit(3); }
    for (const o of j.result) console.log(JSON.stringify({ bucket, key: o.key, size: o.size }));
    cursor = j.result_info?.cursor || "";
    if (!cursor) break;
  }
}
