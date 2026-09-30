---
title: Folded abstract
summary: The item's abstract in a folded callout, at hand without taking over the note.
minAppVersion: "2.2.0-beta.2"
context: note
tasks: [general-reading]
features: [abstract]
problems:
  - The abstract takes up the whole top of my note.
  - I want the abstract in the note but out of the way.
keywords:
  - abstract
  - abstractNote
  - callout
  - collapsed
  - fold
  - summary
audience: Readers who build their own profile and want the abstract in every note.
effort: Add the partial to your template folder and call it from your profile's note body.
---

The abstract appears in an `abstract` callout that starts folded; select its title to open it. An abstract with several paragraphs keeps them. When the item has no abstract, the partial writes nothing.

The partial reads the note's data. Call it from the note body of a profile, inside the managed block:

```liquid
{% render "folded-abstract" with zt as zt -%}
```

To show the abstract open, change `[!abstract]-` to `[!abstract]+` in the partial.
