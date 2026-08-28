import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Verifies Row-Level Security is actually enforced by Postgres itself, not
 * just by application-layer permission checks. This matters specifically
 * because the default local-dev DATABASE_URL (README.md) connects as the
 * `postgres` superuser, which ALWAYS bypasses RLS — so every other test in
 * this repo that runs withRls() against the default local dev DB is
 * exercising application logic only, never proving the DB-level backstop
 * documented in the identity_security_foundation migration actually holds.
 *
 * Requires RLS_TEST_DATABASE_URL, pointing at the non-superuser
 * `portal_rls_test` role created by scripts/dev/create-rls-test-role.sql.
 * Skips (not fails) when unset, so this doesn't block anyone who hasn't
 * run that one-time local setup step — see the script's header comment.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: {
      userId?: string;
      isSuperAdmin?: boolean;
      permissions?: string[];
      /** Organization Core (Session 17) — see src/lib/rls.ts's RlsContext.organizationIds. */
      organizationIds?: string[];
      /** Organization Core (Session 17) — see src/lib/rls.ts's RlsContext.orgInvitationLookup. */
      orgInvitationLookup?: boolean;
      /** Session 18 (B2B & B2C Onboarding) — see src/lib/rls.ts's RlsContext.selfRegistration. */
      selfRegistration?: boolean;
      /** Session 19 (Federated Auth) — see src/lib/rls.ts's RlsContext.oauthLookup. */
      oauthLookup?: boolean;
      /** Session 20 (MFA & Account Security) — see src/lib/rls.ts's RlsContext.mfaLoginLookup. */
      mfaLoginLookup?: boolean;
    },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_ids', ${JSON.stringify(ctx.organizationIds ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.org_invitation_lookup', ${String(!!ctx.orgInvitationLookup)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.self_registration', ${String(!!ctx.selfRegistration)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.oauth_lookup', ${String(!!ctx.oauthLookup)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.mfa_login_lookup', ${String(!!ctx.mfaLoginLookup)}, true)`;
      return fn(tx);
    });
  }

  let userA: { id: string };
  let userB: { id: string };

  beforeAll(async () => {
    // Table owner/migrator-equivalent for fixture setup only — a second
    // client on the same superuser connection the rest of the suite uses,
    // so fixture writes aren't themselves subject to the RLS this suite is
    // testing.
    const setup = new PrismaClient();
    userA = await setup.user.create({
      data: { email: `rls-test-a-${randomUUID()}@example.com`, name: "RLS Test A", passwordHash: "x" },
      select: { id: true },
    });
    userB = await setup.user.create({
      data: { email: `rls-test-b-${randomUUID()}@example.com`, name: "RLS Test B", passwordHash: "x" },
      select: { id: true },
    });
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.session.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await setup.auditEvent.deleteMany({ where: { entityId: { in: [userA.id, userB.id] } } });
    await setup.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("users_select: an unauthenticated context sees no rows", async () => {
    const rows = await asContext({}, (tx) => tx.user.findMany());
    expect(rows).toHaveLength(0);
  });

  it("users_select: a user sees only their own row, not another user's", async () => {
    const rows = await asContext({ userId: userA.id }, (tx) =>
      tx.user.findMany({ where: { id: { in: [userA.id, userB.id] } } })
    );
    expect(rows.map((r) => r.id)).toEqual([userA.id]);
  });

  it("users_select: users.read permission grants visibility into another user's row", async () => {
    const rows = await asContext({ userId: userA.id, permissions: ["users.read"] }, (tx) =>
      tx.user.findMany({ where: { id: { in: [userA.id, userB.id] } } })
    );
    expect(rows.map((r) => r.id).sort()).toEqual([userA.id, userB.id].sort());
  });

  it("sessions_write: a user can only create a session row for themselves", async () => {
    await expect(
      asContext({ userId: userA.id }, (tx) =>
        tx.session.create({
          data: { userId: userB.id, expiresAt: new Date(Date.now() + 60_000) },
        })
      )
    ).rejects.toThrow();

    // Sanity: creating one's own session row is allowed.
    const own = await asContext({ userId: userA.id }, (tx) =>
      tx.session.create({
        data: { userId: userA.id, expiresAt: new Date(Date.now() + 60_000) },
      })
    );
    expect(own.userId).toBe(userA.id);
  });

  it("sessions_update: revoking another user's session fails without sessions.revoke, succeeds with it", async () => {
    const session = await asContext({ userId: userB.id }, (tx) =>
      tx.session.create({
        data: { userId: userB.id, expiresAt: new Date(Date.now() + 60_000) },
      })
    );

    // userA has no relationship to this session and no sessions.revoke —
    // the UPDATE must affect zero rows (RLS silently filters, it doesn't
    // throw, for an UPDATE whose WHERE clause matches no visible rows).
    await expect(
      asContext({ userId: userA.id }, (tx) =>
        tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
      )
    ).rejects.toThrow(); // Prisma throws P2025 (record not found) when RLS hides the target row

    const revoked = await asContext({ userId: userA.id, permissions: ["sessions.revoke"] }, (tx) =>
      tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    );
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("audit_events: insert succeeds with no authenticated context at all (e.g. a failed login)", async () => {
    // Plain INSERT, no RETURNING — matches how recordAuditEvent() actually
    // writes (see src/lib/audit.ts's comment: tx.auditEvent.create() would
    // trigger a RETURNING that the SELECT policy then rejects for an
    // unauthenticated actor, even though the INSERT policy itself is
    // unconditional).
    await expect(
      asContext(
        {},
        (tx) =>
          tx.$executeRaw`INSERT INTO audit_events (action, entity_type, entity_id) VALUES ('login.denied_suspended', 'User', ${userA.id})`
      )
    ).resolves.not.toThrow();
  });

  it("audit_events: select is denied without audit.read or super_admin", async () => {
    const rows = await asContext({ userId: userA.id }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id } })
    );
    expect(rows).toHaveLength(0);
  });

  it("audit_events: select succeeds with audit.read", async () => {
    const rows = await asContext({ userId: userA.id, permissions: ["audit.read"] }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id } })
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("feature_flags_update: toggling a flag fails without flags.manage, succeeds with it (Session 03)", async () => {
    const setup = new PrismaClient();
    const flag = await setup.featureFlag.findFirstOrThrow();
    await setup.$disconnect();

    // No relationship to the flag and no flags.manage — RLS silently
    // filters the UPDATE's WHERE clause to zero matching rows.
    await expect(
      asContext({ userId: userA.id }, (tx) =>
        tx.featureFlag.update({ where: { key: flag.key }, data: { enabled: !flag.enabled } })
      )
    ).rejects.toThrow(); // Prisma throws P2025 when RLS hides the target row

    const updated = await asContext({ userId: userA.id, permissions: ["flags.manage"] }, (tx) =>
      tx.featureFlag.update({ where: { key: flag.key }, data: { enabled: !flag.enabled } })
    );
    expect(updated.enabled).toBe(!flag.enabled);

    // Restore original state — this suite must not leak changes to a
    // table other suites/seed data depend on.
    const restore = new PrismaClient();
    await restore.featureFlag.update({ where: { key: flag.key }, data: { enabled: flag.enabled } });
    await restore.$disconnect();
  });

  it("audit_events: there is no UPDATE or DELETE policy — both fail even for super_admin", async () => {
    const [event] = await asContext({ userId: userA.id, permissions: ["audit.read"] }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id }, take: 1 })
    );
    expect(event).toBeTruthy();

    await expect(
      asContext({ isSuperAdmin: true }, (tx) =>
        tx.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } })
      )
    ).rejects.toThrow();

    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.auditEvent.delete({ where: { id: event.id } }))
    ).rejects.toThrow();
  });

  describe("Organization Core (Session 17)", () => {
    let orgA: { id: string };
    let orgB: { id: string };
    let userC: { id: string };

    beforeAll(async () => {
      const setup = new PrismaClient();
      userC = await setup.user.create({
        data: { email: `rls-test-c-${randomUUID()}@example.com`, name: "RLS Test C", passwordHash: "x" },
        select: { id: true },
      });
      // userA founds orgA and is its org_admin; userB founds orgB and is
      // its org_admin — same shape createOrganization() itself produces,
      // written directly via the superuser fixture client so these RLS
      // tests aren't themselves dependent on the app-layer function under
      // test elsewhere (organizations.test.ts).
      orgA = await setup.organization.create({ data: { name: "RLS Org A", slug: `rls-org-a-${randomUUID()}`, createdBy: userA.id } });
      await setup.organizationMembership.create({
        data: { organizationId: orgA.id, userId: userA.id, role: "org_admin", status: "active", joinedAt: new Date() },
      });
      orgB = await setup.organization.create({ data: { name: "RLS Org B", slug: `rls-org-b-${randomUUID()}`, createdBy: userB.id } });
      await setup.organizationMembership.create({
        data: { organizationId: orgB.id, userId: userB.id, role: "org_admin", status: "active", joinedAt: new Date() },
      });
      await setup.$disconnect();
    });

    afterAll(async () => {
      const setup = new PrismaClient();
      await setup.organizationInvitation.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      await setup.organizationMembership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      await setup.auditEvent.deleteMany({ where: { entityId: { in: [orgA.id, orgB.id] } } });
      await setup.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
      await setup.user.deleteMany({ where: { id: userC.id } });
      await setup.$disconnect();
    });

    it("organizations_select: an unauthenticated context sees no organizations", async () => {
      const rows = await asContext({}, (tx) => tx.organization.findMany({ where: { id: { in: [orgA.id, orgB.id] } } }));
      expect(rows).toHaveLength(0);
    });

    it("organizations_select: any authenticated user sees a non-archived organization's profile, membership or not", async () => {
      const rows = await asContext({ userId: userC.id }, (tx) => tx.organization.findMany({ where: { id: orgA.id } }));
      expect(rows.map((r) => r.id)).toEqual([orgA.id]);
    });

    it("organizations_write: created_by must equal the acting user — cannot attribute a new org to someone else", async () => {
      await expect(
        asContext({ userId: userC.id }, (tx) =>
          tx.organization.create({ data: { name: "Spoofed", slug: `spoof-${randomUUID()}`, createdBy: userA.id } })
        )
      ).rejects.toThrow();

      const own = await asContext({ userId: userC.id }, (tx) =>
        tx.organization.create({ data: { name: "Owned by C", slug: `owned-by-c-${randomUUID()}`, createdBy: userC.id } })
      );
      expect(own.createdBy).toBe(userC.id);

      const cleanup = new PrismaClient();
      await cleanup.organization.delete({ where: { id: own.id } });
      await cleanup.$disconnect();
    });

    it("organizations_update: an org_admin of orgA cannot update orgB's settings", async () => {
      await expect(
        asContext({ userId: userA.id, organizationIds: [orgA.id] }, (tx) =>
          tx.organization.update({ where: { id: orgB.id }, data: { description: "hijacked" } })
        )
      ).rejects.toThrow(); // RLS hides the target row from the UPDATE's WHERE clause -> Prisma P2025

      const updated = await asContext({ userId: userA.id, organizationIds: [orgA.id] }, (tx) =>
        tx.organization.update({ where: { id: orgA.id }, data: { description: "updated by its own org_admin" } })
      );
      expect(updated.description).toBe("updated by its own org_admin");
    });

    it("organization_memberships_write: a user may self-insert a 'pending' join request but NOT an 'active' row for themselves", async () => {
      await expect(
        asContext({ userId: userC.id }, (tx) =>
          tx.organizationMembership.create({ data: { organizationId: orgA.id, userId: userC.id, role: "org_member", status: "active" } })
        )
      ).rejects.toThrow(); // no branch of organization_memberships_write authorizes a self-granted 'active' row

      const pending = await asContext({ userId: userC.id }, (tx) =>
        tx.organizationMembership.create({ data: { organizationId: orgA.id, userId: userC.id, role: "org_member", status: "pending" } })
      );
      expect(pending.status).toBe("pending");

      const cleanup = new PrismaClient();
      await cleanup.organizationMembership.delete({ where: { id: pending.id } });
      await cleanup.$disconnect();
    });

    it("organization_memberships_select: an org_admin sees every status row in THEIR org (via the SECURITY DEFINER helper), a non-member sees none of it", async () => {
      const setup = new PrismaClient();
      const pendingRow = await setup.organizationMembership.create({
        data: { organizationId: orgA.id, userId: userC.id, role: "org_member", status: "pending" },
      });
      await setup.$disconnect();

      const asOrgAdmin = await asContext({ userId: userA.id, organizationIds: [orgA.id] }, (tx) =>
        tx.organizationMembership.findMany({ where: { id: pendingRow.id } })
      );
      expect(asOrgAdmin.map((r) => r.id)).toEqual([pendingRow.id]);

      // userB is org_admin of orgB only — must not see orgA's pending row.
      const asOtherOrgAdmin = await asContext({ userId: userB.id, organizationIds: [orgB.id] }, (tx) =>
        tx.organizationMembership.findMany({ where: { id: pendingRow.id } })
      );
      expect(asOtherOrgAdmin).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.organizationMembership.delete({ where: { id: pendingRow.id } });
      await cleanup.$disconnect();
    });

    it("organization_memberships_select: a plain active member sees the ACTIVE roster of their org via app.organization_ids, not other orgs'", async () => {
      const setup = new PrismaClient();
      const activeRow = await setup.organizationMembership.create({
        data: { organizationId: orgA.id, userId: userC.id, role: "org_member", status: "active", joinedAt: new Date() },
      });
      await setup.$disconnect();

      const sameOrgMember = await asContext({ userId: userC.id, organizationIds: [orgA.id] }, (tx) =>
        // userA's own founding membership row in orgA, visible to a fellow active member via the roster branch.
        tx.organizationMembership.findMany({ where: { organizationId: orgA.id, userId: userA.id } })
      );
      expect(sameOrgMember.length).toBeGreaterThan(0);

      const notAMemberOfB = await asContext({ userId: userC.id, organizationIds: [orgA.id] }, (tx) =>
        tx.organizationMembership.findMany({ where: { organizationId: orgB.id, userId: userB.id } })
      );
      expect(notAMemberOfB).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.organizationMembership.delete({ where: { id: activeRow.id } });
      await cleanup.$disconnect();
    });

    it("organization_invitations: an org_admin can create/select an invitation for their own org; a non-admin cannot create one at all", async () => {
      await expect(
        asContext({ userId: userC.id }, (tx) =>
          tx.organizationInvitation.create({
            data: { organizationId: orgA.id, email: "nobody@example.com", tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000), invitedBy: userC.id },
          })
        )
      ).rejects.toThrow();

      const invitation = await asContext({ userId: userA.id, organizationIds: [orgA.id] }, (tx) =>
        tx.organizationInvitation.create({
          data: { organizationId: orgA.id, email: "invitee@example.com", tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000), invitedBy: userA.id },
        })
      );

      // userB (org_admin of orgB only) must not see orgA's invitation.
      const asOtherOrgAdmin = await asContext({ userId: userB.id, organizationIds: [orgB.id] }, (tx) =>
        tx.organizationInvitation.findMany({ where: { id: invitation.id } })
      );
      expect(asOtherOrgAdmin).toHaveLength(0);

      // The pre-auth token-lookup flag (no app.user_id at all) can still find it, mirroring password_reset_lookup.
      const viaTokenLookup = await asContext({ orgInvitationLookup: true }, (tx) =>
        tx.organizationInvitation.findMany({ where: { id: invitation.id } })
      );
      expect(viaTokenLookup.map((r) => r.id)).toEqual([invitation.id]);

      const cleanup = new PrismaClient();
      await cleanup.organizationInvitation.delete({ where: { id: invitation.id } });
      await cleanup.$disconnect();
    });

    it("organization_memberships: no DELETE policy exists — removal must go through status='removed', never a real row delete, even for super_admin", async () => {
      const setup = new PrismaClient();
      const row = await setup.organizationMembership.create({
        data: { organizationId: orgA.id, userId: userC.id, role: "org_member", status: "active", joinedAt: new Date() },
      });
      await setup.$disconnect();

      await expect(
        asContext({ isSuperAdmin: true }, (tx) => tx.organizationMembership.delete({ where: { id: row.id } }))
      ).rejects.toThrow();

      const cleanup = new PrismaClient();
      await cleanup.organizationMembership.delete({ where: { id: row.id } });
      await cleanup.$disconnect();
    });
  });

  describe("Self-Registration (Session 18)", () => {
    it("users_write: a plain unauthenticated/no-permission context cannot insert a new users row", async () => {
      await expect(
        asContext({}, (tx) =>
          tx.user.create({ data: { email: `rls-reg-blocked-${randomUUID()}@example.com`, name: "Blocked", passwordHash: "x" } })
        )
      ).rejects.toThrow();
    });

    it("users_write/users_select: app.self_registration authorizes exactly one pre-auth INSERT (and its own RETURNING)", async () => {
      const email = `rls-reg-${randomUUID()}@example.com`;
      const created = await asContext({ selfRegistration: true }, (tx) =>
        tx.user.create({ data: { email, name: "Self Registered", passwordHash: "x" }, select: { id: true, email: true } })
      );
      expect(created.email.toLowerCase()).toBe(email.toLowerCase());

      // The flag doesn't linger: a plain follow-up context still can't read
      // this brand-new row (no session/permissions yet, same as any other
      // user's row).
      const asNobody = await asContext({}, (tx) => tx.user.findMany({ where: { id: created.id } }));
      expect(asNobody).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.user.delete({ where: { id: created.id } });
      await cleanup.$disconnect();
    });

    it("user_roles_write: app.self_registration authorizes attaching exactly one role to the row just created; a plain context cannot self-assign roles.manage-gated rows", async () => {
      const setup = new PrismaClient();
      const teacherRole = await setup.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
      const newUser = await setup.user.create({
        data: { email: `rls-reg-role-${randomUUID()}@example.com`, name: "Self Registered", passwordHash: "x" },
      });
      await setup.$disconnect();

      await expect(
        asContext({ userId: newUser.id }, (tx) => tx.userRole.create({ data: { userId: newUser.id, roleId: teacherRole.id } }))
      ).rejects.toThrow();

      const created = await asContext({ selfRegistration: true }, (tx) =>
        tx.userRole.create({ data: { userId: newUser.id, roleId: teacherRole.id } })
      );
      expect(created.roleId).toBe(teacherRole.id);

      const cleanup = new PrismaClient();
      await cleanup.userRole.deleteMany({ where: { userId: newUser.id } });
      await cleanup.user.delete({ where: { id: newUser.id } });
      await cleanup.$disconnect();
    });
  });

  describe("Federated Identity (Session 19)", () => {
    it("user_identities_select/write: a plain unauthenticated/no-permission context can neither read nor insert", async () => {
      const setup = new PrismaClient();
      const target = await setup.user.create({
        data: { email: `rls-oauth-plain-${randomUUID()}@example.com`, name: "Plain", passwordHash: "x" },
      });
      await setup.$disconnect();

      await expect(
        asContext({}, (tx) =>
          tx.userIdentity.create({ data: { userId: target.id, provider: "google", providerAccountId: randomUUID() } })
        )
      ).rejects.toThrow();

      const rows = await asContext({}, (tx) => tx.userIdentity.findMany({ where: { userId: target.id } }));
      expect(rows).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.user.delete({ where: { id: target.id } });
      await cleanup.$disconnect();
    });

    it("app.oauth_lookup authorizes exactly the one pre-auth SELECT/INSERT this codebase's resolveGoogleSignIn() performs", async () => {
      const setup = new PrismaClient();
      const target = await setup.user.create({
        data: { email: `rls-oauth-lookup-${randomUUID()}@example.com`, name: "Looked Up", passwordHash: "x" },
      });
      await setup.$disconnect();

      const providerAccountId = randomUUID();
      const created = await asContext({ oauthLookup: true }, (tx) =>
        tx.userIdentity.create({ data: { userId: target.id, provider: "google", providerAccountId }, select: { id: true, userId: true } })
      );
      expect(created.userId).toBe(target.id);

      const found = await asContext({ oauthLookup: true }, (tx) =>
        tx.userIdentity.findUnique({ where: { provider_providerAccountId: { provider: "google", providerAccountId } } })
      );
      expect(found?.userId).toBe(target.id);

      // The flag doesn't linger — a plain follow-up context can't read it.
      const asNobody = await asContext({}, (tx) => tx.userIdentity.findMany({ where: { id: created.id } }));
      expect(asNobody).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.userIdentity.delete({ where: { id: created.id } });
      await cleanup.user.delete({ where: { id: target.id } });
      await cleanup.$disconnect();
    });

    it("user_identities_select/write: a real app.user_id may read and link its OWN row, but not someone else's", async () => {
      const setup = new PrismaClient();
      const self = await setup.user.create({
        data: { email: `rls-oauth-self-${randomUUID()}@example.com`, name: "Self", passwordHash: "x" },
      });
      const other = await setup.user.create({
        data: { email: `rls-oauth-other-${randomUUID()}@example.com`, name: "Other", passwordHash: "x" },
      });
      await setup.$disconnect();

      await expect(
        asContext({ userId: self.id }, (tx) =>
          tx.userIdentity.create({ data: { userId: other.id, provider: "google", providerAccountId: randomUUID() } })
        )
      ).rejects.toThrow();

      const created = await asContext({ userId: self.id }, (tx) =>
        tx.userIdentity.create({
          data: { userId: self.id, provider: "google", providerAccountId: randomUUID() },
          select: { id: true, userId: true },
        })
      );
      expect(created.userId).toBe(self.id);

      const ownRows = await asContext({ userId: self.id }, (tx) => tx.userIdentity.findMany({ where: { id: created.id } }));
      expect(ownRows).toHaveLength(1);

      const cleanup = new PrismaClient();
      await cleanup.userIdentity.delete({ where: { id: created.id } });
      await cleanup.user.deleteMany({ where: { id: { in: [self.id, other.id] } } });
      await cleanup.$disconnect();
    });
  });

  describe("MFA & Account Security (Session 20)", () => {
    it("totp_credentials/recovery_codes: a plain context (no app.user_id) can neither read nor write either table", async () => {
      const setup = new PrismaClient();
      const target = await setup.user.create({
        data: { email: `rls-mfa-plain-${randomUUID()}@example.com`, name: "Plain", passwordHash: "x" },
      });
      await setup.$disconnect();

      await expect(
        asContext({}, (tx) => tx.totpCredential.create({ data: { userId: target.id, secretCiphertext: "x" } }))
      ).rejects.toThrow();
      await expect(
        asContext({}, (tx) => tx.recoveryCode.create({ data: { userId: target.id, codeHash: "x" } }))
      ).rejects.toThrow();

      expect(await asContext({}, (tx) => tx.totpCredential.findMany({ where: { userId: target.id } }))).toHaveLength(0);
      expect(await asContext({}, (tx) => tx.recoveryCode.findMany({ where: { userId: target.id } }))).toHaveLength(0);

      const cleanup = new PrismaClient();
      await cleanup.user.delete({ where: { id: target.id } });
      await cleanup.$disconnect();
    });

    it("totp_credentials/recovery_codes: a real app.user_id may read/write their OWN rows, never someone else's", async () => {
      const setup = new PrismaClient();
      const self = await setup.user.create({
        data: { email: `rls-mfa-self-${randomUUID()}@example.com`, name: "Self", passwordHash: "x" },
      });
      const other = await setup.user.create({
        data: { email: `rls-mfa-other-${randomUUID()}@example.com`, name: "Other", passwordHash: "x" },
      });
      await setup.$disconnect();

      // Cannot create a credential/recovery code FOR someone else.
      await expect(
        asContext({ userId: self.id }, (tx) => tx.totpCredential.create({ data: { userId: other.id, secretCiphertext: "x" } }))
      ).rejects.toThrow();
      await expect(
        asContext({ userId: self.id }, (tx) => tx.recoveryCode.create({ data: { userId: other.id, codeHash: "x" } }))
      ).rejects.toThrow();

      // Can create/read/update/delete their own.
      const credential = await asContext({ userId: self.id }, (tx) =>
        tx.totpCredential.create({ data: { userId: self.id, secretCiphertext: "x" }, select: { id: true, userId: true } })
      );
      expect(credential.userId).toBe(self.id);

      const readBySelf = await asContext({ userId: self.id }, (tx) => tx.totpCredential.findMany({ where: { userId: self.id } }));
      expect(readBySelf).toHaveLength(1);

      // Someone else's own context (userId: other.id) sees nothing of self's row.
      const readByOther = await asContext({ userId: other.id }, (tx) => tx.totpCredential.findMany({ where: { userId: self.id } }));
      expect(readByOther).toHaveLength(0);

      await asContext({ userId: self.id }, (tx) =>
        tx.totpCredential.update({ where: { userId: self.id }, data: { enabledAt: new Date() } })
      );

      const code = await asContext({ userId: self.id }, (tx) =>
        tx.recoveryCode.create({ data: { userId: self.id, codeHash: "abc" }, select: { id: true } })
      );
      await asContext({ userId: self.id }, (tx) => tx.recoveryCode.update({ where: { id: code.id }, data: { usedAt: new Date() } }));

      await asContext({ userId: self.id }, (tx) => tx.recoveryCode.delete({ where: { id: code.id } }));
      await asContext({ userId: self.id }, (tx) => tx.totpCredential.delete({ where: { userId: self.id } }));

      const cleanup = new PrismaClient();
      await cleanup.user.deleteMany({ where: { id: { in: [self.id, other.id] } } });
      await cleanup.$disconnect();
    });

    it("app.mfa_login_lookup authorizes exactly the narrow pre-full-session read/write completeLoginMfa() needs", async () => {
      const setup = new PrismaClient();
      const target = await setup.user.create({
        data: { email: `rls-mfa-loginlookup-${randomUUID()}@example.com`, name: "Pending Login", passwordHash: "x" },
      });
      await setup.$disconnect();

      // Without the flag, a bare userId context (mid-pending-login, same
      // shape resolveSessionAuthz()'s zeroed snapshot leaves app.user_id in)
      // can still read/write its OWN totp_credentials/recovery_codes rows —
      // that's the ordinary self-ownership branch, not what this flag is
      // for. The flag's actual job (see the migration's policy comment) is
      // narrowing WHICH pre-auth queries are allowed at all; verify it does
      // grant the same access a real self-context would, so completeLoginMfa()
      // isn't accidentally broken by relying on it.
      const credential = await asContext({ userId: target.id, mfaLoginLookup: true }, (tx) =>
        tx.totpCredential.create({
          data: { userId: target.id, secretCiphertext: "x", enabledAt: new Date() },
          select: { id: true, userId: true },
        })
      );
      expect(credential.userId).toBe(target.id);

      const found = await asContext({ userId: target.id, mfaLoginLookup: true }, (tx) =>
        tx.totpCredential.findUnique({ where: { userId: target.id } })
      );
      expect(found?.userId).toBe(target.id);

      const code = await asContext({ userId: target.id, mfaLoginLookup: true }, (tx) =>
        tx.recoveryCode.create({ data: { userId: target.id, codeHash: "xyz" }, select: { id: true } })
      );
      await asContext({ userId: target.id, mfaLoginLookup: true }, (tx) =>
        tx.recoveryCode.update({ where: { id: code.id }, data: { usedAt: new Date() } })
      );
      const consumed = await asContext({ userId: target.id, mfaLoginLookup: true }, (tx) =>
        tx.recoveryCode.findUnique({ where: { id: code.id } })
      );
      expect(consumed?.usedAt).not.toBeNull();

      const cleanup = new PrismaClient();
      await cleanup.recoveryCode.delete({ where: { id: code.id } });
      await cleanup.totpCredential.delete({ where: { userId: target.id } });
      await cleanup.user.delete({ where: { id: target.id } });
      await cleanup.$disconnect();
    });

    it("sessions_update: self may write the new mfa_required/mfa_verified_at/step_up_verified_at columns on their OWN session, never someone else's", async () => {
      const setup = new PrismaClient();
      const self = await setup.user.create({
        data: { email: `rls-mfa-session-self-${randomUUID()}@example.com`, name: "Self", passwordHash: "x" },
      });
      const other = await setup.user.create({
        data: { email: `rls-mfa-session-other-${randomUUID()}@example.com`, name: "Other", passwordHash: "x" },
      });
      const selfSession = await setup.session.create({
        data: { userId: self.id, expiresAt: new Date(Date.now() + 3600_000), mfaRequired: true },
        select: { id: true },
      });
      await setup.$disconnect();

      await asContext({ userId: self.id }, (tx) =>
        tx.session.update({ where: { id: selfSession.id }, data: { stepUpVerifiedAt: new Date(), mfaVerifiedAt: new Date() } })
      );
      const row = await asContext({ userId: self.id }, (tx) => tx.session.findUnique({ where: { id: selfSession.id } }));
      expect(row?.stepUpVerifiedAt).not.toBeNull();
      expect(row?.mfaVerifiedAt).not.toBeNull();

      // Someone else's context cannot touch self's session row at all —
      // updateMany matches zero rows rather than throwing (no WHERE-clause
      // row is visible to them), which is exactly what
      // sessions.ts's markSessionSteppedUp()/isStepUpFresh() rely on.
      const otherAttempt = await asContext({ userId: other.id }, (tx) =>
        tx.session.updateMany({ where: { id: selfSession.id }, data: { stepUpVerifiedAt: new Date() } })
      );
      expect(otherAttempt.count).toBe(0);

      const cleanup = new PrismaClient();
      await cleanup.session.delete({ where: { id: selfSession.id } });
      await cleanup.user.deleteMany({ where: { id: { in: [self.id, other.id] } } });
      await cleanup.$disconnect();
    });
  });
});
