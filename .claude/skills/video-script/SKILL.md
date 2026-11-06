---
name: video-script
description: >-
  Write short-form video scripts that hold viewers, using the creator's own video analytics. Use
  when choosing the hook of a chosen idea, writing or tightening a script before filming
  (talking-head or narrated explainer), or turning a posted video's insights into lessons. Coming
  up with ideas is content-ideas'.
---

# Video script

A short video is mostly decided before filming, by three choices: the **stake** (who, beyond insiders, has a reason to care), the **first two sentences** (why keep watching), and the **proof** (what the viewer sees that makes the claim real). Make each choice from evidence: the creator's own past videos first, platform statements second, taste last.

What the viewer watches for is the answer to a question. Curiosity keeps them and each answer gives them a reason to leave, so a script is a balance between the two: open a question early, and don't close it until there's another one open.

## Set up

`SKILL_DIR` means this skill's folder. Read `~/.video-script/profile.md` if it exists: it names the creator's video library, findings file, platform notes, voice and pace. Before proposing anything, read the findings file (including tests still running) and the library index, and cite the past videos an idea resembles. Where the findings conflict with a default below, the findings win: they were measured on this audience.

In a Reel Studio project, also read its audience profile if the creator filled it in (Perfil de audiencia, `config/audience.json`; [content-ideas](../content-ideas/SKILL.md) → Read the project first says what each field is). Its problems, wants and levels are the audience's own words, chosen by the creator: they win over your guesses about who watches and why.

With no profile, ask once for the platform, the audience, and a past video that did well and one that didn't, with their numbers. Then offer to create the profile and a library in the [library format](references/library.md).

**Goal** means what a video is built for: reach (views from non-followers), follows, saves or shares. When the request names none, assume reach and say so.

The tasks here are **Script** and **Review** of a posted video; ideas go to content-ideas. This skill ends at a script or a lesson: filming is the creator's, editing video-edit's, animation animated-video's.

## Ideas

Coming up with ideas and saving them is [content-ideas](../content-ideas/SKILL.md)'s. When a script starts from one, its notes already say the hook, the question it opens, what is held back and the proof: start from them, and check them against the source before relying on them.

## Script

State the idea in one sentence, with its goal. An idea that needs two sentences is two videos; ask which to make first.

Find the payoff and the strongest proof before the hook, then write the hook in two parts: the topic stated as the outcome this audience wants, in their words about their problem (with an audience profile, the problem from its list that the video is about, worded as it is there), then the most surprising true claim or proof you have, which opens a question the viewer could put into words. Don't name the subject when naming it would answer that question. Draft at the creator's pace (from the profile; default 3 spoken words a second). Three moments are tied to the clock, and the stretch between them follows one rule; the rest takes the story's own shape:

- **0–3 s, the hook**: about the viewer's stake or what's on screen. Credentials come later, as the reason to believe; a result the viewer wants counts as a stake when it opens the question.
- **3–10 s, the second sentence**: raises the hook's stakes or sharpens its question, without answering it. A want's "so I can" steps in the audience profile are stakes in the audience's words: what the answer would let them do, and what changes for them. Most avoidable losses happen here, so background waits. Background is anything the viewer needs only to follow a later detail (history, who someone is, how something works); the test: if moving a line past 15 s loses nothing in the first 15, it's background.
- **In between, the answer is held**: the payoff isn't one moment. Name the line that closes the hook's question, often a term the viewer recognises: once they hear it they think they know the rest. Before it goes what leads there and is worth hearing by itself: what most people get wrong, what it costs them, why the obvious alternatives fail. When it's finally said, the same breath opens a new question, something about it they haven't heard. Holding back means giving them something else meanwhile; a line that only teases or says "stay until the end" isn't holding, it's filler.
- **The end**: the final payoff, the hook's promise shown on screen, then at most one short call to action. If the profile has a product, the problem's `productAware` thought is the doubt a call to action about it must answer; never claim more for the product than the profile says. Anything after the payoff plays to a leaving audience.

For an **explainer** (how something works), read [explainers](references/explainers.md) before drafting.

Beside every line, write what the viewer sees and the capture it needs (screen recording, document, the real person or product). A line nobody could draw is one the viewer has to hold in their head. For an animated film this column is a note to animated-video, which designs the world.

Deliver, and save where the profile says: the script as time, spoken line and on-screen picture; the capture list; a draft caption carrying the caveats and links the spoken script can't, whose opening raises the hook's question rather than answering it; the estimated runtime; alternative hooks, each with its own second sentence, when the opening is still open; and the claims to verify, with sources (flag any source you couldn't open). Have a fresh agent check each claim as worded in the script against its source: research that is right can still be overstated in the script.

When the creator rewrites some lines, carry the stylistic differences to the lines you still own. Keep their wording unless asked to edit it, and raise factual problems in it separately.

### Checklist

Hold the script against these, the findings file and the platform notes before delivering it:

- One idea. A list earns its place only when every item proves that idea.
- With an audience profile: the hook names one of its problems or wants in its words, and speaks to one level of awareness (its thought in `levels` sounds like something this viewer would think).
- The stake is framed by who it affects and what they want, in words a non-expert knows. Tool names and jargon come once the viewer has a reason to care.
- Read as the viewer: at each line, ask whether you'd now feel you know the answer and leave. If so before the planned point, move the line or open the next question there. Say what closes the hook's question and when.
- Every claim is shown. Voice, caption and screen give the same number.
- Every promise in the hook is paid off on screen.
- Every sentence, read on its own, says who does what to what, and where any result goes. Replace omitted objects and ambiguous references with the noun; keep pronouns whose referent is clear. Revisions break this, so check again after each one.
- Lines are full, connected sentences in the creator's voice (the voice guide the profile names), easy to say aloud. A line cut so short that it raises a question ("the full route" of what?) costs more than the seconds it saves.
- Each line moves the story forward (a line that restates the one before or announces what's coming doesn't), and the runtime is as short as the story allows.

## Review a posted video

- Record every number: views, viewers, average watch time, follows, interaction counts, each rate with its label, views by source, and the retention curve with its duration ([reading insights](references/insights.md)). From a screenshot, read the curve with `python3 SKILL_DIR/scripts/retention_curve.py SHOT --duration SECONDS` and check its area-based average against the app's figure. Identify each screenshot's video from its thumbnail, graph dates and view count; ask when that evidence can't decide.
- Line the curve up with the final render's captions: for every cliff and plateau, record what was said and shown in the seconds before it. Compare with the library: videos in the same format, and every video's 3→10 s drop.
- Name the next version when there's one worth making: the smallest change that addresses what you found, such as a new hook or a cut where people left, or what a video that beat the others did differently and how to repeat it.
- Write the video's library entry and index row, then update the findings file: add the evidence to each hypothesis it touches, and change a status only when two or more videos agree. Before saving, take every quoted line and time from the captions file, not a summary; give a posting date only with its source; check every ranking word (highest, lowest, only, best) against the index, scoped to the videos it covers.
