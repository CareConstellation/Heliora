import * as Sentry from '@sentry/nextjs';
import { getSentryOptions } from '@/lib/sentry';

// Sample rates, trace propagation and PII scrubbing live in src/lib/sentry.ts so
// every runtime applies the same policy.
Sentry.init(getSentryOptions('client'));
