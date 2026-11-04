---
name: content-ideas
description: >-
  Create, sharpen and organise short-form video ideas for the open project, and save them on its
  Ideas de contenido board. Use when asked for ideas, topics or angles, what to post next, to fill
  the board, or to judge or rewrite an idea, before a script exists. Writing the script of a chosen
  idea is video-script's.
---

# Content ideas

An idea is not a subject. It is a subject stated as something this audience wants, plus a question they need answered. Most weak ideas are what the creator wants to talk about, stated plainly: correct, and easy to swipe past.

Viewers stay for two reasons in tension. **Curiosity** stops the scroll; a **payoff** gives them permission to leave. So a good idea has both a strong question and an answer that can be held back, and the idea is planned with that in mind before any script exists.

## Read the project first

This skill is shared by every project and says nothing about any channel's subject. Each time, read from the open project only (`projects/<id>/`, or `WHERE project = '<id>'` in the index; the prompt names it):

- **Who it's for:** language, platform, audience and length, from the profile in your prompt.
- **The board:** `show` with the ideas tool named in your prompt: the verticals and their descriptions, and the cards already there. An idea already on the board gets edited, not added twice.
- **Videos already made:** `videos`. Don't repeat a topic; a second part or a series is fine.
- **The account:** `own_accounts` (bio, median) and `own_reels`: what beats its median and what falls short, with `hook_text`, `topic` and `own_beats` where analysed.
- **Inspiración:** `insp_accounts`, `insp_reels`, `insp_beats`. Adapt, never copy.
- **Measured findings,** if the creator keeps a findings file ([video-script](../video-script/SKILL.md) → Set up). They were measured on this audience, so they win over any default here.

Say what's missing rather than filling it in. Never invent a number.

## Position before generating

Write one line: **"helps [who] get [the outcome they want]"**, from the audience, the bio and the verticals. It's the test every idea answers to, and an account whose line is vague makes vague ideas.

If you can't write it, or the sources disagree (say the audience names one group and the verticals speak to another), stop and ask which is right, with your recommendation, even when asked to add ideas straight away. Don't bridge the two yourself and don't add cards until you have the answer: ideas for the wrong audience are wasted work, and a missing audience or bio on its own isn't a disagreement.

## Build an idea

1. **Collect subjects, wide.** What the creator built, learned or lived recently (ask; otherwise their latest videos), questions viewers ask, the account's winners and losers, Inspiración, news in the field from primary sources with dates, verticals with few ideas. Candidates should differ in kind, not be variations of one. They come out wider if a separate agent brainstorms from the material alone, with judging afterwards; do this when asked for many ideas.
2. **Restate it as the outcome.** Ask what the subject gets this audience, then why they want that, until you reach something they'd say themselves about their own problem. Use their words, not the expert's. The subject stays the same; only the framing changes. People don't want a technique, a tool or a concept: they want what it gets them.
3. **Open a question.** Add what they didn't expect: it's easier than they think, it costs something they haven't noticed, the usual advice is wrong, a specific result. The reaction to aim for is "wait, what?", followed by one question they could put into words. The framed topic plus this is the hook, and it says as little as possible about the answer.
4. **Plan how the answer is held.** Name the moment that closes the question. It is often a term the viewer already recognises: once they hear it they think they know the rest, and they leave. Note what can come before it (what most people get wrong, what it costs them, why the obvious alternatives fail) and what new question opens once it's said (something about it they haven't heard).

| Plainly stated | Framed, with a question open | Held back |
| --- | --- | --- |
| How to season a cast-iron pan | Everything sticks to your pan, and the pan isn't why | "Seasoning", until the viewer has seen why the usual fixes fail |
| An introduction to database indexes | Your app is slow, and the fix is one line you've never written | The word "index", until they've seen what the database does without one |
| Spaced repetition explained | You'll forget that word on a date you can predict | The method's name, until they've seen the forgetting curve in their own terms |

These show the move, not a template: write in the project's voice and for its audience.

**A topic can be right for someone else.** If only insiders, or people at another stage of life, would stop for it, find the want that reaches this audience or drop it. The creator's own story is raw material: on its own it's about them, so say what the viewer gets from it.

**The hook is a promise the video has to keep.** Everything in it must be true and backed by something the creator can show. No invented results or figures, and no guaranteed outcomes for money, health or legal subjects.

## Judge

Keep an idea only if you can answer yes to each:

- **Stake:** would this audience stop for the framed topic alone?
- **Question:** can you state the one question it opens? One the viewer can guess the answer to doesn't count.
- **Room:** is there enough before the answer to hold it? A single fact closes as soon as it's said, so it's a short video or part of another idea.
- **Proof:** can the viewer be shown it, with something the creator has or can capture?
- **Effort:** can it get from idea to posted with what exists? Between equal ideas, take the one that's quicker to make: a lot of them will flop, and volume is how the creator learns which.

Rank by evidence: the account's own reels first, Inspiración second, reasoning last, and say which one an idea rests on. "Why it should work" is a hypothesis, so word it as one, and mark a premise you couldn't confirm at its source as unverified. A pattern that failed is worth retrying as a deliberate test of a fix; hold an idea that would muddle a running test until that test is read.

Posting times, settings, hashtags, trending audio and similar hacks aren't reasons an idea will work, so don't offer them as reasons. Caption rules in the profile still apply to the caption.

## Test, don't only pick

Vary the format across ideas, not just the topic: the project's `formats/` and what's working in Inspiración are the starting points. Where the platform has a test format ([Trial Reels](../video-script/references/insights.md#testing)), mark the riskier ideas as tests. Two versions of one idea that differ mainly in the opening are one trial pair and one card, with both openings in its notes.

## Save

When asked to create or add ideas, put them on the board with the ideas tool named in your prompt, never by editing `ideas.json`. When only asked to propose or think, answer in the chat and offer to add them. Unless told a number, give 5 to 8.

- **Title:** the framed topic, short. Not the plain subject, and not the answer.
- **Vertical:** the one whose description fits, or none, and say so. Don't create a vertical unless asked; suggest one when several ideas keep landing outside the existing ones.
- **List:** the board's draft list (Borrador by default). Moving a card to another list or deleting it is the creator's call, unless asked.
- **Notes,** with this structure. Write all of the card in the project's language, these labels included:

```
Hook: the literal first 3 seconds, in the creator's voice
Question: the one it opens
Held back: what closes it, what comes before that, what it opens next
Proof: what the viewer sees
Why: the reel or account it rests on and its numbers, or "hypothesis"
Format: format and length
```

In the chat, list the ideas in a few lines each and end with your recommendation of which to script first, so "yes" is a full answer. The script is [video-script](../video-script/SKILL.md)'s and starts from these notes.

## Source

Drawn from two videos by Ryan Sterling: [the Instagram gold rush](https://www.youtube.com/watch?v=3lqpBziFZQM) and [growing on Instagram](https://www.youtube.com/watch?v=9SI0bM763pY). They report one creator's experience on Instagram in 2026, not a measured study, so this project's own numbers win where they disagree.
