# Event naming

nanoevents event names are dash-case string literals (`"refresh-failed"`), not camelCase. The name is the emit/listen contract — keep it lowercase-dashed on both sides.

In `apps/obsidian`, `nanoevents` remains only in legacy services. New events there are Effect-native ([Events](../apps/obsidian/policies/events.md)).
