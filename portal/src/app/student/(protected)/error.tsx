"use client";

import { useEffect } from "react";
import { Banner, Button } from "@/components/ui";

export default function StudentPortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[student portal]", error);
  }, [error]);

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <Banner>Something went wrong loading this page. Your data is safe — try again.</Banner>
      <Button variant="secondary" onClick={reset} style={{ width: "fit-content" }}>
        Try again
      </Button>
    </div>
  );
}
