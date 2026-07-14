# Nexus outreach — 10 drafts staged for approval

Written 2026-07-09, revised same day after Kushal's copy feedback (say 'ChatGPT app store', never assume apps-in-ChatGPT is known; no ambiguous 'talking to it'; no comma-triplets). All 10 are STAGED in the autark Outbox: `autark draft list nexus --status pending` or autark.sh → Outbox tab. Kushal approves there; a send agent executes.

## Send-agent procedure (per approved draft)

The outbox body is plaintext (links in parens) as a fallback. The intended send is the HTML file in this directory: links embedded in anchor text, signature `- kushal` hyperlinked to nexus.kushalsm.com.

```sh
autark mail send --lead-id <lead_id> --to <email> --subject "<subject>" --html @<name>.html --text @<name>.txt
autark draft mark-sent <draft_id> --thread-ref <thread_id from the send output>
```

Do NOT use plain `autark draft send` — it ships the plaintext body only.

| # | person | file | to | subject | lead_id | draft_id |
|---|--------|------|----|---------|---------|----------|
| 1 | Joshua Vander Hook | josh | hello@jodavaho.io | your json calorie scaffold | 2a212193-efbd-55c5-bfb5-5a8dc2afb3ac | d0fd4e45-c65a-4d7f-9877-3b13e6f8821d |
| 2 | Anton Kutishevsky | anton | akutishevsky@gmail.com | your mfp mcp server | 34489efa-6762-5c46-baed-6d1af7d9c4d | 5b5c8d51-b13e-4e78-b5de-5e82bb02a7ea |
| 3 | Leon Eversberg | leon | leon.eversberg@yahoo.com | you weighed the food | e70f495b-b399-51e1-bc59-dc08bf710430 | 75416e01-5301-46cb-b009-844fda19719f |
| 4 | Joonas Pihlajamaa | joonas | joonas.pihlajamaa@gmail.com | mealgram | 4646c8c3-10d0-5fbc-8bdc-99a693381233 | e3d59f7e-7d0f-4db9-8054-506140a433ab |
| 5 | Frank Rosner | frank | frank@fam-rosner.de | everything around the model | 4c1b6266-f981-597e-85d8-4ca7c771b700 | 679e718b-0189-41c3-890d-908a91669a51 |
| 6 | Apoorv Darshan | apoorv | ad13dtu@gmail.com | food logging is still too slow | 9628b765-1708-58ce-891d-e602e69b176a | e30ece33-caf3-4931-93a6-3973254768af |
| 7 | Rick Montero | rick | rick@rickmontero.com | apple health into claude | 183d297e-516c-5a78-978e-b881d9a94a23 | 18e44a71-d265-4eca-9301-45446e3f87f9 |
| 8 | Emilien Mottet | emilien | emilien.mottet@grenoble-inp.org | claude n8n hexis | 5ed7ad5b-edcd-54ea-9911-55f43fc96389 | 12dff2c9-e36b-4f2d-a973-0735e0cd76e2 |
| 9 | Alex Honchar | alex | alexandr.honchar@gmail.com | claude code for life | da0f2e0f-626a-5f76-a952-cd27f10e0b73 | bddb50bd-b15d-4ef1-a8d0-2c8fd14c8c4b |
| 10 | Nagarjun Srinivasan | nagarjun | naga22694@gmail.com | food-tracker-mcp | 10908944-d453-5eb3-956a-b1f1bf85d571 | 3c3af053-9216-40c8-af24-7510c5bb5abb |

## Final bodies (plaintext view; HTML versions carry the same text with links embedded)

### 1. Joshua Vander Hook — subject: `your json calorie scaffold`

> Hi Josh,
> 
> You engineered a JSON scaffold (https://jodavaho.io/posts/dieting-differential-equations-3.html) so ChatGPT would keep a running calorie total, then plotted the exports by hand.
> 
> That scaffold was you doing the one thing the model couldn't: remember.
> 
> ChatGPT has an app store now, so I built Nexus inside it. Same chat you already use, but the log persists and the charts are just there.
> 
> Curious if it holds up against your scaffold.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 2. Anton Kutishevsky — subject: `your mfp mcp server`

> Hi Anton,
> 
> Read How I Replaced MyFitnessPal With a Single MCP Server (https://akutishevsky.medium.com/how-i-replaced-myfitnesspal-and-other-apps-with-a-single-mcp-server-56ca5ec7d673). Your daily loop of photographing food and telling Claude to log it is the same conclusion I reached.
> 
> There's an app store inside ChatGPT now, so I built the native version: Nexus. The log survives across chats and the trends chart themselves.
> 
> Would like to know how it compares to your server.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 3. Leon Eversberg — subject: `you weighed the food`

> Hi Leon,
> 
> You put your food on a scale to test ChatGPT's calorie estimates (https://pub.towardsai.net/i-used-chatgpt-to-count-my-calories-fabd14f0538b). The estimates held up.
> 
> ChatGPT opened an app store since, so I built Nexus on that result: the estimate finally has somewhere to go.
> 
> Try it on a meal you know the numbers for.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 4. Joonas Pihlajamaa — subject: `mealgram`

> Hi Joonas,
> 
> You vibe-coded mealgram (https://codeandlife.com/2025/10/15/vibe-coding-food-diary-bot-in-one-hour/) in an hour and moved your old Google Sheet logs into it.
> 
> I chased the same itch through the new ChatGPT app store: Nexus runs in the chat itself, so the log lives next to the model that estimated it. Nothing to host.
> 
> Where does it fall short of mealgram? Genuinely want the list.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 5. Frank Rosner — subject: `everything around the model`

> Hi Frank,
> 
> In your food tracker post (https://dev.to/frosnerd/build-your-own-food-tracker-with-openai-platform-55n8) the model part was easy. What you had to build by hand was everything around the model.
> 
> ChatGPT shipped an app store, so I built that part as an app: Nexus. You drop the photo in the chat and the history builds itself.
> 
> Curious whether it survives your validation method.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 6. Apoorv Darshan — subject: `food logging is still too slow`

> Hi Apoorv,
> 
> You built Fud AI (https://dev.to/apoorvdarshan/i-built-a-byok-ai-calorie-tracker-because-food-logging-is-still-too-slow-1hmf) because food logging is still too slow. Nine ways to log, and it still has to be its own app.
> 
> I built Nexus so logging is just telling ChatGPT what you ate. It's in the ChatGPT app store and it remembers everything, so there is no separate app to open.
> 
> Would value where you think it still has friction.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 7. Rick Montero — subject: `apple health into claude`

> Hi Rick,
> 
> You pipe years of Apple Health data into Claude (https://rickmontero.com/field-notes/ai-fitness-tracker-claude-apple-health-notion) for reviews. Reading works. The writing still lives in Notion.
> 
> I built Nexus, an app in ChatGPT's new app store: tell ChatGPT what you ate and it keeps the record and the trends. Log and review in one place.
> 
> Run it for a week next to your setup and tell me which one you open.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 8. Emilien Mottet — subject: `claude n8n hexis`

> Hi Emilien,
> 
> Your Claude, n8n and Hexis pipeline (https://www.emottet.com/posts/blog_post_crew_meal/) is the most engineered nutrition loop I've seen. You clearly needed this to be durable.
> 
> I built Nexus for the ChatGPT app store: a tracker living in the chat itself, with a log that persists and no pipeline to babysit.
> 
> What would it need before you'd retire a node of yours?
> 
> best,
> - kushal
> nexus.kushalsm.com

### 9. Alex Honchar — subject: `claude code for life`

> Hi Alex,
> 
> In Claude Code for Life #1 (https://medium.com/data-science-collective/claude-code-for-life-1-managing-my-health-and-wellness-cae435c77030) your food lives in Yazio and Claude re-ingests it every session.
> 
> I built Nexus so the log lives where the model is: an app from the new ChatGPT app store. Tell ChatGPT the meal or send a photo, history kept.
> 
> It might collapse a step in your loop. Would like your take.
> 
> best,
> - kushal
> nexus.kushalsm.com

### 10. Nagarjun Srinivasan — subject: `food-tracker-mcp`

> Hi Nagarjun,
> 
> You built food-tracker-mcp (https://github.com/nagarjun226/food-tracker-mcp) to give Claude a food log it could write to.
> 
> ChatGPT quietly launched an app store, so I made the same bet there: Nexus. You tell ChatGPT what you ate, and the app keeps the history and goals.
> 
> How does it stack up against your MCP?
> 
> best,
> - kushal
> nexus.kushalsm.com

