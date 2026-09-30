//go:build !linux || bindings

package main

// Only GTK's client-side decorations can drop the title bar and keep the frame.
const integratedTitlebarSupported = false

func installWindowChrome(integrated bool) {}

func setNativeTitlebarIntegrated(integrated bool) {}

func closeNativeWindow() {}

func nativeChromeSettings() (layout, doubleClick string) { return "", "" }

func nativeWindowTiled() bool { return false }
