"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./layout.module.css";

/**
 * Session 36 (Keen Africans — Profile & Identity). Replaces the static
 * avatar div every portal's topbar used to render with a real dropdown —
 * this session's own explicit acceptance criterion ("the header shows a
 * real avatar-or-initials account menu, not static text"). Vanilla
 * click-toggle + outside-click/Escape-close, same shape Session 35's
 * homepage portal-login dropdown already established for this codebase
 * (no dropdown/menu library exists here).
 *
 * Structurally open to Session 37: that session adds Security/Settings
 * sub-items to this same menu (email, password, MFA — see the /account
 * page's own comment for why those live there, not here) — add new
 * <a role="menuitem"> rows below, don't rebuild this component.
 */

interface AccountMenuProps {
  name: string;
  email: string;
  avatarAssetId: string | null;
  username: string;
  signOutAction: () => Promise<void>;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AccountMenu({ name, email, avatarAssetId, username, signOutAction }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.accountMenu} ref={rootRef}>
      <button
        type="button"
        className={styles.avatarButton}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu-dropdown"
        title={email}
      >
        {avatarAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/avatars/${avatarAssetId}`} alt="" className={styles.avatarImg} />
        ) : (
          <span className={styles.avatar}>{initials(name, email)}</span>
        )}
      </button>

      {open && (
        <div id="account-menu-dropdown" role="menu" className={styles.accountDropdown}>
          <div className={styles.accountDropdownHeader}>
            <div className={styles.userName}>{name}</div>
            <div className={styles.userEmail}>{email}</div>
          </div>
          <a role="menuitem" href={`/u/${username}`} target="_blank" rel="noreferrer" className={styles.accountDropdownItem}>
            View my profile ↗
          </a>
          <a role="menuitem" href="/articles/new" className={styles.accountDropdownItem}>
            Write an article
          </a>
          <a role="menuitem" href="/dashboard" className={styles.accountDropdownItem}>
            My articles
          </a>
          <div className={styles.accountDropdownDivider} />
          <a role="menuitem" href="/profile" className={styles.accountDropdownItem}>
            Profile
          </a>
          <a role="menuitem" href="/account" className={styles.accountDropdownItem}>
            Account
          </a>
          <a role="menuitem" href="/security" className={styles.accountDropdownItem}>
            Security
          </a>
          <div className={styles.accountDropdownDivider} />
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className={styles.accountDropdownItemButton}>
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
