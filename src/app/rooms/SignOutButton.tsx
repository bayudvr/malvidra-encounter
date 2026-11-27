"use client";

import { encounterPath } from "@/lib/encounter-activity";
import { Button } from "@/components/ui";

export function SignOutButton() {
  return (
    <form action={encounterPath("/auth/signout")} method="post">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
