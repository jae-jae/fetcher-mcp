# Quality Hardening Design

## Problem

Adopted MCP server with zero safety nets: no tests, no linter, `any` types everywhere, resource leaks in production, unvalidated tool inputs. Two goals: runtime reliability and developer confidence.

## Approach: Zod First + Resource Leak Fixes + Tooling

Prioritized by bang-for-buck. Zod at the input boundary is the highest-leverage single change, then fix actual bugs, then add mechanical safety nets.

## Section 1: Zod Input Validation

Replace manual arg parsing in tool handlers with Zod schemas.

**Current pattern** (duplicated in fetchUrl and fetchUrls):
```ts
const options: FetchOptions = {
  timeout: Number(args?.timeout) || 30000,
  waitUntil: String(args?.waitUntil || "load") as "load" | ...,
  extractContent: args?.extractContent !== false,
};
```

**New pattern**: Single `FetchOptionsSchema` in `src/types/index.ts` using `z.object()` with defaults. `FetchOptions` type inferred via `z.infer<>`. Tool handlers call `FetchOptionsSchema.parse(args)` — one line replaces ~10 lines of manual coercion per handler.

URL validation stays separate (has side effects). Each tool gets a small wrapper schema for its required field (`url: z.string().url()` / `urls: z.array(z.string().url())`).

**Files changed:**
- `src/types/index.ts` — schema replaces interface
- `src/tools/fetchUrl.ts` — delete manual parsing, use schema
- `src/tools/fetchUrls.ts` — same
- `src/tools/browserInstall.ts` — small schema for withDeps/force
- `package.json` — add zod

## Section 2: Resource Leak Fixes

### fetchUrls partial failure leak
`Promise.all` creates N pages in parallel. If one fails after others succeed, pages that haven't entered their try/finally leak. Fix: use `Promise.allSettled`, return error results for failed URLs.

### BrowserContext never closed
`createContext()` creates a BrowserContext but `cleanup()` only closes page and browser. Fix: close context explicitly in tool handler finally blocks.

### StdioTransportProvider type mismatch
Uncommitted changes made `TransportProvider.connect()` accept `Server | ServerFactory`, but stdio still only accepts `Server`. Fix: accept the union, resolve it (call factory if function, use directly if not).

**Files changed:**
- `src/tools/fetchUrls.ts` — Promise.allSettled, error results
- `src/tools/fetchUrl.ts` — close context in finally
- `src/transports/stdio.ts` — accept Server | ServerFactory

## Section 3: ESLint + TypeScript Strictness

Add ESLint with `@typescript-eslint`, minimal config:
- `no-explicit-any`: warn (ratchet to error after cleanup)
- `no-unused-vars`: error
- `noUncheckedIndexedAccess: true` in tsconfig

**`any` kill list:**
- `src/tools/fetchUrl.ts:79` — `args: any` → Zod-typed
- `src/tools/fetchUrls.ts:81` — same
- `src/tools/browserInstall.ts:40` — same
- `src/transports/http.ts:22` — `server: any` → `http.Server`
- `src/services/webContentProcessor.ts:18` — `page: any` → `Page`
- `src/server.ts:46` — handler args typed via tool signature

**New scripts:**
- `npm run lint` — `eslint src/`
- `npm run check` — `tsc --noEmit && eslint src/`
