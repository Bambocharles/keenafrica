import { prisma } from "@/lib/db";

/**
 * k8s liveness/readiness target (Session 16 — Production Hardening).
 * k8s/portal-prod.yaml had no probes at all before this session — a wedged
 * or still-starting container was invisible to Kubernetes, which would
 * keep routing traffic to it (no readiness gate) and never restart a hung
 * one (no liveness gate). Deliberately outside src/middleware.ts's tenant
 * rewrite (excluded in its matcher, same as /auth) — kubelet's probe
 * request has no *.keenafrica.com Host header to resolve a tenant from,
 * and would otherwise 404 before ever reaching this route.
 *
 * Checks real DB connectivity, not just "the Node process is alive" — a
 * pod that can't reach Postgres can't serve any real request either, and
 * that's exactly the failure mode a liveness/readiness probe exists to
 * catch. Intentionally unauthenticated (no session/tenant context exists
 * to check against) and returns no data beyond ok/not-ok.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
