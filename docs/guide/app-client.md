---
title: App Client
description: Record events from a native or desktop app with a fetch-only client, and accept them on the server with an explicit bot-filter bypass.
---

# App Client

`createAppClient` records screens and events from a native or desktop app: the Bun or Node agent behind a webview, a tray app, a CLI. It has no DOM, stores nothing, uses `fetch`, and has no dependencies.

```ts
import { createAppClient } from '@ts-analytics/tracking/app'

const analytics = createAppClient({
  endpoint: 'https://analytics.example.com',
  siteId: 'my-app',
  installId: settings.installId, // a UUID your app created and stored
  appVersion: '1.4.2',
  appName: 'Fettler',
  os: { name: 'macOS', version: '15.1' },
  enabled: settings.shareUsage,
})

await analytics.screen('Settings')
await analytics.track('Export', { format: 'csv' })
```

It is also exported from the package root and from `@ts-analytics/tracking/tracking`.

## Why apps need their own client

A server that filters bots with `isBot` drops these requests, correctly: `Bun/`, `undici`, `node-fetch` and Electron are scripts when they show up on a website. And a cookieless visitor id built from the IP and User-Agent under a daily salt turns one install into a new visitor every day.

So an app request has to say what it is, and the server has to decide whether to believe it. The client does the first half. The second half is the server's, described under [Accepting app events](#accepting-app-events).

## Options

| Option | Type | Purpose |
| --- | --- | --- |
| `endpoint` | `string` | The analytics host, or its full `/collect` URL |
| `siteId` | `string` | The site to record under |
| `installId` | `string` | A UUID the app generated and keeps |
| `appVersion` | `string` | At most 32 characters, no spaces |
| `appName` | `string` | Optional display name |
| `os` | `string \| { name, version? }` | Optional. The name defaults to `process.platform` mapped to `macOS`, `Windows` or `Linux`. The version is never guessed |
| `enabled` | `boolean` | The opt-in switch. Default `true`. Nothing is sent while `false` |
| `environment` | `string` | Optional deployment label |
| `batch` | `boolean \| { maxSize?, flushInterval? }` | Queue events. Defaults: 20 events or 5 seconds |
| `timeout` | `number` | Milliseconds before one request is abandoned. Default `10000` |
| `userAgent` | `string \| false` | Override the declared User-Agent, or `false` to leave the runtime's |
| `fetch` | `typeof fetch` | The `fetch` to use |
| `onError` | `(error) => void` | Told why an event was not delivered |

## Methods

| Method | Returns | Purpose |
| --- | --- | --- |
| `screen(name)` | `Promise<boolean>` | A screen view. `screen('Settings')` is the path `/Settings` |
| `pageview(name)` | `Promise<boolean>` | The same as `screen` |
| `track(name, properties?)` | `Promise<boolean>` | A named event, attributed to the current screen |
| `flush()` | `Promise<void>` | Send everything queued. Await it before the app exits |
| `setEnabled(enabled)` | `void` | Turn sending on or off. Turning it off drops the queue |
| `setInstallId(id)` | `void` | Swap the install id after the user resets it |
| `enabled` | `boolean` | Opted in and correctly configured |
| `userAgent` | `string \| null` | The User-Agent being sent |

## It never throws

Every method resolves. The result is `false` when the event was not delivered: no network, a 4xx or 5xx, a `fetch` that throws, properties that cannot be serialized, or a bad option such as an install id that is not a UUID. `onError` receives the reason, including the server's own message for a refusal. Nothing is retried.

`createAppClient` itself does not throw either. With a bad option it returns a client whose `enabled` is `false`.

## The install id

The app owns it. Generate it once with `crypto.randomUUID()`, keep it with the app's settings, and pass it in. The client never creates one and never writes anything to disk, because where the id lives and when it is reset are product decisions.

A server that follows the recipe below never stores the id, only a per-site hash of it. To let a user reset their identity, delete the stored id, generate a new one and call `setInstallId`.

## What is sent

One request per event:

```http
POST /collect
Content-Type: application/json
User-Agent: Fettler/1.4.2 (macOS 15.1) ts-analytics-app/0.1.20

{
  "s": "my-app",
  "e": "Export",
  "u": "app://fettler/Settings",
  "p": { "format": "csv" },
  "app": {
    "id": "3f2b8c1e-9a4d-4e7b-b1c2-0d9e8f7a6b5c",
    "version": "1.4.2",
    "name": "Fettler",
    "os": "macOS",
    "osVersion": "15.1"
  }
}
```

`e` is `pageview` for a screen. `p` is present only when properties were given, and `name`, `os` and `osVersion` only when known. With `batch`, events are queued and then sent in order, still one request each.

A webview cannot set `User-Agent`, and that is fine: the header is a label for logs, not what gets the event accepted.

## Accepting app events

`isBot` is unchanged and still drops every HTTP library. A server that wants app events uses `isBotRequest`, which is `isBot` plus one explicit way past it:

```ts
import { isBotRequest } from '@ts-analytics/tracking'

const declared = body.app != null
// Decided from YOUR records: did this site's owner turn app mode on?
const siteAcceptsApps = declared && await siteHasAppMode(body.s)

if (declared && !siteAcceptsApps)
  return new Response(JSON.stringify({ error: 'App mode is not enabled for this site' }), { status: 403 })

if (isBotRequest(userAgent, { appMode: siteAcceptsApps }))
  return new Response(null, { status: 204 })
```

Pass `appMode: true` only when the request declared an app **and** the site it names accepts app events according to your own data. Setting it from the User-Agent, a header or the body alone gives every bot the same pass. `isAppClientUserAgent(ua)` recognises the client's User-Agent token for logging and is not a credential.

For the visitor id, do not hash the IP and User-Agent. Hash the install id with a secret that belongs to the site and does not rotate, for example `HMAC-SHA256(siteSecret, siteId + '|' + installId)`. That keeps one install as one visitor across days without storing the id, and makes ids from two sites impossible to join. `isValidInstallId(value)` checks the format.

This library's bundled server does not implement app mode. [AnalyticsHQ](https://analyticshq.org) does, and its ingest is the reference for the recipe above.
