// Edge-runtime Sentry init. Separate from sentry.server.config.ts because the
// edge runtime is a different JS environment with its own module instance — a
// single init in the Node config would leave edge code unreported.
//
// web/ currently targets the Node runtime everywhere (see next.config.ts's note
// about keeping default SSR/ISR output), so this file is mostly insurance: if
// any route or proxy.ts middleware later opts into the edge runtime, its errors
// are captured from the first deploy rather than from whenever someone notices
// the gap.
import * as Sentry from "@sentry/nextjs";

import { sentryCommonOptions } from "./lib/sentry-shared";

Sentry.init(sentryCommonOptions);
