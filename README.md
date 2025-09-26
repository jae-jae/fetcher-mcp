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

Clients can choose which method to connect based on their needs.

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
      "args": ["-y", "fetcher-mcp"]
    }
  }
}
```

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
