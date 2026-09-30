package main

import (
	"sync/atomic"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// titlebarIntegrated is windowState.Titlebar for the integrated title bar: no
// GTK title bar, the page's headers take its place and draw the window
// controls. Anything else is the system title bar.
const titlebarIntegrated = "integrated"

// integratedTitlebar is whether the integrated title bar is in effect now.
var integratedTitlebar atomic.Bool

// Window controls go through these vars so the commands can be tested.
var (
	windowMinimise       = wailsRuntime.WindowMinimise
	windowToggleMaximise = wailsRuntime.WindowToggleMaximise
	windowClose          = closeNativeWindow
	windowIsTiled        = nativeWindowTiled
	applyNativeTitlebar  = setNativeTitlebarIntegrated
	readChromeSettings   = nativeChromeSettings
)

// windowChrome tells the frontend how to draw the title bar: whether it is
// integrated, and the desktop's button layout and double-click action, which
// it follows rather than offering its own settings.
func (a *App) windowChrome() (any, error) {
	layout, doubleClick := readChromeSettings()
	return map[string]any{
		"supported":   integratedTitlebarSupported,
		"integrated":  integratedTitlebar.Load(),
		"layout":      layout,
		"doubleClick": doubleClick,
	}, nil
}

// windowSetTitlebar switches between the system and the integrated title bar
// and remembers the choice in window.json, which is read before the window is
// created on the next launch.
func (a *App) windowSetTitlebar(payload map[string]any) (any, error) {
	integrated, _ := payload["integrated"].(bool)
	integrated = integrated && integratedTitlebarSupported
	a.windowMu.Lock()
	a.window.Titlebar = ""
	if integrated {
		a.window.Titlebar = titlebarIntegrated
	}
	a.windowMu.Unlock()
	a.flushWindowState()
	if integratedTitlebar.Swap(integrated) != integrated {
		applyNativeTitlebar(integrated)
		refreshNativeTitlebarCss()
	}
	return map[string]any{"ok": true, "integrated": integrated}, nil
}

func (a *App) windowControl(command string) (any, error) {
	ctx := a.runtimeContext()
	switch command {
	case "window.minimise":
		if ctx != nil {
			windowMinimise(ctx)
		}
	case "window.toggleMaximise":
		if ctx != nil {
			windowToggleMaximise(ctx)
		}
	case "window.close":
		windowClose()
	}
	return map[string]any{"ok": true}, nil
}
