#!/usr/bin/env node
// Generates the ES256 JWT that Sign In with Apple uses as an OAuth client_secret.
// Apple caps the lifetime at ~183 days — regenerate before it expires (no auto-refresh).
//
// Usage:
//   node supabase/generate-apple-client-secret.mjs <path-to-AuthKey.p8> <team-id> <key-id> <services-id>
//
// Never commit the .p8 file or the generated JWT. Paste the JWT straight into the
// Supabase Dashboard (prod project → Authentication → Providers → Apple → Secret Key).

import { readFileSync } from "node:fs";
import { createPrivateKey, createSign } from "node:crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function main() {
  const [, , keyPath, teamId, keyId, clientId] = process.argv;
  if (!keyPath || !teamId || !keyId || !clientId) {
    console.error(
      "Usage: node supabase/generate-apple-client-secret.mjs <path-to-.p8> <team-id> <key-id> <services-id>",
    );
    process.exit(1);
  }

  const privateKey = createPrivateKey({
    key: readFileSync(keyPath, "utf8"),
    format: "pem",
  });

  const now = Math.floor(Date.now() / 1000);
  const maxLifetimeSeconds = 60 * 60 * 24 * 180; // stay under Apple's ~183-day hard cap

  const header = { alg: "ES256", kid: keyId };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + maxLifetimeSeconds,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const signature = createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });

  const jwt = `${signingInput}.${base64url(signature)}`;

  console.log(jwt);
  console.error(`\nExpires: ${new Date((now + maxLifetimeSeconds) * 1000).toISOString()} — regenerate before then.`);
}

main();
