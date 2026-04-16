# AGENTS.md

## Project
This repository is for the **Studio OS Cloud Next.js website and web product frontend**, not the Flutter desktop app.

Studio OS Cloud is a **premium connected workflow platform for photographers**.

It serves photographers who want:
- beautiful online galleries
- client ordering
- digital delivery
- branded presentation
- stronger workflow organization behind the scenes

Studio OS Cloud is especially strong for:
- school photographers
- volume photographers
- sports photographers
- event photographers
- studios managing structured, multi-step workflows

Important:
Do **not** position Studio OS Cloud as only for school or event photographers.
It should feel like a **market-wide photography platform** with deeper workflow power.

Core message:
**Great galleries for all photographers. Deeper workflow power for photographers who need more.**

---

## Positioning Rules

### Brand-level positioning
Studio OS Cloud should be presented as:
- a premium photography platform
- a strong online gallery solution
- a workflow-first system
- a connected desktop + cloud experience

### Differentiation
Studio OS Cloud goes beyond gallery-only platforms by connecting galleries to real production workflow:
- projects
- capture workflow
- sorting
- desktop + cloud sync
- print workflow
- structured jobs
- private access
- order review
- fulfillment control

### Competitive framing
Do not claim Studio OS Cloud is better than competitors at everything.

Use honest framing:
- Pixieset is strong for mainstream trust, polished websites, and broad adoption
- Studio OS Cloud is stronger for workflow depth, production control, and connected capture-to-delivery workflow

Do not sound defensive or aggressive.
Do not bash competitors.

---

## Scope Rules

### Do edit
- public marketing pages
- product pages
- comparison pages
- metadata
- structured data / JSON-LD
- robots.ts
- sitemap.ts
- internal linking
- reusable marketing components

### Do NOT edit unless explicitly requested
- Flutter desktop app files
- Supabase schema
- migrations
- backend business logic
- auth logic
- sync logic
- payment logic
- private dashboard workflows

---

## File Placement Rules

### Page copy and page messaging
Use:
- `app/.../page.tsx`

### Reusable marketing components
Use:
- `components/marketing/...`

### SEO / schema helpers
Use:
- `components/seo/...`
- or existing SEO utilities already in the repo

### Site-wide discoverability files
Use:
- `app/robots.ts`
- `app/sitemap.ts`
- `app/layout.tsx`
- page-level `metadata`

---

## Messaging Rules

### Tone
Keep copy:
- premium
- clear
- direct
- confident
- modern
- useful
- specific

### Avoid
- hype
- keyword stuffing
- fake urgency
- fake reviews
- fake stats
- fake market claims
- generic SaaS wording

### Always communicate
- Studio OS Cloud is more than an online gallery
- galleries are a core product, not an afterthought
- Projects are a real job-organization layer
- desktop + cloud work together
- workflow depth matters
- photographers can use Studio OS Cloud for galleries alone, even if they do not use every advanced workflow feature

### Copy balance
Do not overuse words like:
- school
- volume
- roster
- tethering

Use those terms heavily on workflow-specific pages,
but keep homepage, galleries pages, and projects pages broad enough for:
- portrait photographers
- wedding photographers
- family photographers
- commercial photographers
- studio photographers
- event photographers

---

## Product Framing Rules

### Projects
Projects should feel like:
- a real operating layer for photographer jobs
- more useful than a simple gallery list
- helpful for organizing albums, galleries, job structure, and delivery
- part of a connected workflow system

### Online Galleries
Online galleries should feel like:
- premium
- branded
- client-friendly
- sales-ready
- private when needed
- connected to a larger workflow system

Do not make galleries feel secondary.
Galleries are a core Studio OS Cloud product.

Where relevant, connect galleries to:
- client access
- parent access
- private delivery
- PIN/access control
- print ordering
- digital delivery
- workflow visibility
- desktop/cloud sync

---

## Comparison Page Rules

When writing comparison pages:
- stay respectful
- explain best fit by photographer type
- be honest about tradeoffs
- do not invent claims
- do not claim Studio OS Cloud wins every category

Useful section patterns:
- `Choose Studio OS Cloud if...`
- `Choose [Competitor] if...`
- `Best fit by photographer type`
- `Where Studio OS Cloud goes deeper`
- `What you may still need separately`

---

## SEO / Discoverability Rules

Priority:
- helpful content first
- clear page intent
- strong internal linking
- accurate metadata
- valid structured data
- clean crawlability

Support these topics naturally when relevant:
- photographer workflow software
- online photo gallery ordering software
- workflow software for photographers
- Pixieset alternative
- school photography workflow software
- volume photography software
- desktop and cloud photography workflow

Do not keyword stuff.
Do not create thin pages just for search engines.

---

## Structured Data Rules

Use valid schema only where appropriate:
- `Organization`
- `SoftwareApplication`
- `Product`
- `Offer`
- `FAQPage`
- `BreadcrumbList`

Never add:
- fake ratings
- fake review counts
- fake testimonials
- fake pricing claims
- schema that does not match the visible page content

---

## Metadata Rules

For important public pages:
- improve title tags
- improve meta descriptions
- improve Open Graph metadata
- keep titles specific and useful
- align metadata with real page intent

---

## UI / Design Rules

Do not redesign the whole site unless explicitly requested.

Prefer:
- wording improvements
- section clarity
- better ordering of information
- stronger CTA flow
- better internal linking
- small reusable sections

Keep the site:
- premium
- clean
- simple
- professional

Do not clutter hero sections.

---

## Truthfulness Rule

Do not invent facts.

Only make claims that are:
- already visible in the site/repo
- clearly supported by the product
- explicitly given in task instructions

If uncertain, prefer wording like:
- designed for
- built for
- helps photographers
- supports

---

## Deliverables

When completing tasks:
1. list files changed
2. summarize what changed
3. explain why it helps
4. keep patches focused
5. preserve strong existing copy when appropriate

---

## Final Reminder

Studio OS Cloud should feel like:
- a serious workflow system
- a premium connected platform
- a strong gallery solution
- a better choice for photographers who need more than gallery presentation alone

Do not make it sound generic.
Do not make it sound like just another gallery website.
