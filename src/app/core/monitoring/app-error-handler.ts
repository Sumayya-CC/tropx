import { ErrorHandler, Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { isSentryActive } from './sentry';

interface CodedError {
  code?: string;
  rejection?: unknown;
  originalError?: unknown;
}

// Firestore/Storage/Auth SDK error codes that represent an expected,
// already-handled condition (a guarded route rejecting a role, a user
// closing an auth popup) rather than a real bug — never report these.
const EXPECTED_CODES = [
  'permission-denied',
  'cancelled',
  'aborted',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
];

/**
 * Reports uncaught errors to Sentry when it's active, filtering out
 * expected/already-handled errors first so the error stream stays signal,
 * not noise. Always logs to the console too, matching Angular's default
 * ErrorHandler behavior — this adds reporting, it doesn't replace local
 * dev visibility.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error(error);

    if (!isSentryActive()) return;

    const cause = this.unwrap(error);
    if (this.isExpected(cause)) return;

    Sentry.captureException(cause);
  }

  // Angular's global error listeners (provideBrowserGlobalErrorListeners())
  // wrap unhandled promise rejections as { rejection } and some
  // framework-internal errors as { originalError } — unwrap to the real
  // cause so Sentry groups on the actual error, not the wrapper.
  private unwrap(error: unknown): unknown {
    const wrapped = error as CodedError | undefined;
    return wrapped?.rejection ?? wrapped?.originalError ?? error;
  }

  private isExpected(error: unknown): boolean {
    const code = (error as CodedError | undefined)?.code;
    return !!code && EXPECTED_CODES.includes(code);
  }
}
