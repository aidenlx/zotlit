---
name: be-ambitious
description: Makes a task or prompt more ambitious using Felix Rieseberg's types of ambition, Altitude (aim at the outcome, the goal beyond the goal), Depth (work like the best expert in the field, from the raw data, checked by an outside judge) and Range (bring in other fields and do what their experts do). Writes the ambitious plan and a rewritten prompt, then does the work when it was handed a task. Use when the user types /be-ambitious, says "be more ambitious", "aim higher", "go deeper on this", "what's the goal beyond the goal", "what would a top expert do here", "raise the bar", or asks to make a prompt more ambitious.
license: MIT
metadata:
  author: RoboNuggets
  source: https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/
---

# Be ambitious

Every idea here comes from Felix Rieseberg's article [How to be more ambitious: a tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/) (13 Oct 2026). Felix works on Claude at Anthropic. This skill turns his article into steps an agent can follow.

Most people use a model at the size of the task they typed. Model skills grow unevenly, "astounding in some directions, while inadequate in others" (Terence Tao), so the only way to find the astounding parts is to aim higher than feels reasonable.

## The rules that matter most

1. **Better, not bigger.** Each type raises something: the outcome (Altitude), the standard (Depth) or the set of perspectives (Range). None of them means more deliverables, features or side quests. If a suggestion makes the job larger without making it better, drop it.
2. **Do what the expert does, not how they talk.** When you bring in a field, use its methods and instruments. Switching vocabulary without switching methods is role play: the transcript gets weirder and the result stays the same.
3. **An outside judge decides if it worked.** Never grade your own work. Find something other than you or the user that shows the result is right: a test, a benchmark, a reproduction, held-out data, a measurement. Best of all is a tool you can run to get feedback at once.
4. **Treat the hard target as reasonable.** If a goal looks impossible, assume it's solvable and keep going. Specific hard goals beat "do your best" (Locke and Latham's review of 35 years of goal-setting research, which Felix cites). Report honestly against the judge: a missed hard target with real numbers is a good result. A faked one is not.
5. **Get the access, don't fake it.** All of this needs a computer you can install software on and access to the real data, through MCP connectors (plug-ins that link an agent to other apps) or other means. If either is missing, name exactly what's missing and what it would unlock. Never invent a source, tool or result to fill the gap.

## Input

The task is whatever follows `/be-ambitious`. If nothing follows, use the user's most recent request. If there's none, ask for the task in one line and stop.

Then decide what you were handed:

- **A task to do** (fix this, build this, analyse this): plan it at the ambitious level, then do it.
- **A prompt to improve** (a rewrite request, or a task meant for another agent or tool): stop after the rewritten prompt.

If you can't tell which, stop after the rewritten prompt.

## Pick the types that fit

Felix names four types of ambition. **Speed** (the same work in less time) is how most people already use AI and needs no creativity, so he skips it, and so does this skill. Use the other three only where they fit. Most tasks need one or two.

| Type | Fits when | Skip when |
|---|---|---|
| Altitude | The task serves an outcome. A good tell: people will hold meetings about it | Creative work with no outcome beyond itself |
| Depth | The task should be done really well | Throwaway work |
| Range | The result has to land with people, or the obvious field has run out of ideas | A narrow fix with one right answer |

### Altitude: aim at the outcome

Ask what the user wants to happen next. What's the goal beyond the goal? Felix used to ask Claude to fix single crashes. Then he asked it to keep the apps crash-free.

Build a ladder of three rungs, each more ambitious than the last. Felix's example is a quarterly business review (QBR) deck:

1. **Understand, don't fill in.** Skip updating the numbers in the template. Take in all the data you can get and work out "what changed this quarter, why, and what we should do about it."
2. **Get to the decisions.** "Work out which three decisions are most urgent in the face of everything you've learned, and start working on potential directions with for/against arguments."
3. **Replace the ritual.** "The review exists so leadership catches problems early and moves money and people to the right places. Design a better way to do that than a quarterly deck, show from our own history that it would have caught things sooner, and run it beside the current one for a quarter."

The top rung is where durable workflows live, ones that take the human out of the loop. They often need setup first. Before Claude could keep Felix's apps crash-free, it needed to fetch crash reports, map each app version to its git commit, and use Windows, macOS and Linux machines to reproduce and verify fixes. Name that setup as part of the plan.

Know the ceiling. "Go make money" is still too high for most businesses. If a rung has no outside judge, step down one rung.

### Depth: work like the field's best

Go one level below the task, to the underlying data, tools and problems. Keep pushing until even the best people in the field could learn something from the work.

- **Use the expert's instruments.** Not just their words. Where you'd reach for a markdown table, a top data scientist reaches for a database and a statistical model. The user doesn't need to know what the experts use. You usually do.
- **Set an unreasonable goal, and treat it as reasonable.** The page loads in 10 seconds and the user asked for 5? Aim for 200 milliseconds.
- **Challenge what everyone believes.** Get the raw data and test the belief adversarially: "We believe churn is an onboarding problem. Try to reproduce that from the raw data."
- **Produce new knowledge.** Once you're deep in the data, look for blind spots: "Build a simulation of our customers that reproduces the last year from our logs. Then find the earliest signal of churn we don't know about yet, and show it predicts on data it has not seen."
- **Bring in an outside judge** (rule 3).

Run every Depth pass through Felix's prompt:

> I want a deeper version of this task, not a bigger one. Before rewriting it: (1) say what a top professional in this field would do here that I'm not asking for; (2) name the rawest material they would start from instead of what has already been digested for me; (3) name the specific methods and tools they would use; (4) say what, other than you or me, would show the result is right. Then rewrite my prompt to ask for exactly that.

### Range: bring in other fields

Look at the work through more fields than used to be affordable. Every heist movie spends its first 30 minutes assembling the crew. Felix sees the most magic here, and it takes the most creativity.

- **Replace the nouns with verbs.** A trick from *The Art of Innovation* by Tom Kelley and Jonathan Littman. A quarterly review isn't "a deck". It's "getting busy people to believe a story about cause and effect, and to decide under uncertainty, in 30 minutes". The verbs show which fields can help.
- **Assemble the crew.** Raise the stakes: the deck has to be amazing or aliens blow up Earth, so who does humanity send? For quality: an analyst, a journalist and an editor. If it's presented: a motion designer and an audio designer. As a red team: a short seller and a forensic accountant.
- **Borrow their tools.** A field brings its software, not only its ideas. Felix's colleague Alex Albert renders interior designs in Blender, a 3D tool.
- **Do, don't play** (rule 2). Don't write like a short seller. Do what a short seller does to research a position. If you can run subagents, give each field its own subagent with that field's method and tools.

## Output

Size the output to the task: a one-line prompt gets a few lines of plan, because the rewritten prompt is the product. In this order:

1. **The goal beyond the goal**, in one line.
2. **The types that fit**, one line each on why, plus the ones you skipped.
3. **The plan** for each type you picked. Altitude: the three-rung ladder. Depth: the four answers from Felix's prompt and the hard target. Range: the verbs, then the crew as field, the job they'd actually do, and the method or tool they'd use for it.
4. **What it needs**: the data, tools and access, marked as already there or missing.
5. **The rewritten prompt** in one fenced block the user can copy, written the way they'd type it, ending with the outside judge and what counts as a pass.
6. **Next.** Pick the highest rung you can finish and check with the access you have now. For a prompt to improve, name that rung and stop. For a task to do, name it in one line and start. If even the first rung needs access you don't have, ask for it and stop. Ask first, too, when the rung replaces what the user asked for instead of raising it, spends money, or can't be undone. Ambition raises the standard, not the permissions.

## A short example

`/be-ambitious fix the crash in the login screen`

- **Goal beyond the goal:** people can always log in.
- **Types:** Altitude and Depth. Range skipped, since a crash fix has one right answer.
- **Altitude ladder:** (1) fix this crash with a test that fails before and passes after; (2) find every crash of this kind in the crash reports and fix the cause, not the symptom; (3) keep login crash-free: fetch crash reports, map versions to commits, reproduce on every platform, fix and verify without waiting to be asked.
- **Depth:** start from the raw crash dumps and logs, not the bug report. Reproduce before you fix. Target zero login crashes in the next release, not fewer.
- **Outside judge:** the failing test turns green, and the crash rate in the reporting tool drops to zero for that build.

## Why this works

Felix ends on self-efficacy: people who believe in their own abilities accomplish more, and that belief can be hacked. George Dantzig solved two unsolved statistics problems in 1939 because he thought they were homework. Roger Bannister broke the four-minute mile in 1954, and someone else broke it 46 days later. *The Inner Game of Tennis* argues you play your best when you stop trying so hard. The same holds for the user and the model: say the hard thing is possible, and give permission to fail against an honest judge.
