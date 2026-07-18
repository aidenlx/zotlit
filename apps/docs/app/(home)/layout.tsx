import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Header } from "@/layouts/home/slots/header";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    // Editorial serif voice covers the whole (home) chrome — the class lands on
    // the layout container, which wraps the nav as well as the page content.
    // /docs stays on the sans stack. The wordmark is exempt: <Logo> sets
    // font-brand explicitly.
    <HomeLayout
      {...baseOptions()}
      className="font-serif"
      slots={{ header: Header }}
    >
      {children}
    </HomeLayout>
  );
}
