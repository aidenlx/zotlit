import { atom, createStore, Provider, useAtom } from "jotai";
import { type App, Modal, type Plugin } from "obsidian";
import { type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import AutosizeTextarea from "react-textarea-autosize";

import { Button } from "@/components/obsidian/button";
import { Color } from "@/components/obsidian/color";
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
} from "@/components/obsidian/dropdown";
import { IconButton } from "@/components/obsidian/icon-button";
import { SearchInput } from "@/components/obsidian/search-input";
import { Slider } from "@/components/obsidian/slider";
import { Toggle } from "@/components/obsidian/toggle";
import { tooltipAttrs } from "@/lib/utils";

// Playground for `@/components/obsidian/*`. Hidden behind __DEV__ in zt-main.

const toggleAtom = atom(false);
const sliderAtom = atom(50);
const colorAtom = atom("#22aaff");
const themeAtom = atom<string>("light");
const textAtom = atom("");
const numberAtom = atom("42");
const textareaAtom = atom("");
const searchAtom = atom("");

function Row({
  name,
  description,
  children,
}: {
  name: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {description != null && (
          <div className="setting-item-description">{description}</div>
        )}
      </div>
      <div className="setting-item-control" style={{ gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Heading({ title }: { title: string }) {
  return (
    <div className="setting-item setting-item-heading">
      <div className="setting-item-info">
        <div className="setting-item-name">{title}</div>
      </div>
    </div>
  );
}

function Playground() {
  const [toggle, setToggle] = useAtom(toggleAtom);
  const [slider, setSlider] = useAtom(sliderAtom);
  const [color, setColor] = useAtom(colorAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const [text, setText] = useAtom(textAtom);
  const [num, setNum] = useAtom(numberAtom);
  const [textarea, setTextarea] = useAtom(textareaAtom);
  const [search, setSearch] = useAtom(searchAtom);
  const [loading, setLoading] = useState(false);
  const [favorite, setFavorite] = useState(false);

  return (
    <>
      <Heading title="Button" />
      <Row name="Variants">
        <Button>Default</Button>
        <Button variant="cta">CTA</Button>
        <Button variant="warning">Warning</Button>
        <Button variant="destructive">Destructive</Button>
      </Row>
      <Row name="With icon">
        <Button icon="save" variant="cta">
          Save
        </Button>
        <Button icon="trash-2" variant="destructive">
          Delete
        </Button>
      </Row>
      <Row name="Loading" description="Click to toggle mod-loading + aria-busy">
        <Button
          variant="cta"
          loading={loading}
          onClick={() => setLoading((v) => !v)}
        >
          {loading ? "Saving…" : "Save"}
        </Button>
      </Row>
      <Row
        name="Tooltip via aria-label"
        description="Hover to see the Obsidian tooltip"
      >
        <Button variant="cta" {...tooltipAttrs("Saves the current file")}>
          Save
        </Button>
        <Button {...tooltipAttrs("Top placement", { placement: "top" })}>
          Tooltip ↑
        </Button>
      </Row>
      <Row name="Disabled">
        <Button variant="cta" disabled>
          Disabled CTA
        </Button>
      </Row>

      <Heading title="Icon button" />
      <Row name="Default">
        <IconButton icon="settings" {...tooltipAttrs("Settings")} />
        <IconButton icon="search" {...tooltipAttrs("Search")} />
      </Row>
      <Row name="Active toggle" description="Click to flip is-active">
        <IconButton
          icon="star"
          active={favorite}
          onClick={() => setFavorite((v) => !v)}
          {...tooltipAttrs(favorite ? "Unfavorite" : "Favorite")}
        />
      </Row>
      <Row name="Warning / disabled">
        <IconButton icon="trash-2" warning {...tooltipAttrs("Delete")} />
        <IconButton
          icon="trash-2"
          warning
          disabled
          {...tooltipAttrs("Delete (disabled)")}
        />
      </Row>

      <Heading title="Toggle" />
      <Row name="Default" description={`value: ${toggle}`}>
        <Toggle value={toggle} onChange={setToggle} />
      </Row>
      <Row name="Small">
        <Toggle value={toggle} onChange={setToggle} size="small" />
      </Row>
      <Row name="Disabled (on)">
        <Toggle value disabled onChange={() => {}} />
      </Row>
      <Row name="Disabled (off)">
        <Toggle value={false} disabled onChange={() => {}} />
      </Row>

      <Heading title="Color" />
      <Row name="Swatch" description={color}>
        <Color value={color} onChange={setColor} />
        <Color value={color} disabled onChange={() => {}} />
      </Row>

      <Heading title="Slider" />
      <Row name="Default" description={`value: ${slider} (commit on release)`}>
        <Slider
          value={slider}
          className="zt:bg-(--hello-world)"
          onChange={setSlider}
          min={0}
          max={100}
        />
      </Row>
      <Row name="Instant" description="onChange fires while dragging">
        <Slider value={slider} onChange={setSlider} min={0} max={100} instant />
      </Row>
      <Row
        name="Dynamic tooltip"
        description="Hover to see the live value via Obsidian's tooltip"
      >
        <Slider
          value={slider}
          onChange={setSlider}
          min={0}
          max={100}
          instant
          dynamicTooltip
        />
      </Row>
      <Row name="Stepped (step=10)">
        <Slider
          value={slider}
          onChange={setSlider}
          min={0}
          max={100}
          step={10}
        />
      </Row>
      <Row name="Fractional (step=0.01) + tooltip">
        <Slider
          value={slider / 100}
          onChange={(v) => setSlider(Math.round(v * 100))}
          min={0}
          max={1}
          step={0.01}
          instant
          dynamicTooltip
        />
      </Row>
      <Row name="Disabled">
        <Slider value={slider} onChange={() => {}} min={0} max={100} disabled />
      </Row>

      <Heading title="Text input" />
      <Row name="Default" description={`value: ${text || "(empty)"}`}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="Type something…"
        />
      </Row>
      <Row name="Password">
        <input
          type="password"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="••••••"
        />
      </Row>
      <Row name="Number" description={`value: ${num}`}>
        <input
          type="number"
          value={num}
          onChange={(e) => setNum(e.currentTarget.value)}
        />
      </Row>
      <Row name="With tooltip">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          {...tooltipAttrs("Free-form notes")}
        />
      </Row>
      <Row name="Disabled">
        <input type="text" value="read-only" disabled />
      </Row>

      <Heading title="Textarea" />
      <Row name="Default" description={`length: ${textarea.length}`}>
        <textarea
          value={textarea}
          onChange={(e) => setTextarea(e.currentTarget.value)}
          placeholder="Multi-line text…"
          rows={4}
        />
      </Row>
      <Row name="Disabled">
        <textarea value="read-only multi-line content" disabled rows={2} />
      </Row>
      <Row name="Autosize" description={`length: ${textarea.length}`}>
        <AutosizeTextarea
          value={textarea}
          onChange={(event) => setTextarea(event.currentTarget.value)}
          placeholder="Auto-growing textarea…"
          minRows={2}
          maxRows={8}
        />
      </Row>

      <Heading title="Search input" />
      <Row name="Default" description={`value: ${search || "(empty)"}`}>
        <SearchInput value={search} onChange={setSearch} />
      </Row>
      <Row name="Custom placeholder">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter items…"
        />
      </Row>
      <Row name="Disabled">
        <SearchInput value="locked query" onChange={() => {}} disabled />
      </Row>

      <Heading title="Dropdown" />
      <Row name="With items + group" description={`value: ${theme}`}>
        <Dropdown value={theme} onChange={setTheme}>
          <DropdownItem value="light">Light</DropdownItem>
          <DropdownItem value="dark">Dark</DropdownItem>
          <DropdownGroup label="Auto">
            <DropdownItem value="system">Match system</DropdownItem>
            <DropdownItem value="time">Time of day</DropdownItem>
          </DropdownGroup>
        </Dropdown>
      </Row>
      <Row name="Disabled">
        <Dropdown value={theme} disabled onChange={() => {}}>
          <DropdownItem value={theme}>{theme}</DropdownItem>
        </Dropdown>
      </Row>
    </>
  );
}

export class ReactSmokeModal extends Modal {
  readonly #store = createStore();
  #root: Root | null = null;

  constructor(app: App) {
    super(app);
    this.setTitle("Component playground");
  }

  override onOpen(): void {
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <Provider store={this.#store}>
        <Playground />
      </Provider>,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
  }
}

export function registerReactSmoke(
  plugin: Pick<Plugin, "addCommand">,
  deps: { app: App },
): void {
  plugin.addCommand({
    id: "react-smoke",
    name: "Open component playground",
    callback: () => {
      new ReactSmokeModal(deps.app).open();
    },
  });
}
