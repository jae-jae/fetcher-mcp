import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  URLSecurityError,
  validateUrlProtocol,
  validateUrlsProtocol,
} from "../build/utils/urlValidator.js";

const ORIGINAL_ALLOW = process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;

function setAllow(value) {
  if (value === undefined) {
    delete process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS;
  } else {
    process.env.FETCHER_MCP_ALLOW_PRIVATE_IPS = value;
  }
}

afterEach(() => {
  setAllow(ORIGINAL_ALLOW);
});

function expectAllowed(url) {
  assert.equal(validateUrlProtocol(url), url.trim());
}

function expectBlocked(url) {
  assert.throws(
    () => validateUrlProtocol(url),
    (err) => {
      assert.ok(
        err instanceof URLSecurityError,
        `expected URLSecurityError for ${url}, got ${err}`
      );
      return true;
    }
  );
}

describe("urlValidator", { concurrency: 1 }, () => {
  it("allows public hostnames and addresses", () => {
    setAllow(undefined);
    for (const url of [
      "https://example.com",
      "https://example.com/path?q=1",
      "http://example.com/",
      "https://iana.org/domains/example",
      "http://1.2.3.4/",
      "http://8.8.8.8/",
      "http://1.1.1.1/dns-query",
      "http://172.15.255.255/",
      "http://172.32.0.1/",
      "http://100.63.255.255/",
      "http://100.128.0.1/",
      "http://192.0.2.1/",
      "http://[2001:4860:4860::8888]/",
      "http://[2606:4700:4700::1111]/",
      "https://notlocalhost.example/",
      "https://localhost.example/",
      "https://foo.localhost.example/",
    ]) {
      expectAllowed(url);
    }
  });

  it("blocks private, loopback, link-local, and cloud-metadata addresses", () => {
    setAllow(undefined);
    for (const url of [
      "http://127.0.0.1/",
      "http://127.0.0.2/",
      "http://127.255.255.255/",
      "http://10.0.0.1/",
      "http://10.255.255.255/",
      "http://192.168.0.1/",
      "http://192.168.1.1:8080/latest/meta-data/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://169.254.169.254/",
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.1.1/",
      "http://0.0.0.0/",
      "http://0.1.2.3/",
      "http://100.64.0.1/",
      "http://100.127.255.255/",
      "http://192.0.0.1/",
      "http://198.18.0.1/",
      "http://198.19.255.255/",
      "http://224.0.0.1/",
      "http://240.0.0.1/",
      "http://255.255.255.255/",
      "http://[::1]/",
      "http://[::1]:8080/",
      "http://[::]/",
      "http://[fc00::1]/",
      "http://[fd12:3456:789a::1]/",
      "http://[fe80::1]/",
      "http://[febf::1]/",
    ]) {
      expectBlocked(url);
    }
  });

  it("blocks IPv4-mapped IPv6 forms of private addresses and allows public ones", () => {
    setAllow(undefined);
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:192.168.1.1]/",
      "http://[::ffff:172.16.0.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[0:0:0:0:0:ffff:127.0.0.1]/",
    ]) {
      expectBlocked(url);
    }
    for (const url of [
      "http://[::ffff:8.8.8.8]/",
      "http://[::ffff:1.1.1.1]/",
      "http://[::ffff:1.2.3.4]/",
    ]) {
      expectAllowed(url);
    }
  });

  it("blocks decimal, hex, octal, and short numeric IP forms", () => {
    setAllow(undefined);
    // WHATWG URL parsing canonicalizes these before the range check.
    for (const url of [
      "http://2130706433/", // decimal 127.0.0.1
      "http://0x7f000001/", // hex 127.0.0.1
      "http://0x7f.0.0.1/",
      "http://0177.0.0.1/", // octal 127.0.0.1
      "http://017700000001/", // octal dword
      "http://127.1/", // short form
      "http://127.0.1/",
      "http://10.1/", // short form 10.0.0.1
      "http://192.168.1/", // short form 192.168.0.1
      "http://0xA9FEA9FE/", // hex 169.254.169.254
      "http://025177524776/", // octal 169.254.169.254
      "http://0/", // 0.0.0.0
    ]) {
      expectBlocked(url);
    }
    // The same notations of a public address stay allowed.
    for (const url of [
      "http://134744072/", // decimal 8.8.8.8
      "http://0x08080808/",
      "http://010.010.010.010/", // octal 8.8.8.8
      "http://8.8.8/", // short form 8.8.0.8
    ]) {
      expectAllowed(url);
    }
  });

  it("blocks loopback and metadata hostnames, including a trailing DNS dot", () => {
    setAllow(undefined);
    for (const url of [
      "http://localhost/",
      "http://localhost:3000/",
      "http://LOCALHOST/",
      "http://localhost./",
      "http://foo.localhost/",
      "http://foo.localhost./",
      "http://localhost.localdomain/",
      "http://ip6-localhost/",
      "http://ip6-loopback/",
      "http://metadata.google.internal/",
      "http://metadata.google.internal./",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata/",
      "http://instance-data/",
    ]) {
      expectBlocked(url);
    }
  });

  it("still rejects non-http(s) protocols when private targets are allowed", () => {
    setAllow("true");
    for (const url of [
      "file:///etc/passwd",
      "ftp://127.0.0.1/",
      "javascript:alert(1)",
      "data:text/html,hi",
      "gopher://127.0.0.1/",
    ]) {
      expectBlocked(url);
    }
    expectBlocked("");
    expectBlocked("   ");
    expectBlocked("not a url");
    assert.throws(() => validateUrlProtocol(null), URLSecurityError);
  });

  it("allows blocked hosts and addresses when FETCHER_MCP_ALLOW_PRIVATE_IPS is enabled", () => {
    for (const flag of ["true", "TRUE", "yes", "1"]) {
      setAllow(flag);
      for (const url of [
        "http://127.0.0.1/",
        "http://10.1.2.3/",
        "http://192.168.1.1/",
        "http://172.16.5.5/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/",
        "http://2130706433/",
        "http://0x7f000001/",
        "http://0177.0.0.1/",
        "http://127.1/",
        "http://localhost/",
        "http://localhost./",
        "http://foo.localhost/",
        "http://metadata.google.internal/",
        "http://metadata/",
        "http://instance-data/",
        "https://example.com/",
      ]) {
        expectAllowed(url);
      }
    }

    for (const flag of ["false", "0", "no", ""]) {
      setAllow(flag);
      expectBlocked("http://127.0.0.1/");
      expectBlocked("http://localhost/");
      expectBlocked("http://metadata.google.internal/");
      expectAllowed("https://example.com/");
    }
  });

  it("rejects a batch that contains any blocked URL", () => {
    setAllow(undefined);
    assert.throws(
      () =>
        validateUrlsProtocol([
          "https://example.com/",
          "http://169.254.169.254/",
        ]),
      URLSecurityError
    );
    assert.deepEqual(
      validateUrlsProtocol(["https://example.com/", "http://1.1.1.1/"]),
      ["https://example.com/", "http://1.1.1.1/"]
    );
  });
});
