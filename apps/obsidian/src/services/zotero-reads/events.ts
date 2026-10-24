// The ZoteroReads event Streams shared by the service and its plain adapter.
import { Stream } from "@/lib/effect";
import type { Stream as StreamType } from "@/lib/effect";

import type { ZoteroReads, ZoteroReadsEvent } from "./service";

type EventsSource = Pick<ZoteroReads["Service"], "events">;
type EventOf<Tag extends ZoteroReadsEvent["_tag"]> = Extract<
  ZoteroReadsEvent,
  { _tag: Tag }
>;

export function refreshRequested(
  source: EventsSource,
): StreamType.Stream<void> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "refresh-requested"),
    Stream.map(() => undefined),
  );
}

export function changed(source: EventsSource): StreamType.Stream<void> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "changed"),
    Stream.map(() => undefined),
  );
}

export function degraded(
  source: EventsSource,
): StreamType.Stream<EventOf<"degraded">["error"]> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "degraded"),
    Stream.map((event) => event.error),
  );
}

export function refreshFailed(
  source: EventsSource,
): StreamType.Stream<EventOf<"refresh-failed">["error"]> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "refresh-failed"),
    Stream.map((event) => event.error),
  );
}

export function refreshing(source: EventsSource): StreamType.Stream<boolean> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "refreshing"),
    Stream.map((event) => event.active),
  );
}

export function dbFileMissing(source: EventsSource): StreamType.Stream<void> {
  return source.events.pipe(
    Stream.filter((event) => event._tag === "db-file-missing"),
    Stream.map(() => undefined),
  );
}
