// Shared diagram renderer.
// Input shape (passed via JSON):
// {
//   width, height,
//   lanes: [{ id, label, height }],          // stacked top-to-bottom
//   nodes: [{ id, lane, col, row?, label, purpose, file, width?, height? }],
//   edges: [{ id?, from, to, kind: "solid"|"dashed"|"dotted", flow?: string, bend?: number }],
//   flags: [{ num, nodes: [id,...], title, description }],
//   flows: [{ id, label, description, edges: [edgeId,...] }]
// }
//
// Positions: a node's y is centered in its lane. Its x is derived from
// `col` (an integer column index) if x isn't given explicitly.
//
// Conventions: swimlane tint cycles through CSS variables --lane-1..--lane-6.
// Edges route as smooth curves between node edges with optional `bend`.

(function () {
  const NS = "http://www.w3.org/2000/svg";

  const LANE_PAD_TOP = 26;     // room for lane label strip
  const LANE_PAD_X = 18;
  const NODE_W_DEFAULT = 180;
  const NODE_H_DEFAULT = 38;
  const NODE_V_MARGIN = 8;
  const COL_GAP = 28;
  const LEFT_PAD = 80;         // room for lane label strip on the left
  const RIGHT_PAD = 20;

  function el(tag, attrs, ...kids) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.appendChild(k);
    return n;
  }

  function computeLayout(spec) {
    // 1. Lane y positions.
    const lanes = [];
    let y = 0;
    for (let i = 0; i < spec.lanes.length; i++) {
      const l = spec.lanes[i];
      const h = l.height || 130;
      lanes.push({ ...l, y, h, index: i });
      y += h;
    }
    const totalH = y;

    // 2. Group nodes by lane; within lane, sort by col, then assign x.
    const byLane = new Map();
    for (const n of spec.nodes) {
      if (!byLane.has(n.lane)) byLane.set(n.lane, []);
      byLane.get(n.lane).push(n);
    }

    // Determine max col across whole diagram so columns align horizontally.
    let maxCol = 0;
    for (const n of spec.nodes) maxCol = Math.max(maxCol, (n.col ?? 0));

    const colW = NODE_W_DEFAULT + COL_GAP;
    const contentW = (maxCol + 1) * colW - COL_GAP;
    const totalW = LEFT_PAD + contentW + RIGHT_PAD;

    const placed = new Map();
    for (const lane of lanes) {
      const nodes = byLane.get(lane.id) || [];
      // Group nodes by col, then stack vertically within lane.
      const byCol = new Map();
      for (const n of nodes) {
        const c = n.col ?? 0;
        if (!byCol.has(c)) byCol.set(c, []);
        byCol.get(c).push(n);
      }
      for (const [c, list] of byCol) {
        // Sort by explicit row if present.
        list.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
        const count = list.length;
        const nh = NODE_H_DEFAULT;
        const stackH = count * nh + (count - 1) * NODE_V_MARGIN;
        const startY = lane.y + LANE_PAD_TOP + (lane.h - LANE_PAD_TOP - stackH) / 2;
        list.forEach((n, i) => {
          const w = n.width || NODE_W_DEFAULT;
          const h = n.height || nh;
          const x = LEFT_PAD + c * colW + (NODE_W_DEFAULT - w) / 2;
          const yy = startY + i * (nh + NODE_V_MARGIN);
          placed.set(n.id, { ...n, x, y: yy, w, h, cx: x + w / 2, cy: yy + h / 2, lane });
        });
      }
    }

    return { lanes, placed, totalW, totalH };
  }

  function edgePath(a, b, bend) {
    // Route from the edge of `a` toward the edge of `b`.
    // If same lane (horizontal row), use a gentle S-curve.
    // If different lane (vertical step), bend more.
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    // Pick exit + entry sides based on dominant direction.
    let ax, ay, bx, by;
    if (Math.abs(dx) > Math.abs(dy) * 0.6) {
      // primarily horizontal
      ax = a.cx + Math.sign(dx) * a.w / 2;
      ay = a.cy;
      bx = b.cx - Math.sign(dx) * b.w / 2;
      by = b.cy;
    } else {
      // primarily vertical
      ax = a.cx;
      ay = a.cy + Math.sign(dy) * a.h / 2;
      bx = b.cx;
      by = b.cy - Math.sign(dy) * b.h / 2;
    }
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const b1 = bend || 0;
    // For horizontal-ish: cp pulls toward midline
    if (Math.abs(ax - bx) >= Math.abs(ay - by)) {
      const c1x = ax + (bx - ax) * 0.5;
      const c1y = ay;
      const c2x = bx - (bx - ax) * 0.5;
      const c2y = by;
      return `M ${ax} ${ay} C ${c1x} ${c1y + b1}, ${c2x} ${c2y - b1}, ${bx} ${by}`;
    } else {
      const c1x = ax;
      const c1y = ay + (by - ay) * 0.5;
      const c2x = bx;
      const c2y = by - (by - ay) * 0.5;
      return `M ${ax} ${ay} C ${c1x + b1} ${c1y}, ${c2x - b1} ${c2y}, ${bx} ${by}`;
    }
  }

  function render(container, spec) {
    const { lanes, placed, totalW, totalH } = computeLayout(spec);

    const svg = el("svg", {
      viewBox: `0 0 ${totalW} ${totalH}`,
      xmlns: NS,
      class: "diagram-svg",
      preserveAspectRatio: "xMidYMin meet",
    });

    // -- lane backgrounds + labels --
    const laneLayer = el("g", { class: "lanes" });
    lanes.forEach((lane, i) => {
      const fill = `var(--lane-${(i % 6) + 1})`;
      laneLayer.appendChild(el("rect", {
        class: "lane-bg",
        x: 0, y: lane.y, width: totalW, height: lane.h,
        fill,
      }));
      if (i > 0) {
        laneLayer.appendChild(el("line", {
          x1: 0, x2: totalW, y1: lane.y, y2: lane.y,
          stroke: "var(--rule)", "stroke-width": 0.75,
        }));
      }
      // label strip
      const labelText = lane.label;
      const labelW = Math.max(68, labelText.length * 7.2 + 18);
      laneLayer.appendChild(el("rect", {
        class: "lane-label-bg",
        x: 10, y: lane.y + 8, width: labelW, height: 16,
        rx: 3, ry: 3,
      }));
      const labelEl = el("text", {
        class: "lane-label",
        x: 19, y: lane.y + 20,
      });
      labelEl.textContent = labelText;
      laneLayer.appendChild(labelEl);
    });
    svg.appendChild(laneLayer);

    // -- arrow marker defs --
    const defs = el("defs");
    for (const kind of ["solid", "dashed", "dotted"]) {
      defs.appendChild(el("marker", {
        id: `arrow-${kind}`,
        viewBox: "0 0 10 10",
        refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7,
        orient: "auto-start-reverse",
      }, el("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrowhead" })));
    }
    // Highlight variants
    for (const variant of ["in", "out"]) {
      const color = variant === "in" ? "var(--accent-in)" : "var(--accent-out)";
      defs.appendChild(el("marker", {
        id: `arrow-${variant}`,
        viewBox: "0 0 10 10",
        refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7,
        orient: "auto-start-reverse",
      }, el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color })));
    }
    svg.appendChild(defs);

    // -- edges (below nodes) --
    const edgeLayer = el("g", { class: "edges" });
    const edgeIndex = new Map(); // id → element
    const edgeByFrom = new Map();
    const edgeByTo = new Map();
    (spec.edges || []).forEach((e, i) => {
      const from = placed.get(e.from);
      const to = placed.get(e.to);
      if (!from || !to) {
        console.warn(`edge references missing node: ${e.from} → ${e.to}`);
        return;
      }
      const d = edgePath(from, to, e.bend || 0);
      const id = e.id || `e${i}`;
      const path = el("path", {
        class: `edge ${e.kind || "solid"}`,
        d,
        "marker-end": `url(#arrow-${e.kind || "solid"})`,
        "data-edge": id,
        "data-from": e.from,
        "data-to": e.to,
      });
      edgeLayer.appendChild(path);
      edgeIndex.set(id, { el: path, ...e });
      if (!edgeByFrom.has(e.from)) edgeByFrom.set(e.from, []);
      if (!edgeByTo.has(e.to)) edgeByTo.set(e.to, []);
      edgeByFrom.get(e.from).push(id);
      edgeByTo.get(e.to).push(id);
    });
    svg.appendChild(edgeLayer);

    // -- nodes --
    const nodeLayer = el("g", { class: "nodes" });
    for (const n of placed.values()) {
      const g = el("g", {
        class: "node",
        "data-node": n.id,
        transform: `translate(${n.x}, ${n.y})`,
      });
      g.appendChild(el("rect", {
        width: n.w, height: n.h, rx: 5, ry: 5,
      }));
      const t = el("text", { x: n.w / 2, y: n.h / 2 });
      t.textContent = n.label;
      // Shrink label font-size if it would overflow the node box.
      // IBM Plex Mono at 11px ~= 6.6px/char; pad 10px each side.
      const usable = n.w - 20;
      const approxW = n.label.length * 6.6;
      if (approxW > usable) {
        const size = Math.max(7.5, 11 * (usable / approxW));
        t.setAttribute("style", `font-size: ${size.toFixed(2)}px`);
      }
      g.appendChild(t);
      nodeLayer.appendChild(g);
    }
    svg.appendChild(nodeLayer);

    // -- flag pins --
    const flagLayer = el("g", { class: "flags" });
    const flagById = new Map();
    (spec.flags || []).forEach((f) => {
      for (const nodeId of f.nodes) {
        const n = placed.get(nodeId);
        if (!n) continue;
        const cx = n.x + n.w - 6;
        const cy = n.y + 6;
        const pin = el("circle", {
          class: "flag-pin",
          cx, cy, r: 8,
          "data-flag": f.num,
          "data-node": nodeId,
        });
        const num = el("text", {
          class: "flag-pin-num",
          x: cx, y: cy + 0.5,
          "data-flag": f.num,
          "data-node": nodeId,
        });
        num.textContent = f.num;
        flagLayer.appendChild(pin);
        flagLayer.appendChild(num);
      }
      flagById.set(f.num, f);
    });
    svg.appendChild(flagLayer);

    container.innerHTML = "";
    container.appendChild(svg);

    // -- tooltip (Floating UI) --
    // Portal to <body> so the boundary is the viewport, not the diagram container.
    const tooltip = document.createElement("div");
    tooltip.className = "diagram-tooltip";
    document.body.appendChild(tooltip);

    function fillTooltip(data) {
      tooltip.innerHTML = "";
      const title = data.label || data.title;
      const body = data.purpose || data.description;
      const lbl = document.createElement("div");
      lbl.className = "tt-label";
      lbl.textContent = title;
      tooltip.appendChild(lbl);
      if (body) {
        const p = document.createElement("div");
        p.className = "tt-purpose";
        p.textContent = body;
        tooltip.appendChild(p);
      }
      if (data.file) {
        const f = document.createElement("div");
        f.className = "tt-file";
        f.textContent = data.file;
        tooltip.appendChild(f);
      }
    }

    let cleanupAutoUpdate = null;
    function showTooltip(reference, data) {
      const FUI = window.FloatingUIDOM;
      if (!FUI) return; // library not loaded — silently skip
      fillTooltip(data);
      tooltip.classList.add("visible");
      if (cleanupAutoUpdate) { cleanupAutoUpdate(); cleanupAutoUpdate = null; }
      const update = () => {
        FUI.computePosition(reference, tooltip, {
          placement: "right-start",
          strategy: "fixed",
          middleware: [
            FUI.offset(10),
            FUI.flip({ fallbackPlacements: ["left-start", "bottom-start", "top-start", "right-end", "left-end"] }),
            FUI.shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        });
      };
      cleanupAutoUpdate = FUI.autoUpdate(reference, tooltip, update);
    }
    function hideTooltip() {
      tooltip.classList.remove("visible");
      if (cleanupAutoUpdate) { cleanupAutoUpdate(); cleanupAutoUpdate = null; }
    }

    const diagramRoot = container.querySelector(".diagram-svg");
    diagramRoot.classList.add("diagram");

    // Node hover/click
    diagramRoot.querySelectorAll(".node").forEach((g) => {
      const id = g.getAttribute("data-node");
      const data = placed.get(id);
      g.addEventListener("mouseenter", () => showTooltip(g, data));
      g.addEventListener("mouseleave", hideTooltip);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelection(id);
      });
    });
    diagramRoot.addEventListener("click", () => {
      clearSelection();
    });
    // Flag pin click = delegate to sidebar flag item; hover = show tooltip
    diagramRoot.querySelectorAll(".flag-pin, .flag-pin-num").forEach((p) => {
      const num = p.getAttribute("data-flag");
      const flag = flagById.get(Number(num));
      p.addEventListener("click", (e) => {
        e.stopPropagation();
        highlightFlag(num);
      });
      if (flag) {
        p.addEventListener("mouseenter", () => showTooltip(p, flag));
        p.addEventListener("mouseleave", hideTooltip);
      }
    });

    // ---- selection / highlight API ----
    let selectedNode = null;
    let activeFlow = null;

    function clearSelection() {
      selectedNode = null;
      diagramRoot.classList.remove("has-selection");
      diagramRoot.querySelectorAll(".node").forEach(n => n.classList.remove("is-selected", "is-incoming", "is-outgoing"));
      diagramRoot.querySelectorAll(".edge").forEach(e => {
        e.classList.remove("is-highlighted", "is-incoming", "is-outgoing");
        const kind = e.classList.contains("dashed") ? "dashed" : e.classList.contains("dotted") ? "dotted" : "solid";
        e.setAttribute("marker-end", `url(#arrow-${kind})`);
      });
      diagramRoot.querySelectorAll(".flag-pin").forEach(p => p.classList.remove("is-highlighted"));
      container.querySelectorAll(".flag-item").forEach(el => el.classList.remove("active"));
    }

    function toggleSelection(id) {
      if (selectedNode === id) {
        clearSelection();
        return;
      }
      clearSelection();
      selectedNode = id;
      diagramRoot.classList.add("has-selection");
      const self = diagramRoot.querySelector(`.node[data-node="${CSS.escape(id)}"]`);
      if (self) self.classList.add("is-selected");
      // Outgoing: edges where from === id → target nodes highlighted amber
      for (const eid of edgeByFrom.get(id) || []) {
        const e = edgeIndex.get(eid);
        e.el.classList.add("is-highlighted", "is-outgoing");
        e.el.setAttribute("marker-end", "url(#arrow-out)");
        const n = diagramRoot.querySelector(`.node[data-node="${CSS.escape(e.to)}"]`);
        if (n) n.classList.add("is-outgoing");
      }
      // Incoming: edges where to === id → source nodes highlighted teal
      for (const eid of edgeByTo.get(id) || []) {
        const e = edgeIndex.get(eid);
        e.el.classList.add("is-highlighted", "is-incoming");
        e.el.setAttribute("marker-end", "url(#arrow-in)");
        const n = diagramRoot.querySelector(`.node[data-node="${CSS.escape(e.from)}"]`);
        if (n) n.classList.add("is-incoming");
      }
    }

    function highlightFlag(num) {
      clearSelection();
      const f = flagById.get(Number(num)) || flagById.get(String(num));
      if (!f) return;
      diagramRoot.classList.add("has-selection");
      for (const nid of f.nodes) {
        const n = diagramRoot.querySelector(`.node[data-node="${CSS.escape(nid)}"]`);
        if (n) n.classList.add("is-selected");
        const pins = diagramRoot.querySelectorAll(`.flag-pin[data-flag="${f.num}"]`);
        pins.forEach(p => p.classList.add("is-highlighted"));
      }
      const item = container.parentElement.querySelector(`.flag-item[data-flag="${f.num}"]`);
      if (item) item.classList.add("active");
    }

    function clearFlow() {
      if (!activeFlow) return;
      for (const eid of activeFlow.edges) {
        const e = edgeIndex.get(eid);
        if (e) e.el.classList.remove("flow-outgoing", "flow-incoming");
      }
      activeFlow = null;
    }

    function setFlow(flowId) {
      const flow = (spec.flows || []).find(f => f.id === flowId);
      if (!flow) return;
      clearFlow();
      for (const eid of flow.edges) {
        const e = edgeIndex.get(eid);
        if (e) e.el.classList.add("flow-outgoing");
      }
      activeFlow = flow;
    }

    return {
      clearSelection,
      toggleSelection,
      highlightFlag,
      setFlow,
      clearFlow,
    };
  }

  // ---- sidebar wiring ----
  function buildSidebar(sidebarEl, spec, api) {
    // Legend
    const legend = document.createElement("div");
    legend.className = "sidebar-block";
    legend.innerHTML = `
      <h3>Edge legend</h3>
      <div class="legend-row">
        <svg viewBox="0 0 40 10"><line x1="2" x2="38" y1="5" y2="5" stroke="currentColor" stroke-width="1.2"/></svg>
        solid · owns / includes
      </div>
      <div class="legend-row">
        <svg viewBox="0 0 40 10"><line x1="2" x2="38" y1="5" y2="5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="6 4"/></svg>
        dashed · runtime message
      </div>
      <div class="legend-row">
        <svg viewBox="0 0 40 10"><line x1="2" x2="38" y1="5" y2="5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/></svg>
        dotted · data flow
      </div>
      <div class="legend-row" style="margin-top:0.5rem;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent-in);"></span>
        incoming · dependents
      </div>
      <div class="legend-row">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent-out);"></span>
        outgoing · dependencies
      </div>
    `;
    sidebarEl.appendChild(legend);

    if ((spec.flags || []).length) {
      const flagsBlock = document.createElement("div");
      flagsBlock.className = "sidebar-block";
      const h = document.createElement("h3");
      h.textContent = "Flags";
      flagsBlock.appendChild(h);
      const ul = document.createElement("ul");
      ul.className = "flag-list";
      for (const f of spec.flags) {
        const li = document.createElement("li");
        li.className = "flag-item";
        li.setAttribute("data-flag", f.num);
        li.innerHTML = `
          <div class="flag-num">${f.num}</div>
          <div class="flag-body">
            <div class="flag-title">${f.title}</div>
            <div class="flag-desc">${f.description}</div>
          </div>
        `;
        li.addEventListener("click", () => {
          const alreadyActive = li.classList.contains("active");
          sidebarEl.querySelectorAll(".flag-item").forEach(el => el.classList.remove("active"));
          if (alreadyActive) {
            api.clearSelection();
          } else {
            api.highlightFlag(f.num);
          }
        });
        ul.appendChild(li);
      }
      flagsBlock.appendChild(ul);
      sidebarEl.appendChild(flagsBlock);
    }

    if ((spec.flows || []).length) {
      const flowBlock = document.createElement("div");
      flowBlock.className = "sidebar-block";
      const h = document.createElement("h3");
      h.textContent = "Flow overlays";
      flowBlock.appendChild(h);
      const ul = document.createElement("ul");
      ul.className = "flow-list";
      let currentActive = null;
      for (const flow of spec.flows) {
        const li = document.createElement("li");
        li.className = "flow-item";
        li.setAttribute("data-flow", flow.id);
        li.innerHTML = `
          <div class="flow-toggle"></div>
          <div class="flag-body">
            <div class="flag-title">${flow.label}</div>
            <div class="flag-desc" style="display:block;">${flow.description}</div>
          </div>
        `;
        li.addEventListener("click", () => {
          if (currentActive === li) {
            li.classList.remove("active");
            api.clearFlow();
            currentActive = null;
          } else {
            sidebarEl.querySelectorAll(".flow-item").forEach(el => el.classList.remove("active"));
            li.classList.add("active");
            api.setFlow(flow.id);
            currentActive = li;
          }
        });
        ul.appendChild(li);
      }
      flowBlock.appendChild(ul);
      sidebarEl.appendChild(flowBlock);
    }

    // Clear selection button
    const clearBtn = document.createElement("button");
    clearBtn.className = "clear-selection";
    clearBtn.textContent = "clear selection";
    clearBtn.addEventListener("click", () => {
      api.clearSelection();
      api.clearFlow();
      sidebarEl.querySelectorAll(".flow-item, .flag-item").forEach(el => el.classList.remove("active"));
    });
    sidebarEl.appendChild(clearBtn);
  }

  async function mount({ diagramEl, sidebarEl, specUrl, spec }) {
    if (!spec) {
      const res = await fetch(specUrl);
      if (!res.ok) throw new Error(`Failed to load ${specUrl}: ${res.status}`);
      spec = await res.json();
    }
    const api = render(diagramEl, spec);
    if (sidebarEl) buildSidebar(sidebarEl, spec, api);
    return { spec, api };
  }

  function mountFromScript({ diagramEl, sidebarEl, scriptId }) {
    const tag = document.getElementById(scriptId);
    if (!tag) throw new Error(`No script tag with id ${scriptId}`);
    const spec = JSON.parse(tag.textContent);
    const api = render(diagramEl, spec);
    if (sidebarEl) buildSidebar(sidebarEl, spec, api);
    return { spec, api };
  }

  window.TracktionDiagram = { mount, mountFromScript, render };
})();
