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

  const TRUST = {
    high: "Route ends match 2 online sources.",
    medium: "Route ends match 1 online source.",
    low: "Not confirmed online. Check with the conductor.",
  };

  const plural = (n, word, many = `${word}s`) =>
    `${n} ${n === 1 ? word : many}`;

  // Small DOM helper. Text is always inserted as text, never as HTML.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...children.flat().filter((c) => c != null && c !== false));
    return el;
  }

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
      if (active >= 0)
        input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      else input.removeAttribute("aria-activedescendant");
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

  const node = (name, kind, colour) =>
    h(
      "li",
      { class: `node ${kind}`, style: colour ? `--line:${colour}` : null },
      name,
      kind === "change"
        ? h("span", { class: "hint" }, "Change bus here")
        : null,
    );

  function ride(leg, colour) {
    const between = leg.stops.slice(1, -1);
    return h(
      "li",
      { class: "ride", style: `--line:${colour}` },
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
      leg.confidence
        ? h("p", { class: `trust ${leg.confidence}` }, TRUST[leg.confidence])
        : null,
    );
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
      trip(journey.legs),
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
  }

  async function run() {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    if (!from || !to) {
      showNotice("Enter a starting stop and a destination.");
      (from ? toInput : fromInput).focus();
      return;
    }

    results.replaceChildren();
    setStatus("Looking for buses…");
    try {
      const res = await fetch(
        `/api/plan?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const data = await res.json();
      if (!res.ok) return showNotice(data.error, data.suggestions);

      fromInput.value = data.from; // show the real stop names that were used
      toInput.value = data.to;
      history.replaceState(
        null,
        "",
        `?from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(data.to)}`,
      );
      document.title = `${data.from} to ${data.to} | Mangalore bus finder`;
      showResults(data);
    } catch {
      showNotice(
        "Can't reach the server. Check your connection and try again.",
      );
    }
  }

  function showResults(data) {
    const fixed = data.corrected.from || data.corrected.to;
    setStatus(fixed ? `Showing buses from ${data.from} to ${data.to}.` : "");
    results.replaceChildren();

    if (data.journeys.length === 0) {
      return showNotice(
        `No bus route found from ${data.from} to ${data.to}. Try a busy stop nearby, such as ${data.tryInstead.join(", ")}.`,
      );
    }
    const [best, ...others] = data.journeys;
    results.append(h("h2", {}, "Best way"), journeyCard(best, true));
    if (others.length)
      results.append(
        h("h2", {}, "Other ways"),
        ...others.map((j) => journeyCard(j)),
      );
  }

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

  function busRow(bus) {
    const colour = lineFor(bus.number);
    // every stop on one coloured line
    const line = h(
      "ol",
      { class: "trip plain" },
      bus.stops.map((stop, i) =>
        h(
          "li",
          {
            class: `node ${i === 0 ? "start" : i === bus.stops.length - 1 ? "end" : "stop"}`,
            style: `--line:${colour}`,
          },
          stop,
        ),
      ),
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
        bus.confidence === "low"
          ? h("p", { class: "trust low", style: "padding:0 1rem" }, TRUST.low)
          : null,
        line,
      ),
    );
  }

  function applyFilter() {
    const q = $("#filter").value.trim().toLowerCase();
    let shown = 0;
    for (const row of busList.children) {
      const match = !q || row.dataset.search.includes(q);
      row.hidden = !match;
      if (match) shown++;
    }
    $("#bus-list-empty")?.remove();
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
})();
