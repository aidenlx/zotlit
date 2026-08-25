import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Hello World</h1>
        <p className="text-sm text-neutral-600">ZotLit · website</p>
      </header>
    </main>
  );
}
