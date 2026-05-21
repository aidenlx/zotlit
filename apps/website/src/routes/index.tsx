import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <h1 className="p-8 text-2xl font-semibold">Hello, ZotLit.</h1>;
}
