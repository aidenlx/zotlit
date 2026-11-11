# Writing a ZotLit lesson

You are writing one lesson of a six-lesson course at `/learn`. ZotLit is a
plugin that brings a researcher's Zotero library into Obsidian. This brief
tells you who reads the lesson, how it should sound, and how it is built. A
separate fact sheet gives you the lesson's steps, the exact words on screen,
and the pictures.

## Who you are writing for

A researcher: a PhD student, a postdoc, a lecturer. They read papers for a
living and they are good at it. They are an expert in their field and a
beginner in this software, and they know the difference.

They come to this lesson between two other tasks, late in the day, with a
chapter due. Reading is their work, so more reading is the last thing they
want. They will give this page a few minutes. If the first screen looks like
a manual, they close the tab and go back to copying page numbers by hand.

They already keep their papers in Zotero and they have highlighted some of
them. They have Obsidian because a colleague said it was good, or they
watched a video. Many have tried to connect the two before and stopped at a
template full of code. They are a little afraid of breaking their library.

What they want is small and concrete: their highlights next to their own
notes, a citation that goes into the draft, a Word file their supervisor can
open. They do not want to understand the software. They want to get back to
the chapter.

They do the lesson with Obsidian open beside the page. They read one step,
look away, do it, and look back. Each time they look back they need to find
their place at once and know whether the last step worked.

## The voice

Write as a colleague who uses this every day and has pulled a chair up to
their desk. You are showing, at their pace, on their screen. You say what to
click and what will appear, then you wait.

Use the plain words a researcher uses for their own work: paper, highlight,
note, draft, citation, reference list, supervisor. When the screen shows a
label, use the label exactly as the fact sheet gives it, so they can match
the page to the screen.

Be calm and exact. Treat the reader as an intelligent adult who is tired.
Confidence comes from each step working, so let the result carry it. When a
step can go wrong, say what they will see and what to do, in the same even
tone as the rest.

Where a step raises a worry about their library or their writing, answer it
in one sentence at that step: what changed, and what stayed as it was.

The course follows one story. The reader is writing Chapter 3 of a thesis,
"Presenting the results". Their Zotero collection is "Reproducibility". The
paper is Sandve et al. 2013, "Ten Simple Rules for Reproducible Computational
Research". Stay inside that story; a real paper and a real chapter make each
step easy to picture.

## Show first

The picture does the teaching; your words point at it. Each step already has
a short recording of the real app doing that step, and a still frame of the
result. For anything else the reader must know, choose the smallest view that
makes it clear, and write only what the view cannot say.

- A change: before and after, side by side.
- Where things live (Zotero, Obsidian, the reader's files): a small map of
  labelled boxes and arrows.
- What an action changes and what it leaves alone: a two-column table.
- A choice between a few options: a table with one row per option.

You do not draw. For a view beyond the step's recording, write a figure
request: which view, what it shows, its labels, and a caption. A paragraph
that grows past three sentences means a view is missing; find the view.

## The shape of a lesson

A step is short enough to hold in the head while looking at another window:
about 40 words of caption, one action, then the one thing the reader sees
when it worked. A lesson has the steps the fact sheet lists, in that order.

- **Cover:** the lesson title, one sentence on what the reader will have at
  the end, and what they need before they start.
- **Each step:** a short title; the caption (the action, naming the control
  by its on-screen label); the check (what they see when it worked, stated as
  a fact about their screen); and the fixes the fact sheet lists for that
  step, each as the thing the reader sees followed by what to do.
- **End:** one sentence on what they now have, and the next lesson.

The lesson title and its one-sentence description carry the words a
researcher types into a search engine for this task; the fact sheet gives
them. The facts come from the fact sheet alone: every label, every result,
every fix. Where the fact sheet is silent, leave it out.

## What to return

Markdown, in this order: title, description, cover, then each step under a
`## Step N` heading with the parts `Title`, `Caption`, `Check`, `Fixes`, and
`Figure request` where you ask for one, then the end.
