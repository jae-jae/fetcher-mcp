<div align="center">
  <img src="https://raw.githubusercontent.com/jae-jae/fetcher-mcp/refs/heads/main/icon.svg" width="100" height="100" alt="Fetcher MCP Icon" />
</div>

[中文](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=zh) |
[Deutsch](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=de) |
[Español](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=es) |
[français](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=fr) |
[日本語](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ja) |
[한국어](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ko) |
[Português](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=pt) |
[Русский](https://www.readme-i18n.com/jae-jae/fetcher-mcp?lang=ru)

# Fetcher MCP

MCP server for fetch web page content using Playwright headless browser.

> 🌟 **Recommended**: [OllaMan](https://ollaman.com/) - Powerful Ollama AI Model Manager.

## Advantages

- **JavaScript Support**: Unlike traditional web scrapers, Fetcher MCP uses Playwright to execute JavaScript, making it capable of handling dynamic web content and modern web applications.

- **Intelligent Content Extraction**: Built-in Readability algorithm automatically extracts the main content from web pages, removing ads, navigation, and other non-essential elements.

- **Flexible Output Format**: Supports both HTML and Markdown output formats, making it easy to integrate with various downstream applications.

- **Parallel Processing**: The `fetch_urls` tool enables concurrent fetching of multiple URLs, significantly improving efficiency for batch operations.

- **Resource Optimization**: Automatically blocks unnecessary resources (images, stylesheets, fonts, media) to reduce bandwidth usage and improve performance.

- **Robust Error Handling**: Comprehensive error handling and logging ensure reliable operation even when dealing with problematic web pages.

- **Configurable Parameters**: Fine-grained control over timeouts, content extraction, and output formatting to suit different use cases.

## Quick Start

Run directly with npx:

```bash
npx -y fetcher-mcp
```

First time setup - install the required browser by running the following command in your terminal:

```bash
npx playwright install chromium
```

### HTTP and SSE Transport

Use the `--transport=http` parameter to start both Streamable HTTP endpoint and SSE endpoint services simultaneously:

```bash
npx -y fetcher-mcp --log --transport=http --host=0.0.0.0 --port=3000
```

After startup, the server provides the following endpoints:

- `/mcp` - Streamable HTTP endpoint (modern MCP protocol)
- `/sse` - SSE endpoint (legacy MCP protocol)
- `/openapi.json` - OpenAPI 3.1 specification for the REST tool API (HTTP mode only)
- `POST /tools/{name}` - REST endpoint for each tool (`fetch_url`, `fetch_urls`, `browser_install`)

Clients can choose which method to connect based on their needs. Stdio mode does not serve the HTTP, SSE, or REST routes.

> **No authentication.** `/openapi.json` and `POST /tools/{name}` do not authenticate callers. That includes `browser_install`, which installs a browser on the host. Use these endpoints only on localhost or a trusted internal network. Do not expose them on an untrusted network (for example by binding `--host=0.0.0.0` where the port is reachable from outside that network).

### Debug Mode

Run with the `--debug` option to show the browser window for debugging:

```bash
npx -y fetcher-mcp --debug
```

## Configuration MCP

Configure this MCP server in Claude Desktop:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fetcher": {
      "command": "npx",
      "args": ["-y", "fetcher-mcp"],
      "env": {
        "FETCHER_PROXY": "http://proxy.example.com:8080"
      }
    }
  }
}
```

## Proxy

Send browser traffic through an HTTP, HTTPS, or SOCKS5 proxy by setting `FETCHER_PROXY`. The proxy is process configuration. `fetch_url`, `fetch_urls`, `browser_install`, and the REST `POST /tools/{name}` endpoints do not accept a proxy parameter, so a caller or a prompt cannot select a different proxy.

```bash
FETCHER_PROXY=http://proxy.example.com:8080 npx -y fetcher-mcp
```

HTTP and HTTPS proxies may include a username and password. URL-encode reserved characters (`@` as `%40`, `:` as `%3A`, and a literal `%` as `%25`):

```bash
FETCHER_PROXY='http://user:p%40ssword@proxy.example.com:3128' npx -y fetcher-mcp
```

| Variable | Description |
| --- | --- |
| `FETCHER_PROXY` | `http://host:port`, `https://host:port`, or `socks5://host:port`. Optional `username:password@` for HTTP and HTTPS. Unset or blank means a direct connection, the same behavior as when this option is not used. |
| `FETCHER_PROXY_BYPASS` | Optional hosts Chromium connects to directly (Playwright's `bypass`). Comma- or space-separated. When this variable is set, including to an empty value, it replaces `NO_PROXY` and `no_proxy`. |
| `NO_PROXY`, `no_proxy` | Bypass list used only when `FETCHER_PROXY_BYPASS` is unset. Ignored when `FETCHER_PROXY` is unset. |

Bypass entries may be hostnames (`example.com`), domain suffixes (`.example.com` or `*.example.com`), IP addresses, CIDR ranges (`10.0.0.0/8`), `*`, `<local>`, or `<-loopback>`. A trailing `:port` on a hostname or IPv4 address is removed, because Chromium matches hosts rather than host-port pairs.

Chromium does not support SOCKS5 username/password authentication. Playwright rejects that combination (`Browser does not support socks5 proxy authentication`) instead of opening the connection without the credentials. fetcher-mcp rejects `socks5://user:password@host:port` at startup, before it listens or launches a browser. For a proxy that requires authentication, use `http://` or `https://`. Alternatively, point `FETCHER_PROXY` at a local SOCKS5 listener that does not require authentication and that holds the upstream credentials itself. Unauthenticated `socks5://host:port` is supported. Playwright sends target hostnames to that proxy for DNS (remote resolution) rather than resolving them locally.

An invalid `FETCHER_PROXY` stops the process at startup. The stderr message describes the problem and does not include the password. The process does not fall back to a direct connection. Checked failures include an unknown scheme, a missing port, a path, query, or fragment, invalid percent-encoding, a password without a username, and SOCKS5 credentials.

The proxy address itself may be a loopback or private address, for example `http://127.0.0.1:8888`. The request URL validator does not apply to it, because only the operator can set it. Startup prints one stderr line, `[fetcher-mcp] Using proxy http://host:port`, and adds `(authentication configured)` when a username is present. The username and password are not printed. Playwright supplies the password to Chromium as proxy authentication, not as part of the `--proxy-server` command-line flag. On Chromium, Playwright also installs those credentials as HTTP authentication with no origin limit, so a page that returns 401 can receive the proxy username and password. Prefer an unauthenticated proxy when the fetched pages are untrusted.

### Proxy and internal-address blocking

`fetch_url` and `fetch_urls` run the same URL checks as a direct connection before a browser is launched and before navigation. A configured proxy does not skip those checks. Targets such as `127.0.0.1`, `localhost`, `169.254.169.254`, other private and reserved addresses, and the blocked hostnames are still rejected when `FETCHER_PROXY` is set, including when the bypass list would have contacted that host directly.

With an HTTP or HTTPS proxy, Chromium forwards the target URL to the proxy and the proxy resolves DNS. The browser resolves only the proxy host. With SOCKS5, Playwright forces remote DNS, so the proxy resolves the target hostname and the browser resolves only the proxy host. A bypass entry is the exception: Chromium connects to that host directly and resolves it locally. Playwright also adds `<-loopback>`, which disables Chromium's implicit rule that skips the proxy for loopback, so loopback targets use the proxy unless the bypass list names them. Listing them in the bypass list still does not fetch them: the URL check rejects those targets before navigation.

`FETCHER_MCP_ALLOW_PRIVATE_IPS=true` still turns the block off, with or without a proxy. Requests that pass the check then use the proxy unless they match the bypass list.

Two gaps already exist without a proxy, and a proxy changes which network they reach. Hostnames that are not on the block list are not looked up before the fetch, and redirects are not checked again. Through a proxy, a name that resolves to a private address, or a redirect to an address such as `169.254.169.254`, is contacted from the proxy's network (for example the proxy host's link-local metadata address) rather than from the machine running fetcher-mcp. A bypass entry for that host sends the connection directly from the fetcher host instead.

## Docker Deployment

### Running with Docker

```bash
docker run -p 3000:3000 ghcr.io/jae-jae/fetcher-mcp:latest
```

### Deploying with Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: "3.8"

services:
  fetcher-mcp:
    image: ghcr.io/jae-jae/fetcher-mcp:latest
    container_name: fetcher-mcp
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      # - FETCHER_PROXY=http://proxy.example.com:8080
      # - FETCHER_PROXY_BYPASS=localhost,.internal.example
    # Using host network mode on Linux hosts can improve browser access efficiency
    # network_mode: "host"
    volumes:
      # For Playwright, may need to share certain system paths
      - /tmp:/tmp
    # Health check
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Then run:

```bash
docker-compose up -d
```

## Features

- `fetch_url` - Retrieve web page content from a specified URL

  - Uses Playwright headless browser to parse JavaScript
  - Supports intelligent extraction of main content and conversion to Markdown
  - Supports the following parameters:
    - `url`: The URL of the web page to fetch (required parameter)
    - `timeout`: Page loading timeout in milliseconds, default is 30000 (30 seconds)
    - `waitUntil`: Specifies when navigation is considered complete, options: 'load', 'domcontentloaded', 'networkidle', 'commit', default is 'load'
    - `extractContent`: Whether to intelligently extract the main content, default is true
    - `maxLength`: Maximum length of returned content (in characters), default is no limit
    - `returnHtml`: Whether to return HTML content instead of Markdown, default is false
    - `returnText`: Whether to return plain text (`innerText` of the page body) instead of Markdown. Skips Readability extraction and Markdown conversion. Default is false. When omitted, the response is the same Markdown output as before
    - `waitForNavigation`: Whether to wait for additional navigation after initial page load (useful for sites with anti-bot verification), default is false
    - `navigationTimeout`: Maximum time to wait for additional navigation in milliseconds, default is 10000 (10 seconds)
    - `disableMedia`: Whether to disable media resources (images, stylesheets, fonts, media), default is true
    - `debug`: Whether to enable debug mode (showing browser window), overrides the --debug command line flag if specified

- `fetch_urls` - Batch retrieve web page content from multiple URLs in parallel
  - Uses multi-tab parallel fetching for improved performance
  - Returns combined results with clear separation between webpages
  - Supports the following parameters:
    - `urls`: Array of URLs to fetch (required parameter)
    - Other parameters are the same as `fetch_url`

- `browser_install` - Install Playwright Chromium browser binary automatically

  - Installs required Chromium browser binary when not available
  - Automatically suggested when browser installation errors occur
  - Supports the following parameters:
    - `withDeps`: Install system dependencies required by Chromium browser, default is false
    - `force`: Force installation even if Chromium is already installed, default is false

## Tips

### Handling Special Website Scenarios

#### Dealing with Anti-Crawler Mechanisms

- **Wait for Complete Loading**: For websites using CAPTCHA, redirects, or other verification mechanisms, include in your prompt:

  ```
  Please wait for the page to fully load
  ```

  This will use the `waitForNavigation: true` parameter.

- **Increase Timeout Duration**: For websites that load slowly:
  ```
  Please set the page loading timeout to 60 seconds
  ```
  This adjusts both `timeout` and `navigationTimeout` parameters accordingly.

#### Content Retrieval Adjustments

- **Preserve Original HTML Structure**: When content extraction might fail:

  ```
  Please preserve the original HTML content
  ```

  Sets `extractContent: false` and `returnHtml: true`.

- **Fetch Complete Page Content**: When extracted content is too limited:

  ```
  Please fetch the complete webpage content instead of just the main content
  ```

  Sets `extractContent: false`.

- **Return Content as HTML**: When HTML format is needed instead of default Markdown:
  ```
  Please return the content in HTML format
  ```
  Sets `returnHtml: true`.

- **Return Visible Text Only**: When Markdown markup is unnecessary:
  ```
  Please return only the visible text
  ```
  Sets `returnText: true`.

### Request targets

`fetch_url` and `fetch_urls` accept only `http:` and `https:` URLs. Loopback, private, link-local, and cloud-metadata targets are blocked by default, including numeric IP spellings (decimal, hex, octal, and short forms) and names such as `localhost` and `metadata.google.internal`. Set `FETCHER_MCP_ALLOW_PRIVATE_IPS=true` to allow those targets, including blocked hostnames. A proxy set with `FETCHER_PROXY` does not skip these checks. See [Proxy](#proxy).

A hostname that is not itself on the block list is not looked up before the browser fetches it, and redirects are not checked again. A name that resolves to a private address, or a redirect onto an internal address, can still reach that address.

### Debugging and Authentication

#### Enabling Debug Mode

- **Dynamic Debug Activation**: To display the browser window during a specific fetch operation:
  ```
  Please enable debug mode for this fetch operation
  ```
  This sets `debug: true` even if the server was started without the `--debug` flag.

#### Using Custom Cookies for Authentication

- **Manual Login**: To login using your own credentials:

  ```
  Please run in debug mode so I can manually log in to the website
  ```

  Sets `debug: true` or uses the `--debug` flag, keeping the browser window open for manual login.

- **Interacting with Debug Browser**: When debug mode is enabled:

  1. The browser window remains open
  2. You can manually log into the website using your credentials
  3. After login is complete, content will be fetched with your authenticated session

- **Enable Debug for Specific Requests**: Even if the server is already running, you can enable debug mode for a specific request:
  ```
  Please enable debug mode for this authentication step
  ```
  Sets `debug: true` for this specific request only, opening the browser window for manual login.

## Development

### Install Dependencies

```bash
npm install
```

### Install Playwright Browser

Install the browsers needed for Playwright:

```bash
npm run install-browser
```

### Build the Server

```bash
npm run build
```

## Debugging

Use MCP Inspector for debugging:

```bash
npm run inspector
```

You can also enable visible browser mode for debugging:

```bash
node build/index.js --debug
```

## Related Projects

- [g-search-mcp](https://github.com/jae-jae/g-search-mcp): A powerful MCP server for Google search that enables parallel searching with multiple keywords simultaneously. Perfect for batch search operations and data collection.

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)

[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")
