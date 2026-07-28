#!/usr/bin/env node
// Generates the ES256 JWT that Sign In with Apple uses as an OAuth client_secret.
// Apple caps the lifetime at ~183 days — regenerate before it expires (no auto-refresh).
//
// Usage:
//   node supabase/generate-apple-client-secret.mjs <path-to-AuthKey.p8> <team-id> <key-id> <services-id>
//
// Never commit the .p8 file or the generated JWT. Paste the JWT straight into the
// Supabase Dashboard (prod project → Authentication → Providers → Apple → Secret Key).
//
// Security note: this prints a live OAuth client_secret to stdout, and Team
// ID/Key ID/Services ID pass through as plain CLI args — both can land in
// shell history and terminal scrollback. Prefer a shell with history disabled
// for this command (or `HISTCONTROL=ignorespace`/a leading space, on shells
// that honor it), and clear scrollback after copying the JWT into the
// Dashboard. If a generated secret or the .p8 key ever leaks, revoke/rotate
// the key in the Apple Developer Portal (Certificates, IDs & Profiles → Keys)
// immediately, then regenerate here with the replacement key.

import { readFileSync } from "node:fs";
import { createPrivateKey, createSign } from "node:crypto";

const APPLE_ID_FORMAT = /^[A-Za-z0-9]{10}$/;

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

  if (!APPLE_ID_FORMAT.test(teamId)) {
    console.error(
      `Error: <team-id> ("${teamId}") doesn't look like an Apple Team ID (expected 10 alphanumeric characters). Check you haven't swapped it with <key-id>.`,
    );
    process.exit(1);
  }
  if (!APPLE_ID_FORMAT.test(keyId)) {
    console.error(
      `Error: <key-id> ("${keyId}") doesn't look like an Apple Key ID (expected 10 alphanumeric characters). Check you haven't swapped it with <team-id>.`,
    );
    process.exit(1);
  }

  let privateKey;
  try {
    privateKey = createPrivateKey({
      key: readFileSync(keyPath, "utf8"),
      format: "pem",
    });
  } catch (err) {
    console.error(`Error: couldn't read or parse the private key at "${keyPath}": ${err.message}`);
    process.exit(1);
  }
  if (privateKey.asymmetricKeyType !== "ec") {
    console.error(
      `Error: the key at "${keyPath}" is a ${privateKey.asymmetricKeyType ?? "unknown"} key, not EC/P-256. Apple's Sign In with Apple key must be the .p8 downloaded from the Apple Developer Portal's "Keys" section.`,
    );
    process.exit(1);
  }

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
