import { createFileRoute } from "@tanstack/react-router";

import { ServicePolicy, servicePolicyHead } from "@/components/service-policy";

export const Route = createFileRoute("/_home/privacy")({
  component: () => <ServicePolicy kind="privacy" />,
  head: () => servicePolicyHead("privacy"),
});
