// Split from actions.ts: a "use server" file may only export async functions,
// so the shared state type/initial value live here instead — same pattern as
// web/app/login/auth-state.ts.
export type PhoneActionState = {
  status: "idle" | "error";
  error?: string;
};

export const INITIAL_PHONE_STATE: PhoneActionState = { status: "idle" };
