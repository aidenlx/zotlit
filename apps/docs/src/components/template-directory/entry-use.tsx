// An entry page's "How to use it" steps: where the reader puts the entry in Obsidian, in the plugin's own UI Labels.

import { asMarkdown } from "fumadocs-core/server";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import type { ReactNode } from "react";

import { Command } from "@/components/command";
import { Message } from "@/components/message";
import { SettingsPath } from "@/components/settings-path";
import { UiLabel } from "@/components/ui-label";
import type { EntryDetails, SiteEntry } from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

import { copyLabel } from "./labels";

const MERGE_LABEL = {
  replace: m.workbench_properties_merge_replace,
  append: m.workbench_properties_merge_append,
  keep: m.workbench_properties_merge_keep,
} satisfies Record<
  Extract<EntryDetails, { kind: "property" }>["merge"],
  () => string
>;

export function EntryUse({
  entry,
}: {
  entry: Pick<SiteEntry, "id" | "kind" | "title" | "details">;
}) {
  // The Markdown edition renders these steps too; see `lib/template-directory/markdown-edition.tsx`.
  asMarkdown();
  const copy = <strong>{copyLabel(entry.kind)}</strong>;
  const slug = entry.id.split("/")[1] ?? "";
  switch (entry.details.kind) {
    case "profile":
      return (
        <Steps>
          <li>
            <p>
              <Message
                text={m.docs_directory_profile_step_one_click({
                  import: "{import}",
                })}
                slots={{ import: <UiLabel name={m.docs_directory_import()} /> }}
              />
            </p>
            <p>{m.docs_directory_profile_step_fallback()}</p>
            <ul>
              <Step
                text={m.docs_directory_profile_step_copy({ copy: "{copy}" })}
              >
                {{ copy }}
              </Step>
              <Step
                text={m.docs_directory_profile_step_import({
                  command: "{command}",
                  clipboard: "{clipboard}",
                  file: "{file}",
                })}
              >
                {{
                  command: (
                    <Command inline name={m.command_import_profile_name()} />
                  ),
                  clipboard: <UiLabel name={m.profile_import_clipboard()} />,
                  file: <UiLabel name={m.profile_import_file()} />,
                }}
              </Step>
            </ul>
          </li>
          <Step
            text={m.docs_directory_profile_step_confirm({
              confirm: "{confirm}",
            })}
          >
            {{ confirm: <UiLabel name={m.profile_import_confirm()} /> }}
          </Step>
          <Step text={m.docs_directory_profile_step_create({ name: "{name}" })}>
            {{ name: <strong>{entry.title}</strong> }}
          </Step>
        </Steps>
      );
    case "partial": {
      const { context, call } = entry.details;
      return (
        <>
          <Steps>
            <Step
              text={m.docs_directory_partial_step_add({
                path: "{path}",
                add: "{add}",
                name: "{name}",
              })}
            >
              {{
                path: (
                  <SettingsPath
                    page={m.settings_page_profiles()}
                    setting={m.settings_partials_heading()}
                  />
                ),
                add: <UiLabel name={m.settings_partial_add()} />,
                name: <code>{slug}</code>,
              }}
            </Step>
            <Step
              text={m.docs_directory_partial_step_paste({ copy: "{copy}" })}
            >
              {{ copy }}
            </Step>
            <li>
              {context === "citation" ? (
                m.docs_directory_partial_step_call_citation()
              ) : (
                <Message
                  text={m.docs_directory_partial_step_call({ tab: "{tab}" })}
                  slots={{
                    tab: (
                      <UiLabel
                        name={
                          context === "note"
                            ? m.workbench_tab_note()
                            : m.workbench_tab_annotation()
                        }
                      />
                    ),
                  }}
                />
              )}
              <CallCode call={call} />
            </li>
          </Steps>
          <p>{m.docs_directory_partial_file()}</p>
        </>
      );
    }
    case "citation":
      return (
        <Steps>
          <Step
            text={m.docs_directory_citation_step_open({
              path: "{path}",
              row: "{row}",
              open: "{open}",
            })}
          >
            {{
              path: <SettingsPath page={m.settings_page_citations()} />,
              row: <UiLabel name={m.settings_citation_text_name()} />,
              open: <UiLabel name={m.settings_citation_text_open()} />,
            }}
          </Step>
          <Step
            text={m.docs_directory_step_replace_tab({
              copy: "{copy}",
              tab: "{tab}",
            })}
          >
            {{ copy, tab: <UiLabel name={m.workbench_tab_citation()} /> }}
          </Step>
        </Steps>
      );
    case "note-name":
      return (
        <Steps>
          <OpenProfileStep tab={m.workbench_tab_name_and_folder()} />
          <Step
            text={m.docs_directory_step_replace_field({
              copy: "{copy}",
              field: "{field}",
            })}
          >
            {{
              copy,
              field: <UiLabel name={m.workbench_name_filename_heading()} />,
            }}
          </Step>
        </Steps>
      );
    case "property": {
      const { key, merge } = entry.details;
      if (key === null) {
        return (
          <Steps>
            <OpenProfileStep tab={m.workbench_tab_properties()} />
            <Step
              text={m.docs_directory_property_step_add_spread({
                spread: "{spread}",
                copy: "{copy}",
              })}
            >
              {{
                spread: <UiLabel name={m.workbench_properties_add_spread()} />,
                copy,
              }}
            </Step>
            <Step
              text={m.docs_directory_property_step_merge({
                merge: "{merge}",
                choice: "{choice}",
              })}
            >
              {{
                merge: <UiLabel name={m.workbench_properties_merge()} />,
                choice: <UiLabel name={MERGE_LABEL[merge]()} />,
              }}
            </Step>
          </Steps>
        );
      }
      return (
        <Steps>
          <OpenProfileStep tab={m.workbench_tab_properties()} />
          <li>
            <p>
              <Message
                text={m.docs_directory_property_step_add({ add: "{add}" })}
                slots={{ add: <UiLabel name={m.workbench_properties_add()} /> }}
              />
            </p>
            <table>
              <thead>
                <tr>
                  <th>{m.docs_directory_input()}</th>
                  <th>{m.docs_directory_value()}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_name()} />
                  </td>
                  <td>
                    <code>{key}</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_format()} />
                  </td>
                  <td>
                    <UiLabel name={m.workbench_properties_format_rule()} />
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_expression()} />
                  </td>
                  <td>
                    <Message
                      text={m.docs_directory_property_paste({
                        copy: "{copy}",
                      })}
                      slots={{ copy }}
                    />
                  </td>
                </tr>
                <tr>
                  <td>
                    <UiLabel name={m.workbench_properties_merge()} />
                  </td>
                  <td>
                    <UiLabel name={MERGE_LABEL[merge]()} />
                  </td>
                </tr>
              </tbody>
            </table>
          </li>
        </Steps>
      );
    }
  }
}

function Steps({ children }: { children: ReactNode }) {
  asMarkdown();
  return <ol>{children}</ol>;
}

/** The Liquid a Profile writes to call a partial, as a code block. */
function CallCode({ call }: { call: string }) {
  if (asMarkdown()) {
    return (
      <pre>
        <code className="language-liquid">{call}</code>
      </pre>
    );
  }
  return (
    <CodeBlock className="not-prose">
      <Pre className="px-4">{call}</Pre>
    </CodeBlock>
  );
}

/** One step: a sentence of the site's catalog with the plugin's UI Labels in its slots. */
function Step({
  text,
  children,
}: {
  text: string;
  children: Record<string, ReactNode>;
}) {
  asMarkdown();
  return (
    <li>
      <Message text={text} slots={children} />
    </li>
  );
}

function OpenProfileStep({ tab }: { tab: LocalizedString }) {
  asMarkdown();
  return (
    <Step
      text={m.docs_directory_open_profile_step({
        path: "{path}",
        edit: "{edit}",
        tab: "{tab}",
      })}
    >
      {{
        path: <SettingsPath page={m.settings_page_profiles()} />,
        edit: <UiLabel name={m.settings_profile_edit()} />,
        tab: <UiLabel name={tab} />,
      }}
    </Step>
  );
}
