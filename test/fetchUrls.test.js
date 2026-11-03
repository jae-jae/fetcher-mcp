import { it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchUrls } from "../build/tools/fetchUrls.js";

it("preserves successful batch results when returnText extraction fails", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/image.svg") {
      // A valid SVG document has no body, so innerText('body') times out.
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><text>SVG text</text></svg>');
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Success</title></head><body>Successful page content</body></html>");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const originalAllow = process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
  process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS = "true";
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let result;
    await assert.doesNotReject(async () => {
      result = await fetchUrls({
        urls: [`${baseUrl}/page.html`, `${baseUrl}/image.svg`],
        returnText: true,
        timeout: 2000,
        debug: false,
      });
    });

    const text = result.content[0].text;
    assert.match(text, /\[webpage 1 begin\][\s\S]*Successful page content[\s\S]*\[webpage 1 end\]/);
    assert.match(text, /\[webpage 2 begin\][\s\S]*Title: Error[\s\S]*\[webpage 2 end\]/);
    assert.ok(text.includes(`URL: ${baseUrl}/image.svg`));
    assert.match(text, /<error>Failed to retrieve web page content: page\.innerText: Timeout/);
  } finally {
    if (originalAllow === undefined) {
      delete process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
    } else {
      process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS = originalAllow;
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
