import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/kit";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-8">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex">
          <Wordmark />
        </Link>
        <section className="glass-card mt-5 p-5 sm:p-7">{children}</section>
      </div>
    </main>
  );
}
