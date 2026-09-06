// The shared searchable dialog for choosing a paper or one annotation example.

import { ArrowLeftRight } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { m } from "@/paraglide/messages.js";

export interface SampleOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function SampleSuggester({
  id,
  title,
  label,
  selected,
  groups,
  onSelect,
}: {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly selected: string;
  readonly groups: readonly {
    readonly heading: string;
    readonly options: readonly SampleOption[];
    readonly empty?: string;
  }[];
  readonly onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs" title={label}>
        {label}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          ref={trigger}
          id={id}
          aria-label={title}
          title={title}
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-sm [&_svg]:size-3.5"
            />
          }
        >
          <ArrowLeftRight aria-hidden />
        </DialogTrigger>
        <DialogContent
          initialFocus={search}
          finalFocus={trigger}
          className="max-w-xl gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <Command label={title} defaultValue={selected} loop>
            <CommandInput ref={search} aria-label={title} placeholder={title} />
            <CommandList className="max-h-[min(28rem,60dvh)] overscroll-contain">
              <CommandEmpty className="px-3 py-6 text-center text-sm text-fd-muted-foreground">
                {m.workbench_sample_empty()}
              </CommandEmpty>
              {groups.map((group) => (
                <CommandGroup
                  key={group.heading}
                  heading={group.heading}
                  forceMount={group.options.length === 0}
                >
                  {group.options.length === 0 && (
                    <p className="px-2 py-2 text-sm text-fd-muted-foreground">
                      {group.empty}
                    </p>
                  )}
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, option.description]}
                      aria-label={
                        option.value === selected
                          ? m.workbench_sample_selected({ name: option.label })
                          : option.label
                      }
                      onSelect={() => {
                        onSelect(option.value);
                        setOpen(false);
                      }}
                      data-checked={option.value === selected}
                      className="min-h-11"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="mt-1 block text-xs break-words text-fd-muted-foreground">
                            {option.description}
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
      </Dialog>
    </div>
  );
}
