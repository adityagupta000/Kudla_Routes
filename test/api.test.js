const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../backend/index");

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test("GET /api/plan returns ranked journeys", async () => {
  const { status, body } = await get(
    "/api/plan?from=State%20Bank&to=Kunjathbail",
  );
  assert.equal(status, 200);
  assert.equal(body.from, "State Bank");
  assert.deepEqual(body.journeys[0].legs[0].buses, ["1"]);
});

test("GET /api/plan corrects a typo and says so", async () => {
  const { body } = await get("/api/plan?from=kankandy&to=Lalbagh");
  assert.equal(body.from, "Kankanady");
  assert.equal(body.corrected.from, true);
  assert.equal(body.corrected.to, false);
});

test("GET /api/plan explains problems in plain words", async () => {
  assert.equal((await get("/api/plan?from=State%20Bank")).status, 400);
  assert.equal(
    (await get("/api/plan?from=State%20Bank&to=State%20Bank")).status,
    400,
  );
  const unknown = await get("/api/plan?from=zzzzzz&to=Lalbagh");
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /zzzzzz/);
});

test("GET /api/stops autocompletes", async () => {
  const { body } = await get("/api/stops?q=surath");
  assert.equal(body[0].name, "Surathkal");
});

test("GET /api/bus/:number returns the full route; unknown numbers are a 404", async () => {
  const ok = await get("/api/bus/45a");
  assert.equal(ok.body.number, "45A");
  assert.equal(ok.body.from, "State Bank");
  assert.equal((await get("/api/bus/999")).status, 404);
});

test("the frontend is served from the same server", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>/);
});
