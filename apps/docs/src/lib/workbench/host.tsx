import { PreviewCard } from "@base-ui/react/preview-card";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
// The web's binding of the Workbench UI host adapter: Base UI for the menu,
// the dialog, the confirmation, and the hover card; the searchable picker the
// paper choice already uses for the suggester; the browser's own tooltip; the
// status line for a notice; the render Worker; the Item Snapshot's names for a
// match; and browser storage for a preference.

import type { RenderRequest } from "@zotlit/workbench/render";
import { m } from "@zotlit/workbench/ui";
import type {
  WorkbenchConfirmRequest,
  WorkbenchDialogRequest,
  WorkbenchHost,
  WorkbenchHoverCardRequest,
  WorkbenchInsertTarget,
  WorkbenchMenuRequest,
  WorkbenchSuggesterRequest,
} from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { webCompletion } from "./completion";
import { webHover } from "./hover";
import { startRenderWorker } from "./render-client";
import { ResultSheet } from "./result-sheet";

const STORAGE_PREFIX = "zotlit.workbench.preference";

/** A request kept open until the reader answers it. */
interface Pending<Request, Answer> {
  readonly request: Request;
  readonly answer: (value: Answer) => void;
}

/** The names the snapshot's note root carries, as the Match tab needs them. */
function matchData(
  snapshot: RenderRequest["snapshot"],
): WorkbenchHost["matchData"] {
  const note = snapshot.roots.note;
  const tags = Array.isArray(note.tags)
    ? note.tags.flatMap((tag: unknown) =>
        typeof tag === "object" &&
        tag !== null &&
        "name" in tag &&
        typeof tag.name === "string"
          ? [tag.name]
          : [],
      )
    : [];
  const collections = Array.isArray(note.collections)
    ? note.collections.flatMap((collection: unknown) =>
        typeof collection === "object" &&
        collection !== null &&
        "path" in collection &&
        Array.isArray(collection.path) &&
        collection.path.every((part: unknown) => typeof part === "string")
          ? [collection.path.join("/")]
          : [],
      )
    : [];
  const { library } = snapshot.item;
  return {
    tags: () => Promise.resolve(tags),
    collections: () => Promise.resolve(collections),
    libraries: () =>
      Promise.resolve([
        {
          id:
            library.type === "personal"
              ? "personal"
              : `group:${library.groupID}`,
        },
      ]),
  };
}

export function useWebHost({
  snapshot,
  notice,
  insertTarget,
}: {
  snapshot: RenderRequest["snapshot"];
  /** Puts a sentence on the status line. */
  notice: (text: string) => void;
  insertTarget: () => WorkbenchInsertTarget | null;
}): { host: WorkbenchHost; overlays: ReactNode } {
  const [menu, setMenu] = useState<WorkbenchMenuRequest | null>(null);
  const [dialog, setDialog] = useState<WorkbenchDialogRequest | null>(null);
  const [confirm, setConfirm] = useState<Pending<
    WorkbenchConfirmRequest,
    boolean
  > | null>(null);
  const [suggester, setSuggester] = useState<Pending<
    WorkbenchSuggesterRequest,
    string | null
  > | null>(null);
  const [hoverCard, setHoverCard] = useState<WorkbenchHoverCardRequest | null>(
    null,
  );
  const search = useRef<HTMLInputElement>(null);
  // Handlers read the latest values through refs, so the host object itself
  // stays the same across renders.
  const data = useMemo(() => matchData(snapshot), [snapshot]);
  const latest = useRef({ data, notice, insertTarget });
  useLayoutEffect(() => {
    latest.current = { data, notice, insertTarget };
  }, [data, notice, insertTarget]);

  const host = useMemo<WorkbenchHost>(
    () => ({
      menu: setMenu,
      dialog(request) {
        setDialog(request);
        return { close: () => setDialog(null) };
      },
      confirm: (request) =>
        new Promise((answer) => setConfirm({ request, answer })),
      suggester: (request) =>
        new Promise((answer) => setSuggester({ request, answer })),
      tooltip: (text) => ({ title: text }),
      hoverCard(request) {
        setHoverCard(request);
        return { close: () => setHoverCard(null) };
      },
      notice: (text) => latest.current.notice(text),
      render: startRenderWorker,
      markdown: ResultSheet,
      editorPopups: (read) => [webCompletion(read), webHover(read)],
      matchData: {
        tags: () => latest.current.data.tags(),
        collections: () => latest.current.data.collections(),
        libraries: () => latest.current.data.libraries(),
      },
      insertTarget: () => latest.current.insertTarget(),
      persistence: {
        read(scope, key) {
          try {
            return localStorage.getItem(`${STORAGE_PREFIX}.${scope}.${key}`);
          } catch {
            return null;
          }
        },
        write(scope, key, value) {
          try {
            const name = `${STORAGE_PREFIX}.${scope}.${key}`;
            if (value === null) localStorage.removeItem(name);
            else localStorage.setItem(name, value);
          } catch {
            // A browser that blocks storage keeps the preference for the visit.
          }
        },
      },
    }),
    [],
  );

  function answerConfirm(value: boolean) {
    confirm?.answer(value);
    setConfirm(null);
  }

  function answerSuggester(value: string | null) {
    suggester?.answer(value);
    setSuggester(null);
  }

  const overlays = (
    <>
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
      >
        {menu && (
          <DropdownMenuContent anchor={menu.anchor} align="end">
            {menu.items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled}
                onClick={item.onSelect}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        )}
      </DropdownMenu>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (open) return;
          dialog?.onClose?.();
          setDialog(null);
        }}
      >
        {dialog && (
          <DialogContent>
            <DialogTitle className="font-sans text-base font-semibold">
              {dialog.title}
            </DialogTitle>
            {dialog.content}
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) answerConfirm(false);
        }}
      >
        {confirm && (
          <DialogContent>
            <DialogTitle className="font-sans text-base font-semibold">
              {confirm.request.title}
            </DialogTitle>
            <DialogDescription>{confirm.request.body}</DialogDescription>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" onClick={() => answerConfirm(true)}>
                {confirm.request.confirm}
              </Button>
              <DialogClose render={<Button variant="ghost" size="xs" />}>
                {confirm.request.cancel ?? m.workbench_cancel()}
              </DialogClose>
            </div>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={suggester !== null}
        onOpenChange={(open) => {
          if (!open) answerSuggester(null);
        }}
      >
        {suggester && (
          <DialogContent
            initialFocus={search}
            finalFocus={
              suggester.request.anchor
                ? () => suggester.request.anchor
                : undefined
            }
            className="max-w-xl gap-0 overflow-hidden p-0"
          >
            <DialogTitle className="sr-only">
              {suggester.request.title}
            </DialogTitle>
            <Command
              label={suggester.request.title}
              defaultValue={suggester.request.selected}
              loop
            >
              <CommandInput
                ref={search}
                aria-label={suggester.request.title}
                placeholder={
                  suggester.request.placeholder ?? suggester.request.title
                }
              />
              <CommandList className="max-h-[min(28rem,60dvh)] overscroll-contain">
                <CommandEmpty className="px-3 py-6 text-center text-sm text-fd-muted-foreground">
                  {m.workbench_sample_empty()}
                </CommandEmpty>
                {suggester.request.groups.map((group) => (
                  <CommandGroup
                    key={group.label}
                    heading={group.label}
                    forceMount={group.options.length === 0}
                  >
                    {group.options.length === 0 && (
                      <p className="px-2 py-2 text-sm text-fd-muted-foreground">
                        {group.empty}
                      </p>
                    )}
                    {group.options.map((option) => (
                      <CommandItem
                        key={option.id}
                        value={option.id}
                        keywords={[option.label, option.hint ?? ""]}
                        aria-label={
                          option.id === suggester.request.selected
                            ? m.workbench_sample_selected({
                                name: option.label,
                              })
                            : option.label
                        }
                        onSelect={() => answerSuggester(option.id)}
                        data-checked={option.id === suggester.request.selected}
                        className="min-h-11"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium break-words">
                            {option.label}
                          </span>
                          {option.hint && (
                            <span className="mt-1 block text-xs break-words text-fd-muted-foreground">
                              {option.hint}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </DialogContent>
        )}
      </Dialog>
      <PreviewCard.Root
        open={hoverCard !== null}
        onOpenChange={(open) => {
          if (!open) setHoverCard(null);
        }}
      >
        {hoverCard && (
          <PreviewCard.Portal>
            <PreviewCard.Positioner
              anchor={
                hoverCard.anchor instanceof DOMRect
                  ? { getBoundingClientRect: () => hoverCard.anchor as DOMRect }
                  : hoverCard.anchor
              }
              side="top"
              align="start"
              sideOffset={6}
              className="z-50"
            >
              <PreviewCard.Popup
                data-slot="hover-card-content"
                className="w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-fd-border bg-fd-popover p-3 text-xs text-fd-popover-foreground shadow-lg"
              >
                {hoverCard.content}
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        )}
      </PreviewCard.Root>
    </>
  );

  return { host, overlays };
}
