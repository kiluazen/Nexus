# Nexus outreach rework
## Where things stand
61 leads across 3 hypotheses. 30 got emailed on Jul 7. 0 replies so far (day 2, too early to read much into it). 10 sit at email:ready, unsent. The rest have no address yet.

- H01 "ChatGPT calorie-counters who lose their history" — 27 leads
  
- H02 "MyFitnessPal refugees who quit over logging friction" — 11 leads
  
- H03 "Early GPT-tracking tinkerers" — 23 leads
  
## What's wrong with the sent drafts
One sentence got pasted into ~30 emails:

> "The ChatGPT apps ecosystem opened up recently, so I built Nexus: the same idea, but a real tracker living natively inside ChatGPT, with no backend to host and no app to get discovered."

Only the first line changed per person. That's a mail merge wearing a personalization costume. Anyone who compares notes, or just smells it, marks it spam.

Specific failures:

1. **No links.** Every draft says "You built MagicMeal" / "In your series" with no link to the thing. To a technical recipient this is the #1 spam tell. It reads as "a script scraped my name," not "a human read my stuff."
  
2. **Bare product URL in the body.** `nexus.kushalsm.com` sitting on its own line mid-email is campaign formatting. Product link belongs under the name in the signature, as a hyperlink.
  
3. **Same closer everywhere.** "Given you built your own, I'd genuinely value your take" went to at least 6 people verbatim.
  
4. **One was sent broken.** Dani's draft opens "In your series on building an AI health coach." Full stop. Sentence never finishes.
  
5. **No story.** Every email describes the product. None of them put the recipient inside a story they already know they're living.
  
## The story spine
The thing you said is the whole pitch, so say exactly that:

**ChatGPT is already the best calorie tracker. It just couldn't remember. Now it can.**

Photo to calories is a model capability, not an app. Every calorie app of the last two years (Cal AI included) is a thin wrapper around the same vision models, sold as a subscription. Apps now run natively inside ChatGPT. So the tracker should live where the model lives. Nexus is that. Free.

Every cohort gets a different entry point into that one story. Nobody gets the story recited at them.

One filter above everything: **tracking needs intent that already exists.** We never try to make anyone care about calories. We only talk to people who already track, already tried to track, or already built something to track. If a person needs convincing that tracking matters, they're not a lead.
## Cohorts → hypotheses
### Keep: H01 — already tracking with AI, memory is the pain (warmest)
People currently running their tracking through ChatGPT/Claude by hand: notes folders, one-chat-per-day, custom GPTs, re-pasted context. They already believe. The product is literally the thing they're simulating.

Story entry: "you're doing the job of a database for your AI. It can hold the data itself now."
### Keep: H02 — tried tracking, quit over friction (your cohort 2)
MFP/Lose It quitters. They didn't stop wanting the outcome, they stopped tolerating the logging. Search-a-database, weigh, type, repeat.

Story entry: "you didn't fail at tracking. The logging failed you. It's one photo or one sentence now, in an app you already open every day."

H02 is currently narrow (only MFP quitters, 11 leads). Worth widening to "quit any tracker over logging friction" — same bet, more surface.
### Pause: H03 — builders of their own trackers
23 of 61 leads are people who built their own tracker. Two problems:

1. They're not users, they're competitors with identity invested in their own thing. The run narrative itself predicted the failure mode: "I already built mine and I'm happy with it."
  
2. The sheet is now builder-skewed while both cohorts you actually named (power users, quitters) are thin or empty.
  

Not dead — a few are genuinely good design-partner conversations (Yoshi/MacroQ, Max/Prepasto). But stop sourcing builders, and stop counting them as user-acquisition. Mark H03 inactive.
### New: H04 — paying tracking power users (your cohort 1)
**Story.** People paying for Cal AI / MacroFactor / MFP Premium are the highest-intent trackers alive: they log daily and pay for the privilege. Cal AI charges ~$40/yr for photo-to-calories, which is a wrapper around the same class of vision model that ChatGPT ships natively. Nexus gives them the same loop inside ChatGPT, free, with the best model, plus a coach that actually reasons over their history. Pitch is not "switch apps," it's "the thing you're paying for became a free capability of an app you already use."

**Who.** People publicly posting about their Cal AI / MacroFactor / premium-tracker usage: complaints about subscription price, accuracy gripes, "is Cal AI worth it" threads, r/CICO, r/loseit, r/MacroFactor, X posts tagging these apps. Identifiable because they name the app and their usage in public. Mostly consumers, so channel is reply-in-thread (Reddit/X) more than cold email; email only when they have a site/newsletter with a published address.
### Candidate: H05 — GLP-1 protein trackers
GLP-1 users are told to hit protein targets while appetite is gone; protein tracking is the one log they can't skip. Huge, active, public cohort (r/Zepbound, r/Ozempic, podcasts). Suzy Chase (already contacted) is this exact profile. High intent, zero tool loyalty, photo-logging fits low-effort eating. Say the word and I'll write it up properly and source a first cohort.
## Rules before any send (no exceptions)
1. Every referenced artifact gets its real URL embedded in the anchor text. No link found = rewrite without the claim, or skip the send.
  
2. Product link only in the signature: `- kushal` hyperlinked, HTML send.
  
3. No sentence appears in more than one email. If a line is good enough to reuse, it's a template.
  
4. `autark mail lint` on every body before send.
  
5. If the signal is a public post, consider replying in the thread instead of cold-emailing about it.

6. TERMINOLOGY (updated 2026-07-10): OpenAI rebranded ChatGPT apps to PLUGINS on Jul 9 2026 — the app directory is now the plugin directory. Say "plugin" / "ChatGPT plugins". Never "app store", never "native app". Most people still don't know plugins exist; that IS the intriguing news. And never ambiguous "talking to it" (you talk to ChatGPT; the plugin keeps the record).

6b. The product link https://nexus.kushalsm.com/ goes on its own line BEFORE the "best," sign-off in every draft (Kushal, 2026-07-10).

7. No comma-triplets, ever: "One chat, persistent log, no pipeline to babysit" is an AI tell. Plain sentences.
  
## Rewritten drafts — the 10 at email:ready
URLs marked ⟨link⟩ must be resolved to the real article/repo URL at send time and embedded in the anchor text. Subjects lowercase, specific, no title case.
### 1. Joshua Vander Hook — subject: `your json calorie scaffold`
Hi Josh,

You engineered a ⟨JSON scaffold⟩ so ChatGPT would keep a running calorie total, then plotted the exports by hand.

That scaffold was you doing the one thing the model couldn't: remember.

Apps run inside ChatGPT now, so I built Nexus. Same chat, but the log persists and the charts are just there.

Curious if it holds up against your scaffold.

best,

- kushal
  
### 2. Anton Kutishevsky — subject: `your mfp mcp server`
Hi Anton,

Read ⟨I Replaced MyFitnessPal With a Single MCP Server⟩. Photo, "log this", no app to switch to. Same conclusion I reached.

I built the ChatGPT-native version: Nexus. An app inside ChatGPT, so the log survives across chats and the trends chart themselves.

Would like to know how it compares to your server.

best,

- kushal
  
### 3. Leon Eversberg — subject: `you weighed the food`
Hi Leon,

You actually ⟨weighed your food⟩ to test ChatGPT's calorie estimates. The estimates held up.

I built Nexus on that result: a tracker inside ChatGPT itself. The estimate finally has somewhere to go.

Try it on a meal you know the numbers for.

best,

- kushal
  
### 4. Joonas Pihlajamaa — subject: `mealgram`
Hi Joonas,

You vibe-coded ⟨mealgram⟩ and hand-migrated your Google Sheet logs into it.

I chased the same itch from the other side: Nexus, a tracker that runs inside ChatGPT. The vision model, the log and the charts are one thing. Nothing to host.

Where does it fall short of mealgram? Genuinely want the list.

best,

- kushal
  
### 5. Frank Rosner — subject: `everything around the model`
Hi Frank,

In ⟨your food tracker post⟩ the model part was easy. What you had to build by hand was everything around it: storage, history, the loop.

ChatGPT runs apps natively now, so I built that part. Nexus: photo in the chat, macros logged, history kept.

Curious whether it survives your validation method.

best,

- kushal
  
### 6. Apoorv Darshan — subject: `extra olive oil`
Hi Apoorv,

"extra olive oil, scan a label, type a portion" is the truest line written about food logging. It's why you built ⟨Fud AI⟩.

I built Nexus so logging is just telling ChatGPT what you ate. It's an app inside it, so it remembers and charts without another app to open.

Would value where you think it still has friction.

best,

- kushal
  
### 7. Rick Montero — subject: `apple health into claude`
Hi Rick,

You pipe years of ⟨Apple Health data into Claude⟩ for reviews. Reading works. The writing still lives in Notion.

I built Nexus: log and review in one place, inside ChatGPT. Say what you ate, it keeps the record and the trends.

Run it for a week next to your setup and tell me which one you open.

best,

- kushal
  
### 8. Emilien Mottet — subject: `claude n8n hexis`
Hi Emilien,

⟨Your Claude, n8n and Hexis pipeline⟩ is the most engineered nutrition loop I've seen. You clearly needed this to be durable.

I built Nexus, a tracker native inside ChatGPT. One chat, persistent log, no pipeline to babysit.

What would it need before you'd retire a node of yours?

best,

- kushal
  
### 9. Alex Honchar — subject: `claude code for life`
Hi Alex,

In ⟨Claude Code for Life #1⟩ your food lives in Yazio and Claude re-ingests it every session.

I built Nexus so the log lives where the model is: an app inside ChatGPT, meals logged from a sentence or a photo, history kept.

It might collapse a step in your loop. Would like your take.

best,

- kushal
  
### 10. Nagarjun Srinivasan — subject: `food-tracker-mcp`
Hi Nagarjun,

You built ⟨food-tracker-mcp⟩ to give Claude a food log it could actually write to.

I built the same bet for ChatGPT as a native app: Nexus. Log by sentence or photo, history and goals held for you.

How does it stack up against your MCP?

best,

- kushal
  
## The 30 already contacted
Leave them alone for now. One follow-up in ~7 days, only for leads where a real hook exists, written fresh in the new voice, with the link that should have been there the first time. No blanket bump.
## Execution order once you sign off
1. Mark H03 inactive.
  
2. Create H04 (and H05 if you want it) as frozen hypotheses.
  
3. Resolve URLs for the 10 drafts, lint, send.
  
4. Point the daily sourcing task at H04/H02 profiles instead of builders.
