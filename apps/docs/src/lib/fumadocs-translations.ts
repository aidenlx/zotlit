// Fumadocs' native UI strings, read from the root message catalogs.

import type { Translations } from "fumadocs-ui/i18n";

import { m } from "@/paraglide/messages.js";

import type { SiteLocale } from "./i18n";

/** Adapt the root catalogs to the installed native Fumadocs registry. */
export function fumadocsTranslations(locale: SiteLocale): Translations {
  return {
    "Ask AI(AI chat button)": m.docs_fumadocs_ask_ai({}, { locale }),
    "Back to Home(404 not found page)": m.docs_fumadocs_back_to_home(
      {},
      { locale },
    ),
    "Choose a language(language switcher)": m.docs_fumadocs_choose_a_language(
      {},
      { locale },
    ),
    "Choose a language(language switcher)(aria-label)":
      m.docs_fumadocs_choose_a_language({}, { locale }),
    "Close(image zoom)(aria-label)": m.docs_fumadocs_close_image_zoom(
      {},
      { locale },
    ),
    "Close Banner(banner)(aria-label)": m.docs_fumadocs_close_banner(
      {},
      { locale },
    ),
    "Close Search(search dialog)(aria-label)": m.docs_fumadocs_close_search(
      {},
      { locale },
    ),
    "Close Sidebar(aria-label)": m.docs_fumadocs_close_sidebar({}, { locale }),
    "Close Sidebar(sidebar)(aria-label)": m.docs_fumadocs_close_sidebar(
      {},
      { locale },
    ),
    "Collapse Sidebar(sidebar)(aria-label)": m.docs_fumadocs_collapse_sidebar(
      {},
      { locale },
    ),
    "Copied Anchor Link(heading anchor)(aria-label)":
      m.docs_fumadocs_copied_anchor_link({}, { locale }),
    "Copied Link(accordion)(aria-label)": m.docs_fumadocs_copied_link(
      {},
      { locale },
    ),
    "Copied Markdown(page actions)": m.docs_fumadocs_copied_markdown(
      {},
      { locale },
    ),
    "Copied Text(code block)(aria-label)": m.docs_fumadocs_copied_text(
      {},
      { locale },
    ),
    "Copy Anchor Link(heading anchor)(aria-label)":
      m.docs_fumadocs_copy_anchor_link({}, { locale }),
    "Copy Link(accordion)(aria-label)": m.docs_fumadocs_copy_link(
      {},
      { locale },
    ),
    "Copy Markdown(page actions)": m.docs_fumadocs_copy_markdown(
      {},
      { locale },
    ),
    "Copy Text(code block)(aria-label)": m.docs_fumadocs_copy_text(
      {},
      { locale },
    ),
    "Dark(theme switcher)(aria-label)": m.docs_fumadocs_dark({}, { locale }),
    "Default(type table)": m.docs_fumadocs_default({}, { locale }),
    "Edit on GitHub(edit page)": m.docs_fumadocs_edit_on_github({}, { locale }),
    "Hide Sidebar(sidebar)": m.docs_fumadocs_hide_sidebar({}, { locale }),
    "Image Viewer(image zoom)(aria-label)": m.docs_fumadocs_image_viewer(
      {},
      { locale },
    ),
    "Language(language switcher)": m.docs_fumadocs_language({}, { locale }),
    "Last updated on(page footer)": m.docs_fumadocs_last_updated_on(
      {},
      { locale },
    ),
    "Layout Tab(layout tab trigger)": m.docs_fumadocs_layout_tab(
      {},
      { locale },
    ),
    "Light(theme switcher)(aria-label)": m.docs_fumadocs_light({}, { locale }),
    "Next Image(image zoom)(aria-label)": m.docs_fumadocs_next_image(
      {},
      { locale },
    ),
    "Next Page(pagination)": m.docs_fumadocs_next_page({}, { locale }),
    "No Headings(table of contents)": m.docs_fumadocs_no_headings(
      {},
      { locale },
    ),
    "No results found(search dialog)": m.docs_fumadocs_no_results_found(
      {},
      { locale },
    ),
    "On this page(table of contents)": m.docs_fumadocs_on_this_page(
      {},
      { locale },
    ),
    "Open Search(search trigger)(aria-label)": m.docs_fumadocs_open_search(
      {},
      { locale },
    ),
    "Open Sidebar(aria-label)": m.docs_fumadocs_open_sidebar({}, { locale }),
    "Open Sidebar(sidebar)(aria-label)": m.docs_fumadocs_open_sidebar(
      {},
      { locale },
    ),
    "Open in ChatGPT(page actions)": m.docs_fumadocs_open_in_chatgpt(
      {},
      { locale },
    ),
    "Open in Claude(page actions)": m.docs_fumadocs_open_in_claude(
      {},
      { locale },
    ),
    "Open in Cursor(page actions)": m.docs_fumadocs_open_in_cursor(
      {},
      { locale },
    ),
    "Open in GitHub(page actions)": m.docs_fumadocs_open_in_github(
      {},
      { locale },
    ),
    "Open in Scira AI(page actions)": m.docs_fumadocs_open_in_scira_ai(
      {},
      { locale },
    ),
    "Open(page actions)": m.docs_fumadocs_open({}, { locale }),
    "Options(aria-label)": m.docs_fumadocs_options({}, { locale }),
    "Page Not Found(404 not found page)": m.docs_fumadocs_page_not_found(
      {},
      { locale },
    ),
    "Parameters(type table)": m.docs_fumadocs_parameters({}, { locale }),
    "Previous Image(image zoom)(aria-label)": m.docs_fumadocs_previous_image(
      {},
      { locale },
    ),
    "Previous Page(pagination)": m.docs_fumadocs_previous_page({}, { locale }),
    "Prop(type table)": m.docs_fumadocs_prop({}, { locale }),
    // Fumadocs interpolates its URL after the message reaches its provider.
    "Read {url}, I want to ask questions about it.(page actions)":
      m.docs_fumadocs_read_url_prompt({ url: "{url}" }, { locale }),
    "Returns(type table)": m.docs_fumadocs_returns({}, { locale }),
    "Search(search dialog)": m.docs_fumadocs_search({}, { locale }),
    "Search(search trigger)": m.docs_fumadocs_search({}, { locale }),
    "Search failed(search dialog)": m.docs_fumadocs_search_failed(
      {},
      { locale },
    ),
    // Fumadocs interpolates the query after the message reaches its provider.
    "Search failed, showing results for {query}(search dialog)":
      m.docs_fumadocs_search_failed_fallback({ query: "{query}" }, { locale }),
    "Show Sidebar(sidebar)": m.docs_fumadocs_show_sidebar({}, { locale }),
    "System(theme switcher)(aria-label)": m.docs_fumadocs_system(
      {},
      { locale },
    ),
    "Theme(site menu)": m.docs_fumadocs_theme({}, { locale }),
    "Table of Contents(inline table of contents)":
      m.docs_fumadocs_table_of_contents({}, { locale }),
    "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)":
      m.docs_fumadocs_not_found_description({}, { locale }),
    "Toggle Menu(home layout header)(aria-label)": m.docs_fumadocs_toggle_menu(
      {},
      { locale },
    ),
    "Toggle Theme(theme switcher)(aria-label)": m.docs_fumadocs_toggle_theme(
      {},
      { locale },
    ),
    "Type(type table)": m.docs_fumadocs_type({}, { locale }),
    "View as Markdown(page actions)": m.docs_fumadocs_view_as_markdown(
      {},
      { locale },
    ),
    displayName: m.docs_fumadocs_language_name({}, { locale }),
  };
}
