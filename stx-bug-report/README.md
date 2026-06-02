# Bug: `{{ }}` interpolation inside `x-for` renders empty inside a component

`{{ loopVar.prop }}` text interpolation inside an `x-for` loop renders **empty**
when the loop lives inside a hydrated (kebab-tag) **component**. The same loop
works at the **view** level, and `x-text="loopVar.prop"` works in both. The loop
itself iterates the correct number of times — only the `{{ }}` text nodes are blank.

## Environment

- `@stacksjs/stx` **0.2.70**
- `bun-plugin-stx` **0.2.70** (dev server: `bun-plugin-stx/serve`)
- Bun 1.3.13, macOS (darwin)

## Reproduction

Two files (in this folder). Put `ReproList.stx` in your `partialsDir`
(components) and `xfor-repro.stx` in your `patterns` (views), then load the view.

**`ReproList.stx`** (a component):

```stx
<script client>
const items = state([])
onMount(() => {
  setTimeout(() => items.set([{ name: 'CompX' }, { name: 'CompY' }]), 60)
})
</script>

<ul id="repro-list">
  <li x-for="it in items" class="interp">{{ it.name || 'none' }}</li>
  <li x-for="it in items" class="xt" x-text="it.name || 'none'"></li>
</ul>
```

**`xfor-repro.stx`** (a view that also does the same loop inline):

```stx
@section('content')
<script client>
const viewItems = state([])
onMount(() => {
  setTimeout(() => viewItems.set([{ name: 'ViewX' }, { name: 'ViewY' }]), 60)
})
</script>

<ul id="view-interp"><li x-for="it in viewItems">{{ it.name || 'none' }}</li></ul>
<repro-list />
@endsection
```

## Expected vs actual

| where | directive | result |
|---|---|---|
| view-level `x-for` | `{{ it.name }}` | ✅ `ViewX`, `ViewY` |
| component `x-for`  | `{{ it.name }}` | ❌ **empty**, `empty` |
| component `x-for`  | `x-text="it.name"` | ✅ `CompX`, `CompY` |

Rendered component HTML (note the loop ran — 2 `<li>` — but the `{{ }}` nodes are empty):

```html
<li class="interp"></li>
<li class="interp"></li>
<li class="xt">CompX</li>
<li class="xt">CompY</li>
```

So `x-for` binds and iterates, but the per-item text-interpolation scope is not
applied to `{{ }}` nodes inside a component (it is at the view level). The loop
variable is correctly available to `x-text` and to attribute directives
(`@click="pick(it.id)"` works), just not to `{{ }}`.

## Workaround

Use `x-text` (or bind via an attribute) for loop-variable values inside components:
`<span x-text="it.name"></span>` instead of `<span>{{ it.name }}</span>`.

## Possibly related (same build pipeline)

In the served/inlined runtime, regex **backslashes are stripped** from string-literal
regexes. Two we hit:
- the `x-for`/`:for` trailing-`()` retry regex ships as `new RegExp("(s*)s*$")`
  instead of `\(\s*\)\s*$`, so the retry that recovers `signal()` list expressions
  never fires (have to use bare signal refs in `:for`);
- the `inScope` first-identifier regex ships as `[A-Za-z_$][w$]*` instead of
  `[\w$]*`, so the `[STX] :for ... inScope=false root=<char>` diagnostic only
  captures the first character of the identifier (misleading).

These may be unrelated to the interpolation-scope bug, but both point at the build
mangling string contents (cf. the separate footgun where a literal `</script>` /
`<style>` / `<script>` in component source — even in a comment — corrupts block parsing).
