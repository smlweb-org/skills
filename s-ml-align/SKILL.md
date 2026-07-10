---
name: s-ml-align
description: Build or align web pages to the S—ML Web standard (Responsive Delivery Profiles - Sparse, Medium, Luxe). Use this skill whenever the user mentions S—ML, SML, delivery profiles, the Sparse profile, or asks to make a page lightweight, satellite-friendly, low-bandwidth, AI-readable, crawler-friendly, or resilient on slow connections — and also when building any new website, landing page, or web app where the user cares about performance, accessibility, offline resilience, or AI/agent consumption, even if they never say "S—ML". Includes a bundled conformance auditor.
---

# S—ML Align

Make web pages conform to the S—ML Web standard: one URL serving the same canonical content in three delivery weights — **S (Sparse)**, **M (Medium)**, **L (Luxe)** — negotiated by network, device, and consumer type (including AI agents).

The core mental model: **author the semantic core once, then enhance**. S is not a stripped-down copy of the page; it is the page's foundation. M and L are layers on top of it. If you build S first, M and L come almost for free. If you build L first, retrofitting S is painful — which is exactly the failure mode of most of today's web.

The normative spec is in `references/spec.md`. Read it when you need exact MUST/SHOULD language, header semantics, or edge cases (content equivalence, hydration rules, caching). For routine work, this file is enough.

## The contract in one table

| Requirement | s (normative) | m (recommended) | l |
|---|---|---|---|
| Initial payload (HTML + render-blocking subresources) | ≤ 50 KB | ≤ 1 MB | open |
| Core content without JavaScript | MUST | SHOULD | MAY |
| Third-party scripts | MUST NOT | keep few | open |
| Custom fonts | SHOULD NOT | MAY | MAY |
| Round trips before core content | ≤ 2 | ≤ 5 | open |
| Machine-readable summary (meta description / JSON-LD) | MUST | SHOULD | SHOULD |
| End-to-end TLS | MUST | MUST | MUST |

Only `s` budgets are normative — the standard's center of gravity. `m` values are recommendations; `l` is unconstrained. Content equivalence and TLS bind every profile.

The S representation MUST contain, in the initial server response: the canonical title, a summary, the primary content or current state, and **every critical action** (the operations a user must be able to perform — check in, pay, mark safe, submit). A page whose S profile can't perform a critical action available in L is non-conforming. This is the rule that matters most: it's what keeps S from becoming a second-class page.

## Workflow A: building a new page

1. **Identify the semantic core first.** Before writing any markup, name the resource's title, summary, primary content/state, and critical actions. This list *is* the S profile.
2. **Write the S representation as plain semantic HTML** — `<main>`, `<article>`, `<h1>`, real `<form>` elements for actions. Server-rendered or static. Inline a small amount of CSS (system fonts, one column, dark-mode via `prefers-color-scheme`). No script tags required for anything in the core.
3. **Add the machine-readable layer**: `<meta name="description">`, `<link rel="canonical">`, and JSON-LD appropriate to the page type. This is what AI agents and crawlers read — it's the point of the standard's name (S — ML: the Sparse profile is what machine learning reads).
4. **Layer M and L as enhancements.** Optimized images, fonts, and moderate interactivity for M; rich media and app-like behavior for L. Gate heavier assets so they load only in heavier profiles — via server-side branching on `Accept-Profile`/`?profile=`, or `data-profile` attributes your enhancement loader respects.
5. **Wire up discovery and negotiation** (see snippets below).
6. **Audit before declaring done** (see Verification).

If the page uses hydration (S as wire format, upgraded client-side toward M/L): core content must be complete and usable *before* hydration begins, hydration must be interruptible without losing content or entered form state, and a client that requested `s` must never be forced past it.

## Workflow B: aligning an existing page

Run the auditor first — don't guess:

```bash
node scripts/sml-audit.js <url> --no-color
```

Then fix violations in this order (each step unblocks the next):

1. **Server-render the core.** If the page is an empty app shell (`<div id="root">`), this is the structural fix everything else depends on. Move title, summary, content/state, and critical actions into the initial HTML. Frameworks: enable SSR/SSG for these routes rather than rewriting the app.
2. **Make critical actions work as plain forms.** Every button that matters should degrade to a `<form>` POST. JavaScript may enhance it; it must not be required.
3. **Evict third-party scripts from the critical path.** Analytics, chat widgets, trackers: gone from S, deferred and capped in M.
4. **Cut payload to budget.** Inline critical CSS, drop custom fonts from S, compress or gate images (`loading="lazy"`, `data-profile="m l"`).
5. **Add the metadata layer** (meta description or JSON-LD, canonical).
6. **Add discovery/negotiation headers**, then re-audit.

Don't try to make the whole site conform at once. Start with the critical paths — the pages a user needs when the network is worst (status, auth, payment, confirmation, alerts). "Your critical path should work in S mode" is the adoption argument; it's also the migration order.

## Discovery and negotiation snippets

HTML head (every profile):

```html
<link rel="canonical" href="https://example.com/page">
<link rel="alternate" type="text/html" data-profile="s" href="?profile=s">
<link rel="alternate" type="text/html" data-profile="m" href="?profile=m">
<link rel="alternate" type="text/html" data-profile="l" href="?profile=l">
```

Response headers (set at server or CDN/host config):

```
Content-Profile: s
Available-Profiles: s, m, l
Vary: Accept-Profile
```

Server logic, in order of precedence:

1. `Accept-Profile: <p>` request header → serve `<p>` if available, else nearest **lighter** profile. Never silently serve heavier than requested.
2. `?profile=<p>` query parameter → same rule (fallback for clients that can't set headers).
3. `Save-Data: on` → treat as `Accept-Profile: s`.
4. No signal → serve your default (usually `m`), still declaring `Content-Profile` and `Available-Profiles`.

Base decisions on these explicit signals only — not UA sniffing or IP-based network guessing. Negotiation must not become a fingerprinting surface.

## Verification

Always finish by running the bundled auditor against every profile you claim:

```bash
node scripts/sml-audit.js <url> --profile=s   # exit 0 = pass, CI-friendly
node scripts/sml-audit.js <url> --json        # machine-readable
```

It measures initial payload (HTML + render-blocking subresources, actually fetched), JavaScript dependence (empty-shell and visible-text heuristics), third-party script hosts, fonts, estimated round trips, metadata, TLS, and profile discovery. Treat FAIL lines as a to-do list. The tool is static analysis — for pages with subtle client-rendering, also verify manually that the core content is present in the raw HTML (`curl -s <url> | grep '<key phrase>'`).

If the page claims a profile it doesn't meet, fix the page — never relax the budgets. The budgets are the standard's entire credibility.

## Boundaries

This skill covers per-page/per-site conformance. It does not cover: registering headers with standards bodies, building browser support, or the S—ML position paper's history and rationale (see the spec's source site for that). If the user wants SEO/AI-discoverability work beyond S—ML conformance (llms.txt, robots.txt for AI crawlers, schema strategy), that's complementary — S—ML pages are already most of the way there.
