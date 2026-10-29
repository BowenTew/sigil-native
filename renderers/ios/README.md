# @sigil-native/ios — SwiftUI renderer (coming)

Will contain `Sources/SigilUI`: the SigilOps applier, the SwiftUI component
catalog, and the JavaScriptCore bridge that runs `@sigil-native/runtime`'s
`dist/runtime.global.js` (iife global build) — the same runtime, no WebView.

The reference implementation already exists in the dil-demo prototype
(`ios/DilChat`) and will be ported here.
