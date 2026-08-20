import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mock is in place before `contacts.ts` is imported below —
// every test re-imports the module fresh, because RESEND_API_KEY is read once
// at module scope (matching lib/posthog/config.ts's house style).
const { createContact, ResendCtor } = vi.hoisted(() => {
  const createContact = vi.fn();
  // A `function`, not an arrow: `contacts.ts` calls `new Resend(...)`, and an
  // arrow function is not constructible. As an arrow this throws a TypeError
  // that the module's own catch swallows, so every assertion here fails with
  // "0 calls" and nothing points at the mock.
  const ResendCtor = vi.fn(function ResendMock() {
    return { contacts: { create: createContact } };
  });
  return { createContact, ResendCtor };
});

vi.mock("resend", () => ({ Resend: ResendCtor }));

const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();

async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv("RESEND_API_KEY", "");
  else vi.stubEnv("RESEND_API_KEY", key);
  return await import("./contacts");
}

describe("recordSignupContact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    createContact.mockReset().mockResolvedValue({ data: { id: "c_1" }, error: null });
    ResendCtor.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("records a fresh signup opted OUT of the product-updates topic", async () => {
    const { recordSignupContact, PRODUCT_UPDATES_TOPIC_ID } = await loadWithKey("re_test");

    await recordSignupContact({
      id: "u_1",
      email: "dj@example.com",
      created_at: FRESH,
      app_metadata: { provider: "google" },
    });

    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith({
      email: "dj@example.com",
      properties: { signup_provider: "google" },
      topics: [{ id: PRODUCT_UPDATES_TOPIC_ID, subscription: "opt_out" }],
    });
  });

  it("never opts a new contact IN — the consent does not exist yet", async () => {
    const { recordSignupContact } = await loadWithKey("re_test");

    await recordSignupContact({
      id: "u_1",
      email: "dj@example.com",
      created_at: FRESH,
      app_metadata: { provider: "apple" },
    });

    const payload = createContact.mock.calls[0]![0] as {
      topics: { subscription: string }[];
      unsubscribed?: boolean;
    };
    expect(payload.topics.every((t) => t.subscription === "opt_out")).toBe(true);
  });

  it("falls back to the email provider when the identity carries none", async () => {
    const { recordSignupContact } = await loadWithKey("re_test");

    await recordSignupContact({ id: "u_1", email: "dj@example.com", created_at: FRESH });

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { signup_provider: "email" } }),
    );
  });

  it("does nothing without a key — dev checkouts and early previews", async () => {
    const { recordSignupContact } = await loadWithKey(undefined);

    await recordSignupContact({
      id: "u_1",
      email: "dj@example.com",
      created_at: FRESH,
      app_metadata: { provider: "google" },
    });

    // Not merely "no contact created" — no client constructed at all.
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  it("does nothing for a returning DJ's sign-in", async () => {
    const { recordSignupContact } = await loadWithKey("re_test");

    await recordSignupContact({
      id: "u_1",
      email: "dj@example.com",
      created_at: STALE,
      app_metadata: { provider: "google" },
    });

    expect(ResendCtor).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  it("does nothing when the identity carries no address", async () => {
    const { recordSignupContact } = await loadWithKey("re_test");

    await recordSignupContact({ id: "u_1", created_at: FRESH });

    expect(createContact).not.toHaveBeenCalled();
  });

  it("resolves when Resend rejects — a signup must not fail on a CRM write", async () => {
    const { recordSignupContact } = await loadWithKey("re_test");
    createContact.mockRejectedValue(new Error("resend is down"));

    await expect(
      recordSignupContact({
        id: "u_1",
        email: "dj@example.com",
        created_at: FRESH,
        app_metadata: { provider: "google" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("isApplePrivateRelay", () => {
  it("recognises a relayed Apple address in any casing", async () => {
    const { isApplePrivateRelay } = await loadWithKey("re_test");

    expect(isApplePrivateRelay("abc123@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelay("ABC123@PrivateRelay.AppleID.com")).toBe(true);
  });

  it("leaves a real address alone, including a lookalike domain", async () => {
    const { isApplePrivateRelay } = await loadWithKey("re_test");

    expect(isApplePrivateRelay("dj@example.com")).toBe(false);
    expect(isApplePrivateRelay("dj@icloud.com")).toBe(false);
    expect(isApplePrivateRelay("dj@notprivaterelay.appleid.com.example.com")).toBe(false);
  });
});
