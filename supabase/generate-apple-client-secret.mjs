#!/usr/bin/env node
// Generates the ES256 JWT that Sign In with Apple uses as an OAuth client_secret.
// Apple caps the lifetime at ~183 days — regenerate before it expires (no auto-refresh).
//
// Usage:
//   node supabase/generate-apple-client-secret.mjs --key <path-to-AuthKey.p8> --team-id <team-id> --key-id <key-id> --client-id <services-id>
//
// Named flags are deliberate, not cosmetic: --team-id and --key-id are both
// opaque 10-char alphanumeric strings, so positional args made a transposed
// pair (e.g. swapping Team ID and Key ID) indistinguishable by format alone —
// it would pass silently and only fail once tested against Apple's live
// servers. Named flags turn that into a much rarer, more visible mistake
// (typing the wrong flag name), and this script still cross-checks the
// resolved values against Apple's format below as a second line of defense.
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
const USAGE =
  "Usage: node supabase/generate-apple-client-secret.mjs --key <path-to-.p8> --team-id <team-id> --key-id <key-id> --client-id <services-id>";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function parseArgs(argv) {
  const flags = { key: null, "team-id": null, "key-id": null, "client-id": null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!(flag in flags) || value === undefined) {
      console.error(`Error: unrecognized or incomplete flag "${argv[i] ?? ""}".\n\n${USAGE}`);
      process.exit(1);
    }
    flags[flag] = value;
  }
  const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => `--${k}`);
  if (missing.length > 0) {
    console.error(`Error: missing required flag(s): ${missing.join(", ")}.\n\n${USAGE}`);
    process.exit(1);
  }
  return flags;
}

function main() {
  const { key: keyPath, "team-id": teamId, "key-id": keyId, "client-id": clientId } = parseArgs(
    process.argv.slice(2),
  );

  if (!APPLE_ID_FORMAT.test(teamId)) {
    console.error(
      `Error: --team-id ("${teamId}") doesn't look like an Apple Team ID (expected 10 alphanumeric characters).`,
    );
    process.exit(1);
  }
  if (!APPLE_ID_FORMAT.test(keyId)) {
    console.error(
      `Error: --key-id ("${keyId}") doesn't look like an Apple Key ID (expected 10 alphanumeric characters).`,
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
  if (privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    console.error(
      `Error: the key at "${keyPath}" is on curve "${privateKey.asymmetricKeyDetails?.namedCurve ?? "unknown"}", not P-256 (prime256v1). ES256 requires P-256 — Apple's servers will reject a JWT signed with any other curve.`,
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

  let signature;
  try {
    signature = createSign("SHA256")
      .update(signingInput)
      .end()
      .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  } catch (err) {
    console.error(`Error: failed to sign the JWT with the provided key: ${err.message}`);
    process.exit(1);
  }

  const jwt = `${signingInput}.${base64url(signature)}`;

  console.log(jwt);
  console.error(`\nExpires: ${new Date((now + maxLifetimeSeconds) * 1000).toISOString()} — regenerate before then.`);
}

main();
