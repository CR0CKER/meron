//go:build linux && !bindings

package main

// A file of its own: a cgo file with //export may only declare in its preamble,
// and window_chrome_linux.go defines its C there.

import "C"

import wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

//export goWindowStateChanged
func goWindowStateChanged() {
	if globalApp == nil || globalApp.ctx == nil {
		return
	}
	// Called on the GTK thread; the event emit must not block it.
	go wailsRuntime.EventsEmit(globalApp.ctx, "window.stateChanged")
}
