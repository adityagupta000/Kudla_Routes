(() => {
  const $ = (selector) => document.querySelector(selector);
  const fromInput = $("#from");
  const toInput = $("#to");
  const results = $("#results");
  const statusBox = $("#status");

  // Each bus family (45, 45A, 45B...) shares a line colour. The number is what identifies a bus; colour is secondary.
  const LINE_COLOURS = [
    "#0b6e7a",
    "#b5362f",
    "#3f6fb5",
    "#6b8e23",
    "#8e4a9e",
    "#c26a00",
    "#2f7d4f",
    "#7a5c3e",
  ];
  const lineFor = (busNumber) =>
    LINE_COLOURS[parseInt(busNumber, 10) % LINE_COLOURS.length];

  const plural = (n, word, many = `${word}s`) =>
    `${n} ${n === 1 ? word : many}`;

  // Small DOM helper. Text is always inserted as text, never as HTML.
  // WP4-F5: style key is never passed as an attribute — callers use applyStyle() instead.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "style") {
        // WP4-F5: never setAttribute("style") — parse and use setProperty instead
        // Expected format: "prop:value;prop2:value2" or CSS custom property "--line:#hex"
        for (const decl of String(value).split(";")) {
          const idx = decl.indexOf(":");
          if (idx < 0) continue;
          const prop = decl.slice(0, idx).trim();
          const val  = decl.slice(idx + 1).trim();
          if (prop) el.style.setProperty(prop, val);
        }
      } else {
        el.setAttribute(key, value === true ? "" : value);
      }
    }
    el.append(...children.flat().filter((c) => c != null && c !== false));
    return el;
  }

  // ---------------------------------------------------------------------------
  // Recent searches (Phase 5)
  // ---------------------------------------------------------------------------
  const RECENT_KEY = "kudla_recent_searches";
  const MAX_RECENT = 5;

  function getRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveRecent(from, to) {
    try {
      const existing = getRecent().filter(
        (r) => !(r.from === from && r.to === to),
      );
      const updated = [{ from, to }, ...existing].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {
      // localStorage unavailable — silently skip
    }
  }

  function clearRecent() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
    renderRecent();
  }

  const recentContainer = $("#recent-searches");

  function renderRecent() {
    const searches = getRecent();
    recentContainer.hidden = searches.length === 0;
    if (searches.length === 0) {
      recentContainer.replaceChildren();
      return;
    }
    const chips = searches.map(({ from, to }) =>
      h(
        "button",
        {
          type: "button",
          class: "chip recent-chip",
          onclick: () => {
            fromInput.value = from;
            toInput.value = to;
            run();
          },
        },
        `${from} → ${to}`,
      ),
    );
    recentContainer.replaceChildren(
      h("p", { class: "recent-label" }, "Recent searches"),
      h("div", { class: "chips" }, chips),
      h(
        "button",
        {
          type: "button",
          class: "clear-recent",
          onclick: clearRecent,
          "aria-label": "Clear recent searches",
        },
        "Clear",
      ),
      h(
        "p",
        { class: "recent-notice" },
        "Searches are saved locally on this device only.",
      ),
    );
  }

  // Render on startup
  renderRecent();

  // ---------------------------------------------------------------------------
  // Autocomplete
  // ---------------------------------------------------------------------------
  function setupCombo(input, list, onPick) {
    let items = [];
    let active = -1;
    let controller;
    let timer;

    const close = () => {
      list.hidden = true;
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };

    const pick = (i) => {
      input.value = items[i].name;
      close();
      onPick();
    };

    const render = () => {
      list.replaceChildren(
        ...items.map((item, i) =>
          h(
            "li",
            {
              role: "option",
              id: `${list.id}-${i}`,
              "aria-selected": String(i === active),
              onmousedown: (event) => {
                event.preventDefault();
                pick(i);
              },
            },
            h("span", {}, item.name),
            h("small", {}, plural(item.buses, "bus", "buses")),
          ),
        ),
      );
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", String(!list.hidden));
      if (active >= 0) {
        input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
        // Scroll active item into view for keyboard navigation (Phase 4-D1)
        const activeEl = list.querySelector(`#${list.id}-${active}`);
        if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    };

    let loadedFor = null; // the text the visible suggestions were fetched for

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const query = input.value;
      try {
        const res = await fetch(`/api/stops?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        items = await res.json();
        loadedFor = query;
        active = -1;
        render();
      } catch (error) {
        if (error.name !== "AbortError") close();
      }
    };

    input.addEventListener("input", () => {
      active = -1;
      clearTimeout(timer);
      timer = setTimeout(load, 120);
    });
    input.addEventListener("focus", load);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (event) => {
      if (list.hidden) {
        if (event.key === "ArrowDown") load();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        active = (active + 1) % items.length;
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        active = (active - 1 + items.length) % items.length;
        render();
      }
      // Only pick a suggestion that belongs to what is typed now; otherwise let the form submit what was typed.
      else if (
        event.key === "Enter" &&
        active >= 0 &&
        loadedFor === input.value
      ) {
        event.preventDefault();
        pick(active);
      } else if (event.key === "Escape") close();
    });
  }

  setupCombo(fromInput, $("#from-list"), () =>
    toInput.value.trim() ? run() : toInput.focus(),
  );
  setupCombo(toInput, $("#to-list"), () =>
    fromInput.value.trim() ? run() : fromInput.focus(),
  );

  // ---------------------------------------------------------------------------
  // Drawing a trip: stops on a line, with the bus plates on each stretch
  // ---------------------------------------------------------------------------
  function platesFor(buses, limit = 4) {
    const wrap = h("span", { class: "plates" });
    const draw = (count) => {
      wrap.replaceChildren(
        ...buses.slice(0, count).map((n) => h("span", { class: "plate" }, n)),
      );
      if (buses.length > count) {
        wrap.append(
          h(
            "button",
            {
              type: "button",
              class: "more",
              onclick: () => draw(buses.length),
            },
            `+${buses.length - count} more`,
          ),
        );
      }
    };
    draw(limit);
    return wrap;
  }

  // WP4-F5: colour is set via style.setProperty on the returned element directly,
  // avoiding setAttribute("style") which is blocked by style-src 'self' CSP.
  // Issue 1 fix: stop name rendered as a button so keyboard users can open stop details.
  const node = (name, kind, colour) => {
    const stopBtn = h(
      "button",
      {
        type: "button",
        class: "stop-name-btn",
        "aria-label": `Details for ${name}`,
        onclick: () => showStopDetails(name),
      },
      name,
    );
    const el = h("li", { class: `node ${kind}` }, stopBtn,
      kind === "change"
        ? h("span", { class: "hint" }, "Change bus here")
        : null,
    );
    if (colour) el.style.setProperty("--line", colour);
    return el;
  };

  // WP4: Render per-dimension evidence in plain language.
  // The API returns evidence.endpoints, evidence.stopSequence, evidence.direction,
  // evidence.currentOperation, each with status VERIFIED | PARTIALLY_VERIFIED | UNVERIFIED | ...
  function evidenceText(evidence) {
    if (!evidence) return "Data provenance unknown.";
    const lines = [];
    const ep = evidence.endpoints;
    if (ep === "PARTIALLY_VERIFIED") {
      lines.push("Endpoints matched in a published source.");
    } else if (ep === "VERIFIED") {
      lines.push("Endpoints independently verified.");
    } else {
      lines.push("Endpoints not confirmed against any source.");
    }
    lines.push("Stop order, direction, and current service: not independently confirmed.");
    return lines.join(" ");
  }

  function ride(leg, colour) {
    const between = leg.stops.slice(1, -1);
    const el = h(
      "li",
      { class: "ride" },
      h(
        "div",
        { class: "take" },
        leg.buses.length > 1 ? "Take any of" : "Take",
        platesFor(leg.buses),
        h("span", { class: "count" }, `for ${plural(leg.rides, "stop")}`),
      ),
      between.length
        ? h(
            "details",
            {},
            h(
              "summary",
              {},
              `Show ${plural(between.length, "stop")} in between`,
            ),
            h(
              "ul",
              { class: "via" },
              between.map((stop) => h("li", {}, stop)),
            ),
          )
        : null,
      // WP4: evidence replaces legacy confidence/TRUST text
      h("p", { class: "trust" }, evidenceText(leg.evidence)),
    );
    // WP4-F5: set --line custom property directly (not via setAttribute)
    el.style.setProperty("--line", colour);
    return el;
  }

  function trip(legs) {
    const items = [];
    legs.forEach((leg, i) => {
      const colour = lineFor(leg.buses[0]);
      items.push(
        node(leg.from, i === 0 ? "start" : "change", i === 0 ? colour : null),
        ride(leg, colour),
      );
    });
    const last = legs[legs.length - 1];
    items.push(node(last.to, "end", lineFor(last.buses[0])));
    return h("ol", { class: "trip" }, items);
  }

  function journeyCard(journey, isBest) {
    const heading = [];
    journey.legs.forEach((leg, i) => {
      if (i > 0) heading.push(h("span", { class: "then" }, "then"));
      heading.push(h("span", { class: "plate big" }, leg.buses[0]));
      if (leg.buses.length > 1)
        heading.push(h("small", {}, `+${leg.buses.length - 1} more`));
    });
    const kind =
      journey.changes === 0 ? "Direct" : plural(journey.changes, "change");
    return h(
      "article",
      { class: `journey${isBest ? " best" : ""}` },
      h(
        "div",
        { class: "journey-head" },
        heading,
        h(
          "span",
          { class: "summary" },
          `${kind}, ${plural(journey.rides, "stop")}`,
        ),
      ),
      // WP4: show rankingNote below the heading when present
      journey.rankingNote
        ? h("p", { class: "ranking-note" }, journey.rankingNote)
        : null,
      trip(journey.legs),
    );
  }

  // ---------------------------------------------------------------------------
  // Share / Copy journey (Phase 5)
  // ---------------------------------------------------------------------------
  function makeShareButton() {
    return h(
      "button",
      {
        type: "button",
        class: "share-btn",
        onclick: async () => {
          const url = location.href;
          const title = document.title;
          if (navigator.share) {
            try {
              await navigator.share({ title, url });
              return;
            } catch {
              // User cancelled or share failed — fall through to clipboard
            }
          }
          try {
            await navigator.clipboard.writeText(url);
            setStatus("Link copied to clipboard.");
          } catch {
            setStatus("Could not copy link. Copy the address bar manually.");
          }
        },
      },
      "Share / Copy link",
    );
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  const setStatus = (text) => {
    statusBox.textContent = text;
  };

  function showNotice(message, suggestions = {}) {
    results.replaceChildren();
    setStatus("");
    const chips = (field, input) =>
      (suggestions[field] || []).map((name) =>
        h(
          "button",
          {
            type: "button",
            class: "chip",
            onclick: () => {
              input.value = name;
              run();
            },
          },
          name,
        ),
      );
    const all = [...chips("from", fromInput), ...chips("to", toInput)];
    results.append(
      h(
        "div",
        { class: "notice", role: "alert" },
        h("p", {}, message),
        all.length
          ? h("div", {}, "Did you mean:", h("div", { class: "chips" }, all))
          : null,
      ),
    );
    // Show recent searches when no results
    renderRecent();
    recentContainer.hidden = getRecent().length === 0;
  }

  // Keep request cancellation, stale-response checks, and loading state in one
  // lifecycle shared with history navigation.
  const goBtn = $(".go");
  const requestLifecycle = window.KudlaNavigation.createRequestLifecycle(goBtn);
  const RUN_TIMEOUT_MS = 10000;

  async function run() {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();

    // Claim a new request generation before validation, aborting stale work and
    // clearing the previous loading state even when this submission is invalid.
    const request = requestLifecycle.begin();

    if (!from || !to) {
      showNotice("Enter a starting stop and a destination.");
      (from ? toInput : fromInput).focus();
      return;
    }

    // Hide recent searches while loading
    recentContainer.hidden = true;

    results.replaceChildren();
    setStatus("Looking for buses…");

    // aria-busy on the go button during load (Phase 4-D4)
    requestLifecycle.markBusy(request);

    // WP4: pushState for new searches so back/forward navigation works
    const newUrl = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (location.search !== newUrl) {
      history.pushState({ from, to }, "", newUrl);
    }

    try {
      const res = await fetch(
        `/api/plan?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          signal: AbortSignal.any
            ? AbortSignal.any([request.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)])
            : request.signal,
        },
      );
      if (!request.isCurrent()) return; // a newer submission or navigation superseded it
      const data = await res.json();
      if (!request.isCurrent()) return;
      requestLifecycle.clearBusy(request);
      if (!res.ok) return showNotice(data.error, data.suggestions);

      // WP4: show explicit correction message when stop names were changed
      if (data.corrected.from || data.corrected.to) {
        const typedFrom = from;
        const typedTo   = to;
        const fixedFrom = data.from;
        const fixedTo   = data.to;
        const parts = [];
        if (data.corrected.from && typedFrom.toLowerCase() !== fixedFrom.toLowerCase())
          parts.push(`"${typedFrom}" → "${fixedFrom}"`);
        if (data.corrected.to && typedTo.toLowerCase() !== fixedTo.toLowerCase())
          parts.push(`"${typedTo}" → "${fixedTo}"`);
        if (parts.length)
          setStatus(`Showing results for: ${parts.join(", ")}.`);
      }

      fromInput.value = data.from; // show the real stop names that were used
      toInput.value = data.to;
      // Update URL to resolved stop names (replaceState — this is not a new navigation)
      history.replaceState(
        { from: data.from, to: data.to },
        "",
        `?from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(data.to)}`,
      );
      document.title = `${data.from} to ${data.to} | Kudla Route — Mangaluru Bus Finder`;

      // Save to recent searches (only on a successful result with journeys)
      if (data.journeys && data.journeys.length > 0) {
        saveRecent(data.from, data.to);
      }

      showResults(data);
    } catch (err) {
      if (!request.isCurrent()) return;
      requestLifecycle.clearBusy(request);
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        showNotice("The request took too long. Check your connection and try again.");
      } else {
        showNotice(
          "Can't reach the server. Check your connection and try again.",
        );
      }
    }
  }

  function showResults(data) {
    results.replaceChildren();

    if (data.journeys.length === 0) {
      // Issue 5 fix: reverseRecorded:false does NOT prove no connection exists —
      // it means no route was found within the planner's 2-change search limit.
      // Issue 2 fix: popularStops are busiest by bus count, not geographically nearby.
      let msg;
      if (data.reverseRecorded) {
        msg = `No recorded route from ${data.from} to ${data.to} within 2 changes. ` +
              `A route from ${data.to} to ${data.from} is recorded in that direction — ` +
              `return directions are unverified, which does not mean no bus runs.`;
      } else {
        msg = `No connection recorded between ${data.from} and ${data.to} within 2 changes.`;
        const popular = data.popularStops || data.tryInstead; // support both field names
        if (popular && popular.length) {
          msg += ` Busiest stops (most buses): ${popular.join(", ")}.`;
        }
      }
      return showNotice(msg);
    }

    const [best, ...others] = data.journeys;

    // Share button near results heading (Phase 5)
    const shareBtn = makeShareButton();
    results.append(
      h("div", { class: "results-head" }, h("h2", {}, "Best way"), shareBtn),
    );
    results.append(journeyCard(best, true));
    if (others.length)
      results.append(
        h("h2", {}, "Other ways"),
        ...others.map((j) => journeyCard(j)),
      );
  }

  // WP4: popstate handler — restore form and results when user presses back/forward
  window.addEventListener("popstate", (event) => {
    window.KudlaNavigation.handlePopState(event, {
      search: location.search,
      fromInput,
      toInput,
      run,
      invalidate: () => requestLifecycle.invalidate(),
      clearResults: () => {
        results.replaceChildren();
        setStatus("");
      },
    });
  });

  $("#planner").addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  $("#swap").addEventListener("click", () => {
    [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
    if (fromInput.value.trim() && toInput.value.trim()) run();
  });

  // Open a shared link such as /?from=State%20Bank&to=Kunjathbail
  const params = new URLSearchParams(location.search);
  if (params.get("from") && params.get("to")) {
    fromInput.value = params.get("from");
    toInput.value = params.get("to");
    run();
  }

  // ---------------------------------------------------------------------------
  // Browse every bus
  // ---------------------------------------------------------------------------
  const browse = $("#browse");
  const busList = $("#bus-list");
  let allBuses = null;

  // WP4: evidence-based text for bus browsing — replaces legacy BROWSE_TRUST/confidence.
  // The API no longer sends confidence; use evidence.endpoints instead.
  function busEvidenceText(bus) {
    const ep = bus.evidence && bus.evidence.endpoints;
    if (ep === "PARTIALLY_VERIFIED") {
      return "Endpoints matched in a published source. Stop order and direction unconfirmed.";
    }
    if (ep === "VERIFIED") {
      return "Endpoints independently verified. Stop order and direction unconfirmed.";
    }
    return "Not confirmed against any source. Check with conductor before boarding.";
  }

  function busRow(bus) {
    const colour = lineFor(bus.number);
    // WP4-F5: --line is set via setProperty, not via style attribute
    const line = h(
      "ol",
      { class: "trip plain" },
      bus.stops.map((stop, i) => {
        const el = h(
          "li",
          {
            class: `node ${i === 0 ? "start" : i === bus.stops.length - 1 ? "end" : "stop"}`,
          },
          stop,
        );
        el.style.setProperty("--line", colour);
        return el;
      }),
    );
    return h(
      "li",
      { "data-search": `${bus.number} ${bus.stops.join(" ")}`.toLowerCase() },
      h(
        "details",
        {},
        h(
          "summary",
          {},
          h("span", { class: "plate" }, bus.number),
          h("span", { class: "route" }, `${bus.from} to ${bus.to}`),
          h("small", {}, plural(bus.stops.length, "stop")),
        ),
        h(
          "p",
          { class: "trust" },
          busEvidenceText(bus),
        ),
        line,
      ),
    );
  }

  // WP4: bus filter — exact number match first, then prefix, then stop-name substring
  function applyFilter() {
    const q = $("#filter").value.trim().toLowerCase();
    // Priority ranks: 0=exact number, 1=prefix number, 2=stop substring, 3=hidden
    const rows = Array.from(busList.children);
    if (!q) {
      for (const row of rows) row.hidden = false;
    } else {
      for (const row of rows) {
        const search = row.dataset.search || "";
        // Extract the bus number (first token of data-search)
        const num = search.split(" ")[0];
        const exactNum    = num === q;
        const prefixNum   = !exactNum && num.startsWith(q);
        const stopSubstr  = !exactNum && !prefixNum && search.includes(q);
        row.hidden = !(exactNum || prefixNum || stopSubstr);
        // Store sort key for ordering
        row.dataset.rank = exactNum ? "0" : prefixNum ? "1" : stopSubstr ? "2" : "3";
      }
      // Re-order rows by rank (exact first, then prefix, then stop-text match)
      const sorted = rows.filter((r) => !r.hidden).sort((a, b) =>
        (a.dataset.rank || "3").localeCompare(b.dataset.rank || "3"),
      );
      for (const row of sorted) busList.append(row);
    }

    $("#bus-list-empty")?.remove();
    const shown = rows.filter((r) => !r.hidden).length;
    if (!shown)
      busList.after(
        h(
          "p",
          { class: "empty", id: "bus-list-empty" },
          "No bus matches that. Try a stop name or a number.",
        ),
      );
  }

  browse.addEventListener("toggle", async () => {
    if (!browse.open || allBuses) return;

    // Show loading state (Phase 4-E2)
    busList.replaceChildren(
      h("li", { class: "empty" }, "Loading bus routes…"),
    );

    try {
      allBuses = await (await fetch("/api/buses")).json();
      busList.replaceChildren(...allBuses.map(busRow));
    } catch {
      busList.replaceChildren(
        h(
          "li",
          { class: "empty" },
          "Couldn't load the routes. Check your connection and reopen this section.",
        ),
      );
    }
  });
  $("#filter").addEventListener("input", applyFilter);

  // ---------------------------------------------------------------------------
  // Stop details panel — wired to /api/stop/:name (WP4)
  // ---------------------------------------------------------------------------
  async function showStopDetails(stopName) {
    const panelId = `stop-panel-${CSS.escape(stopName.replace(/\s+/g, "-"))}`;
    const existing = $(`#${panelId}`);
    if (existing) {
      existing.hidden = !existing.hidden;
      return;
    }

    const loadingPanel = h(
      "div",
      { class: "stop-panel", id: panelId },
      h("p", { class: "empty" }, `Loading details for ${stopName}…`),
    );
    results.append(loadingPanel);

    try {
      const res = await fetch(`/api/stop/${encodeURIComponent(stopName)}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (!res.ok) {
        loadingPanel.replaceChildren(
          h("p", {}, `Stop "${stopName}" not found.`),
          closeBtn(loadingPanel),
        );
        return;
      }
      const stop = await res.json();

      const aliasLine = stop.aliases && stop.aliases.length
        ? h("p", {}, `Also known as: ${stop.aliases.join(", ")}`)
        : null;

      const busList2 = stop.buses && stop.buses.length
        ? h(
            "ul",
            { class: "stop-buses" },
            stop.buses.map((b) =>
              h("li", {}, h("span", { class: "plate" }, b.number), ` ${b.from} to ${b.to}`),
            ),
          )
        : h("p", {}, "No recorded buses serve this stop.");

      loadingPanel.replaceChildren(
        h("h3", {}, `Stop: ${stop.name}`),
        aliasLine,
        h("p", {}, `${plural(stop.buses ? stop.buses.length : 0, "bus", "buses")} recorded here.`),
        busList2,
        h("p", { class: "trust" }, stop.note || "Service availability not guaranteed."),
        closeBtn(loadingPanel),
      );
    } catch {
      loadingPanel.replaceChildren(
        h("p", { class: "trust" }, "Could not load stop details."),
        closeBtn(loadingPanel),
      );
    }
  }

  function closeBtn(panel) {
    return h(
      "button",
      {
        type: "button",
        class: "chip",
        onclick: () => panel.remove(),
      },
      "Close",
    );
  }

  // showStopDetails is available for future integration but not auto-triggered.
  // The dead window hook and stale TODO are removed (WP4).
})();
