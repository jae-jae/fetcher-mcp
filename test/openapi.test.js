import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { registerOpenApiRoutes } from "../build/transports/openapi.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("openapi routes", { concurrency: 1 }, () => {
  it("serves a spec whose version matches package.json", async () => {
    const app = express();
    app.use(express.json());
    registerOpenApiRoutes(app);
    const server = await listen(app);
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/openapi.json`);
      assert.equal(response.status, 200);
      const spec = await response.json();
      assert.equal(spec.openapi, "3.1.0");
      assert.equal(spec.info.version, pkg.version);
      assert.notEqual(spec.info.version, "0.1.0");
      assert.match(spec.info.description, /no authentication/i);
      assert.match(spec.info.description, /browser_install/);
      assert.ok(spec.paths["/tools/fetch_url"]);
      assert.ok(spec.paths["/tools/fetch_urls"]);
      assert.ok(spec.paths["/tools/browser_install"]);
      assert.equal(spec.paths["/tools/fetch_url"].post.operationId, "fetch_url");
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
