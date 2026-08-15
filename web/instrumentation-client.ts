import { initBotId } from "botid/client/core";

// BotID runs an invisible client-side challenge and makes the verdict readable
// server-side via checkBotId(). It is an application-layer check, not a network
// one, so it keeps working with Cloudflare proxying DNS in front of Vercel —
// unlike Vercel's IP-keyed firewall rules, which only ever see Cloudflare's edge.
//
// Paths here are the URLs the browser POSTs to, which for a Server Action is the
// page that invokes it — NOT the module path of the action. Both signUp and
// signIn live on /login, so the single entry below covers the whole credential
// surface (fake-account signup and credential stuffing alike).
//
// Every protected path must have a matching checkBotId() call on the server, or
// the challenge is issued and then never read.
initBotId({
  protect: [
    {
      // app/(marketing)/login — the route group is not part of the URL.
      path: "/login",
      method: "POST",
    },
  ],
});
