// The ZoteroReads event Streams shared by the service and its plain adapter.
import { Stream } from "@/lib/effect";
import type { Stream as StreamType } from "@/lib/effect";
import { filterTag } from "@/lib/effect-stream";

import type { ZoteroReads, ZoteroReadsEvent } from "./service";

type EventsSource = Pick<ZoteroReads["Service"], "events">;
type EventOf<Tag extends ZoteroReadsEvent["_tag"]> = Extract<
  ZoteroReadsEvent,
  { _tag: Tag }
>;

const byTag = <Tag extends ZoteroReadsEvent["_tag"]>(
  source: EventsSource,
  tag: Tag,
) => filterTag(source.events, tag);

export function refreshRequested(
  source: EventsSource,
): StreamType.Stream<void> {
  return byTag(source, "refresh-requested").pipe(Stream.map(() => undefined));
}

export function changed(source: EventsSource): StreamType.Stream<void> {
  return byTag(source, "changed").pipe(Stream.map(() => undefined));
}

export function degraded(
  source: EventsSource,
): StreamType.Stream<EventOf<"degraded">["error"]> {
  return byTag(source, "degraded").pipe(Stream.map((event) => event.error));
}

export function refreshFailed(
  source: EventsSource,
): StreamType.Stream<EventOf<"refresh-failed">["error"]> {
  return byTag(source, "refresh-failed").pipe(
    Stream.map((event) => event.error),
  );
}

export function refreshing(source: EventsSource): StreamType.Stream<boolean> {
  return byTag(source, "refreshing").pipe(Stream.map((event) => event.active));
}

export function dbFileMissing(source: EventsSource): StreamType.Stream<void> {
  return byTag(source, "db-file-missing").pipe(Stream.map(() => undefined));
}
