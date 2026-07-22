"use client";
// Last-resort root boundary for errors thrown in the root layout itself.
import "./global.css";
import { ErrorPage } from "@/components/error-page";

export default function GlobalError({
  error: _error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <title>Something went wrong</title>
        <ErrorPage status="500" onReset={() => window.location.reload()} />
      </body>
    </html>
  );
}
