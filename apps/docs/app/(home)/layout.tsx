import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Header } from "@/layouts/home/slots/header";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    // Serif is opt-in per surface (see DESIGN.md type roles), not blanket-
    // inherited here: the app-wide default is sans (Inter, via the <html>
    // font-family). Each (home) page roots its own `font-serif` on its <main>;
    // shared chrome (nav, banner, search) stays on the sans/mono stack.
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
      {children}
    </HomeLayout>
  );
}
