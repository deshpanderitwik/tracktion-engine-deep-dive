# Tracktion Engine — architecture deep-dive

A teaching microsite that explains how the [Tracktion Engine](https://github.com/Tracktion/tracktion_engine) — a C++ DAW built on JUCE — is put together. Twelve interactive diagrams, ~300–600 words of commentary each, every node and flag traceable back to a real file in the source.

The goal is that someone who knows how to code but has never read a DAW codebase can come away able to sketch the major subsystems of one.

Built against Tracktion Engine **3.2.0**, commit [`2877b621`](https://github.com/Tracktion/tracktion_engine/commit/2877b621f2fbee564d0696a616b86bf8ba8c8ab0).

---

## What's in here

```
site/
├── index.html              twelve-diagram table of contents
├── lessons.html            ten lessons distilled from the diagrams
├── glossary.html           every term that shows up on a diagram (~230)
├── about.html              methodology and how to read the visual grammar
├── diagrams/
│   ├── 01-daw-concepts.html        DAW concepts before code
│   ├── 02-module-graph.html        Where JUCE ends and Tracktion begins
│   ├── 03-the-edit.html            The Edit — document object model
│   ├── 04-rendering-graph.html     Audio rendering graph (DAG of Nodes)
│   ├── 05-transport.html           Transport, playback, sync
│   ├── 06-plugins.html             Internal/hosted plugins and Racks
│   ├── 07-midi.html                MIDI pipeline
│   ├── 08-audio-files.html         File cache, proxies, time-stretch
│   ├── 09-threading.html           Audio/message/worker threads
│   ├── 10-recording-comping.html   Recording, retrospective buffer, comping
│   ├── 11-automation.html          Curves, modifiers, macros
│   └── 12-rendering.html           Offline render vs realtime playback
└── assets/
    ├── style.css                   shared styles
    ├── diagram.js                  diagram renderer (swimlanes, edges, flags, flows)
    └── cart.js                     concepts shopping cart (see below)

INVENTORY.md                ground-truth source-tree inventory used to build the diagrams
```

The site is plain static HTML, CSS, and vanilla JS — no build step.

---

## The visual grammar

Every diagram uses the same conventions:

- **Horizontal swimlanes** group related nodes.
- **Boxes** are source files or conceptual entities. Hover for a one-liner, click to highlight dependencies (amber) and dependents (teal).
- **Edges** come in three kinds:
  - **solid** — a static relationship visible in the source (`#include`, ownership)
  - **dashed** — a runtime message across a boundary (callback, event, queue)
  - **dotted** — data flowing across a boundary (audio samples, MIDI, file bytes)
- **Numbered red circles** are *flags* — tradeoffs, gotchas, or things I couldn't verify from the source.
- **Flow overlays** are toggleable animations that trace one user journey across the graph (e.g. press-play, record-MIDI, render-stems). They're the teaching device that turns a static map into a story.

See [`/site/about.html`](site/about.html) for the full methodology.

---

## The concepts cart

A small in-page tool, in [`site/assets/cart.js`](site/assets/cart.js):

1. Highlight any phrase in a diagram's commentary or in the glossary.
2. A floating `+ save concept` button appears. Click it — the phrase is saved to a localStorage cart and stays highlighted on the page.
3. Open the cart from the top nav, type any specific questions you want to understand, then click **ask Claude →**.
4. The button launches Claude (Desktop via `claude://`, or web via `claude.ai/new?q=`) with a structured prompt: the concept, your questions, the surrounding paragraph, and a "draw me diagrams" preamble.

A reading tool first, an LLM-handoff second. Use it to keep a list of things you want to dig into without breaking your reading flow.

---

## Running locally

It's static HTML, so any web server works:

```bash
cd site
python3 -m http.server 8000
# → http://localhost:8000
```

---

## Why this exists

Most DAW codebases are taught by their own docs, which are organized by *what the code does* rather than *why it's shaped that way*. This site is the inversion of that: every diagram answers a *why* question and uses the source files as evidence.

Two of the lessons that drove the framing:

- **The live audio graph IS the offline render graph.** `createNodeForEdit(Edit&)` returns the same DAG that the realtime player and the offline renderer both consume. "Render doesn't match playback" is closed by construction, not by tests.
- **The audio thread is a contract, not a function.** It cannot wait, allocate, or lock. Every other piece of machinery — lock-free queues, seqlocks, the worker pool — exists to keep that contract while the rest of the system mutates state.

Full list at [`site/lessons.html`](site/lessons.html).

---

## Acknowledgements

- The [Tracktion Engine](https://github.com/Tracktion/tracktion_engine) team — for an unusually readable C++ codebase.
- [JUCE](https://juce.com/) — for `juce::ValueTree`, which is doing more architectural work than people give it credit for.

The diagrams, commentary, and code in this repo are mine. Tracktion Engine itself is governed by its own [license](https://github.com/Tracktion/tracktion_engine#license).
