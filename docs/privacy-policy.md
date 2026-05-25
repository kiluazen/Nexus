# Nexus — Privacy Policy

Last updated: 2026-05-25

Nexus is a fitness journal: you tell it what you ate, what you lifted, what you
weigh; it stores those entries against your account so you (and, optionally,
your AI agents and your friends) can read them back.

This page lists exactly what gets stored, why, who can see it, and how to ask
us to delete it.

## What we collect

When you authenticate, we receive your Supabase-issued user identity:
- A stable user ID (UUID).
- The email you signed in with.
- The display name on your Supabase profile.

When you use the product, we store the entries you log:
- Workouts: exercise name, sets/reps/weight, duration, distance, any notes.
- Meals: meal type, items, your macro estimates per item, any notes.
- Body weight: a number in kilograms, any notes.

When other Nexus users connect to you as friends, we store the friendship
record (which users, when, status: pending/active).

We do not collect device fingerprints, IP-based location, or marketing data.
We do not run analytics.

## Where it's stored

All persistent data lives in a Supabase Postgres instance under our control,
hosted in AWS us-east-1. Connection state and short-lived OAuth tokens live
in Cloudflare Workers KV (encrypted at rest, edge-replicated).

We do not sell your data, surface it to advertisers, or feed it to model
training. Our infrastructure providers (Supabase, Cloudflare, Anthropic,
OpenAI) handle data only as required to operate the service.

## Who sees your data

- You see everything you logged.
- Anthropic, OpenAI, or any other MCP client you connect to Nexus sees
  whichever of the four tools you grant — typically all four — and reads
  your entries during those tool calls.
- Friends you've explicitly accepted on Nexus see your entries when they
  call `get_fitness_history(friend_id=<you>)`.
- We (the operators of Nexus) can read your data when debugging or
  responding to your support requests. We do not browse it otherwise.

If you log workouts or meals with PII baked into the `notes` field, that PII
is stored verbatim. Don't put anything in `notes` you wouldn't want a friend
or your AI agent to see.

## Authentication

We use Supabase Auth as the identity provider — Google OAuth or email +
password. We never see your Google credentials. We never see your password
in cleartext; Supabase salts and hashes it.

When an MCP client (Claude, ChatGPT, Codex, the Nexus CLI) connects, our
OAuth 2.1 server issues a scoped access token bound to your user. That
token is what the client presents on every call. Tokens expire in 1 hour
and can be refreshed for up to 30 days. Revoke any active grant at any time
via your client's "disconnect" UI.

## Data deletion

Email **kushalsokke@gmail.com** with subject `Nexus delete <your email>`.
We delete all rows tied to your user ID — entries, friendships, OAuth grants
— and confirm in writing. No fees, no forms.

## Children

Nexus is not intended for users under 13. We do not knowingly collect data
from anyone under 13. If you believe a child has signed up, email the
address above and we will delete the account.

## Changes

When we change this policy, we change the date at the top and post the new
version at the same URL. Material changes (new data categories, new
sharing) we will also email registered users about.

## Contact

Kushal SM — kushalsokke@gmail.com — Bangalore, India.
