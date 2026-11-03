import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  ProxyConfigError,
  describeProxy,
  parseProxySettings,
  redactProxySecrets,
  toPlaywrightProxy,
} from "../build/config/proxy.js";
import { tools } from "../build/tools/index.js";
import {
  URLSecurityError,
  validateUrlProtocol,
} from "../build/utils/urlValidator.js";

const SECRET = "super-secret-password";

function expectInvalid(env, pattern) {
  assert.throws(
    () => parseProxySettings(env),
    (err) => {
      assert.ok(err instanceof ProxyConfigError, `expected ProxyConfigError, got ${err}`);
      const message = String(err.message);
      assert.equal(message.includes(SECRET), false, message);
      if (env.FETCHER_PROXY) {
        assert.equal(message.includes(env.FETCHER_PROXY), false, message);
      }
      if (pattern) assert.match(message, pattern);
      return true;
    }
  );
}

describe("proxy config parsing", { concurrency: 1 }, () => {
  it("returns undefined when FETCHER_PROXY is unset, empty, or blank", () => {
    assert.equal(parseProxySettings({}), undefined);
    assert.equal(parseProxySettings({ FETCHER_PROXY: "" }), undefined);
    assert.equal(parseProxySettings({ FETCHER_PROXY: "   " }), undefined);
    assert.equal(
      parseProxySettings({ FETCHER_PROXY: "", NO_PROXY: "http://not-a-bypass" }),
      undefined
    );
  });

  it("parses http, https, and socks5 proxies without credentials", () => {
    assert.deepEqual(parseProxySettings({ FETCHER_PROXY: "http://proxy.example.com:8080" }), {
      server: "http://proxy.example.com:8080",
    });
    assert.deepEqual(parseProxySettings({ FETCHER_PROXY: "https://proxy.example.com:8443" }), {
      server: "https://proxy.example.com:8443",
    });
    assert.deepEqual(parseProxySettings({ FETCHER_PROXY: "  SOCKS5://proxy.example.com:1080  " }), {
      server: "socks5://proxy.example.com:1080",
    });
    assert.deepEqual(parseProxySettings({ FETCHER_PROXY: "HTTPS://Proxy.Example:8443" }), {
      server: "https://proxy.example:8443",
    });
  });

  it("allows a proxy on a loopback, private, or link-local address", () => {
    for (const proxy of [
      "http://127.0.0.1:8888",
      "http://10.0.0.5:3128",
      "http://169.254.169.254:8080",
      "socks5://[::1]:1080",
    ]) {
      const settings = parseProxySettings({ FETCHER_PROXY: proxy });
      assert.equal(settings.username, undefined);
      assert.match(settings.server, /^(http|socks5):\/\//);
    }
    assert.equal(
      parseProxySettings({ FETCHER_PROXY: "http://[2001:db8::1]:8080" }).server,
      "http://[2001:db8::1]:8080"
    );
  });

  it("decodes URL-encoded HTTP credentials and keeps them out of the server string", () => {
    const settings = parseProxySettings({
      FETCHER_PROXY: "http://proxyuser:p%40ss%3Aword@proxy.example.com:8080",
    });
    assert.equal(settings.server, "http://proxy.example.com:8080");
    assert.equal(settings.username, "proxyuser");
    assert.equal(settings.password, "p@ss:word");

    const encoded = parseProxySettings({
      FETCHER_PROXY: "https://us%3Aer:p%2Fass@h.example:9",
    });
    assert.equal(encoded.server, "https://h.example:9");
    assert.equal(encoded.username, "us:er");
    assert.equal(encoded.password, "p/ass");

    const plus = parseProxySettings({
      FETCHER_PROXY: "http://user:a+b@proxy.example.com:8080",
    });
    assert.equal(plus.password, "a+b");

    const usernameOnly = parseProxySettings({
      FETCHER_PROXY: "http://onlyuser@proxy.example.com:8080",
    });
    assert.equal(usernameOnly.username, "onlyuser");
    assert.equal(usernameOnly.password, "");
  });

  it("rejects invalid proxy URLs without echoing the password", () => {
    expectInvalid(
      { FETCHER_PROXY: `ftp://user:${SECRET}@proxy.example.com:21` },
      /unsupported scheme/
    );
    expectInvalid(
      { FETCHER_PROXY: `socks4://user:${SECRET}@proxy.example.com:1080` },
      /unsupported scheme/
    );
    expectInvalid(
      { FETCHER_PROXY: `socks5h://user:${SECRET}@proxy.example.com:1080` },
      /unsupported scheme/
    );
    expectInvalid(
      { FETCHER_PROXY: `${SECRET}:9090` },
      /unsupported scheme/
    );
    expectInvalid({ FETCHER_PROXY: "not a url" }, /could not parse/);
    expectInvalid(
      { FETCHER_PROXY: `http://user:${SECRET}@proxy.example.com` },
      /explicit port/
    );
    expectInvalid(
      { FETCHER_PROXY: `http://user:${SECRET}@proxy.example.com:8080/extra` },
      /path, query, or fragment/
    );
    expectInvalid(
      { FETCHER_PROXY: `http://user:${SECRET}@proxy.example.com:8080?x=1` },
      /path, query, or fragment/
    );
    expectInvalid(
      { FETCHER_PROXY: `http://user:${SECRET}#zz@proxy.example.com:8080` },
      /Invalid FETCHER_PROXY/
    );
    expectInvalid(
      { FETCHER_PROXY: `http://user:a%zz${SECRET}@proxy.example.com:8080` },
      /percent-encoding/
    );
    expectInvalid(
      { FETCHER_PROXY: `http://:${SECRET}@proxy.example.com:8080` },
      /without a username/
    );
  });

  it("rejects SOCKS5 credentials instead of connecting without them", () => {
    expectInvalid(
      { FETCHER_PROXY: `socks5://proxyuser:${SECRET}@127.0.0.1:1080` },
      /SOCKS5 authentication/
    );
    const message = (() => {
      try {
        parseProxySettings({
          FETCHER_PROXY: `socks5://proxyuser:${SECRET}@127.0.0.1:1080`,
        });
      } catch (err) {
        return err.message;
      }
    })();
    assert.match(message, /socks5:\/\/127\.0\.0\.1:1080/);
    assert.equal(message.includes("proxyuser"), false);
    assert.equal(message.includes(SECRET), false);
  });

  it("parses FETCHER_PROXY_BYPASS and NO_PROXY into Playwright's bypass list", () => {
    const fromBypass = parseProxySettings({
      FETCHER_PROXY: "http://proxy.example.com:8080",
      FETCHER_PROXY_BYPASS: "localhost, .example.com, 10.0.0.0/8, *.internal.example",
    });
    assert.equal(
      fromBypass.bypass,
      "localhost,.example.com,10.0.0.0/8,*.internal.example"
    );

    const fromNoProxy = parseProxySettings({
      FETCHER_PROXY: "socks5://proxy.example.com:1080",
      NO_PROXY: "localhost 127.0.0.1 ::1 <local>",
    });
    assert.equal(fromNoProxy.bypass, "localhost,127.0.0.1,::1,<local>");

    const fromLower = parseProxySettings({
      FETCHER_PROXY: "http://proxy.example.com:8080",
      no_proxy: "example.com:443;localhost:3000",
    });
    assert.equal(fromLower.bypass, "example.com,localhost");

    const quoted = parseProxySettings({
      FETCHER_PROXY: "http://proxy.example.com:8080",
      NO_PROXY: '"localhost", *.example.com:443, <-loopback>, *',
    });
    assert.equal(quoted.bypass, "localhost,*.example.com,<-loopback>,*");
  });

  it("prefers FETCHER_PROXY_BYPASS over NO_PROXY, including an explicit empty bypass", () => {
    const preferred = parseProxySettings({
      FETCHER_PROXY: "http://proxy.example.com:8080",
      FETCHER_PROXY_BYPASS: "example.org",
      NO_PROXY: "localhost",
    });
    assert.equal(preferred.bypass, "example.org");

    const cleared = parseProxySettings({
      FETCHER_PROXY: "http://proxy.example.com:8080",
      FETCHER_PROXY_BYPASS: "",
      NO_PROXY: "localhost",
    });
    assert.equal(cleared.bypass, undefined);
    assert.equal(cleared.server, "http://proxy.example.com:8080");
  });

  it("rejects a bad bypass list without echoing the proxy password", () => {
    expectInvalid(
      {
        FETCHER_PROXY: `http://user:${SECRET}@proxy.example.com:8080`,
        FETCHER_PROXY_BYPASS: "http://evil.example",
      },
      /Invalid FETCHER_PROXY_BYPASS/
    );
    expectInvalid(
      {
        FETCHER_PROXY: `http://user:${SECRET}@proxy.example.com:8080`,
        NO_PROXY: "user@internal",
      },
      /Invalid NO_PROXY/
    );
  });

  it("builds a Playwright proxy object and a log line without credentials", () => {
    const plain = parseProxySettings({ FETCHER_PROXY: "socks5://proxy.example.com:1080" });
    assert.deepEqual(toPlaywrightProxy(plain), { server: "socks5://proxy.example.com:1080" });
    assert.equal(Object.hasOwn(toPlaywrightProxy(plain), "username"), false);
    assert.equal(Object.hasOwn(toPlaywrightProxy(plain), "password"), false);

    const authed = parseProxySettings({
      FETCHER_PROXY: `http://proxyuser:${SECRET}@10.0.0.5:3128`,
      FETCHER_PROXY_BYPASS: "localhost",
    });
    assert.deepEqual(toPlaywrightProxy(authed), {
      server: "http://10.0.0.5:3128",
      bypass: "localhost",
      username: "proxyuser",
      password: SECRET,
    });
    const line = describeProxy(authed);
    assert.equal(line, "Using proxy http://10.0.0.5:3128 (authentication configured); bypass localhost");
    assert.equal(line.includes(SECRET), false);
    assert.equal(line.includes("proxyuser"), false);

    assert.equal(
      redactProxySecrets(`connect failed for ${SECRET} and ${SECRET}`, authed),
      "connect failed for *** and ***"
    );
    assert.equal(redactProxySecrets("a.b and aXb", { server: "http://h:1", password: "a.b" }), "a.b and aXb".replaceAll("a.b", "***"));
    assert.equal(redactProxySecrets("unchanged", plain), "unchanged");
  });

  it("does not add a proxy parameter to any tool schema", () => {
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["browser_install", "fetch_url", "fetch_urls"]);
    for (const tool of tools) {
      const properties = tool.inputSchema?.properties ?? {};
      assert.equal(Object.hasOwn(properties, "proxy"), false, tool.name);
      assert.equal(JSON.stringify(tool.inputSchema).includes("FETCHER_PROXY"), false);
    }
  });

  it("still blocks internal URLs while a proxy is configured", () => {
    const previousProxy = process.env.FETCHER_PROXY;
    const previousAllow = process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
    process.env.FETCHER_PROXY = `http://user:${SECRET}@10.0.0.5:8888`;
    delete process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
    try {
      for (const url of [
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost/",
        "http://10.0.0.1/",
      ]) {
        assert.throws(
          () => validateUrlProtocol(url),
          (err) => err instanceof URLSecurityError
        );
      }
      assert.equal(validateUrlProtocol("https://example.com/"), "https://example.com/");
    } finally {
      if (previousProxy === undefined) delete process.env.FETCHER_PROXY;
      else process.env.FETCHER_PROXY = previousProxy;
      if (previousAllow === undefined) delete process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
      else process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS = previousAllow;
    }
  });
});

function runServer(env, { killAfterMs = 4000, killWhen } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["build/index.js"], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, killAfterMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (killWhen && killWhen(stderr)) child.kill("SIGKILL");
    });
    child.on("exit", (code) => finish(code));
    child.on("error", (err) => finish(err));
  });
}

describe("proxy startup", { concurrency: 1 }, () => {
  it("fails at startup on an invalid proxy and does not print the password", async () => {
    const result = await runServer(
      {
        FETCHER_PROXY: `socks5://proxyuser:${SECRET}@127.0.0.1:1080`,
        NO_PROXY: "",
        FETCHER_PROXY_BYPASS: "",
      },
      { killAfterMs: 8000 }
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /SOCKS5 authentication/);
    assert.equal(result.stderr.includes(SECRET), false);
    assert.equal(result.stderr.includes("proxyuser"), false);
    assert.equal(result.stdout.includes(SECRET), false);
  });

  it("prints the proxy at startup without credentials and keeps serving", async () => {
    const childEnv = {
      FETCHER_PROXY: `http://proxyuser:${SECRET}@127.0.0.1:8080`,
      FETCHER_PROXY_BYPASS: "localhost,.example.com",
    };
    const result = await runServer(childEnv, {
      killAfterMs: 8000,
      killWhen: (stderr) => stderr.includes("Using proxy"),
    });
    assert.equal(result.code, null);
    assert.match(
      result.stderr,
      /\[fetcher-mcp\] Using proxy http:\/\/127\.0\.0\.1:8080 \(authentication configured\); bypass localhost,\.example\.com/
    );
    assert.equal(result.stderr.includes(SECRET), false);
    assert.equal(result.stderr.includes("proxyuser"), false);
    assert.equal(result.stdout.includes(SECRET), false);
  });
});
