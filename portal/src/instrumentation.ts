/**
 * Next.js instrumentation hook — its register() runs exactly once when the
 * server process starts, independent of which route/page happens to be hit
 * first. This is where Session 10 (Notifications) attaches its domain-event
 * listeners (src/lib/notifications.ts's top-level onDomainEvent(...) calls,
 * same self-subscription pattern src/lib/progress.ts already uses for
 * LessonCompleted).
 *
 * This matters specifically for Notifications because, unlike progress.ts
 * (which both emits AND listens to LessonCompleted from within the same
 * file, so the listener is guaranteed loaded by the time it could ever be
 * needed), notifications.ts is a pure CONSUMER of events emitted by other
 * modules (messaging.ts, courses.ts, attempts.ts, users.ts). Nothing else
 * in the app was otherwise guaranteed to import notifications.ts before the
 * first mutating request could fire an event — this hook closes that gap
 * once, at boot, instead of relying on import-order luck.
 *
 * Guarded to the Node.js runtime only: notifications.ts transitively
 * imports the Prisma client, which cannot run in the Edge runtime that
 * register() is also invoked under.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/notifications");
    // Session 14 (Certificates) — a pure LessonCompleted CONSUMER for its
    // best-effort issuance backstop (see src/lib/certificates.ts's header),
    // same "nothing else guarantees this module loads before the first
    // mutating request" reasoning as notifications.ts above.
    await import("@/lib/certificates");
  }
}
