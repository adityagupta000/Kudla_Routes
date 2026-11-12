"use strict";

function createRequestLifecycle(goButton) {
  let sequence = 0;
  let controller = null;

  const clearBusy = () => goButton.removeAttribute("aria-busy");

  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      sequence++;
      clearBusy();
      const currentSequence = sequence;
      return {
        signal: controller.signal,
        isCurrent: () => currentSequence === sequence,
      };
    },
    invalidate() {
      controller?.abort();
      controller = null;
      sequence++;
      clearBusy();
    },
    markBusy(request) {
      if (!request.isCurrent()) return false;
      goButton.setAttribute("aria-busy", "true");
      return true;
    },
    clearBusy(request) {
      if (!request.isCurrent()) return false;
      clearBusy();
      return true;
    },
  };
}

function handlePopState(event, {
  search,
  fromInput,
  toInput,
  run,
  invalidate,
  clearResults,
}) {
  let from;
  let to;

  if (event.state && event.state.from && event.state.to) {
    ({ from, to } = event.state);
  } else {
    const params = new URLSearchParams(search);
    from = params.get("from");
    to = params.get("to");
  }

  if (from && to) {
    fromInput.value = from;
    toInput.value = to;
    run();
    return;
  }

  invalidate();
  clearResults();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createRequestLifecycle, handlePopState };
} else {
  window.KudlaNavigation = { createRequestLifecycle, handlePopState };
}
