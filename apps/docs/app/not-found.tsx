// Branded full-page 404, rendered for unmatched routes and thrown notFound().
import { type Metadata } from "next";

import { ErrorPage } from "@/components/error-page";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <ErrorPage status="404" />;
}
