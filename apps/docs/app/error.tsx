"use client";
// Route-level runtime-error boundary; wires the shared 500 view's reset exit.
import { ErrorPage } from "@/components/error-page";

export default function Error({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPage status="500" onReset={reset} />;
}
