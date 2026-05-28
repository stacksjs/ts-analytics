// Registers @stacksjs/components as a component source for stx.
// stx resolves component tags (<Button>, <Spinner>, ...) recursively within
// this directory. We point at the package's source .stx templates (the dist/ui
// build ships type-declaration stubs, not renderable templates).
export default {
  name: 'stacksjs-components',
  components: 'node_modules/@stacksjs/components/src/ui',
}
