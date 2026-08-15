// Split from actions.ts: a "use server" file may only export async functions,
// so the shared state type/initial value live here instead
// (https://nextjs.org/docs/messages/invalid-use-server-value).
export type AuthActionState = {
  status: "idle" | "error" | "check-email" | "signed-in";
  fieldErrors?: { email?: string; password?: string; form?: string };
};

export const INITIAL_AUTH_STATE: AuthActionState = { status: "idle" };
