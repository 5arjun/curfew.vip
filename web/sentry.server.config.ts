// Node-runtime Sentry init. Loaded by `instrumentation.ts`'s register() hook,
// which Next.js runs once per server process before any request is handled.
// Options live in lib/sentry-shared.ts so this runtime can't drift from the
// browser and edge ones.
import * as Sentry from "@sentry/nextjs";

import { sentryCommonOptions } from "./lib/sentry-shared";

Sentry.init(sentryCommonOptions);
