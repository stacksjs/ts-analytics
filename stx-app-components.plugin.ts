// Registers the app's own `resources/components` tree as a component source.
//
// Why this exists: stx 0.2.72 searches the configured `componentsDir` FLAT —
// only its top level — so subdirectory kebab tags never resolve. Nearly all of
// this app's components live in subdirs (`dashboard/`, `tabs/`), e.g.
// `<site-selector>` → `resources/components/dashboard/SiteSelector.stx`. Without
// this, the whole dashboard renders "Error loading component: ENOENT ...".
//
// Plugin component dirs, unlike `componentsDir`, ARE walked recursively by the
// resolver (the same mechanism that lets `@stacksjs/components/src/ui/**`
// resolve), so pointing one at `resources/components` makes the subdir tags
// resolve again. See stx-components.plugin.ts for the library equivalent.
export default {
  name: 'app-components',
  components: 'resources/components',
}
