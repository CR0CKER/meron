package main

import (
	"context"
	"os"
	"testing"
)

func stubWindowChrome(t *testing.T) *[]bool {
	t.Helper()
	applied := &[]bool{}
	apply, read, drawsFrame, live, was := applyNativeTitlebar, readChromeSettings, windowDrawsFrame, titlebarSwitchesLive, integratedTitlebar.Load()
	applyNativeTitlebar = func(integrated bool) { *applied = append(*applied, integrated) }
	readChromeSettings = func() (string, string) { return "menu:close", "toggle-maximize" }
	windowDrawsFrame = func() bool { return true }
	titlebarSwitchesLive = true
	t.Cleanup(func() {
		applyNativeTitlebar, readChromeSettings, windowDrawsFrame, titlebarSwitchesLive = apply, read, drawsFrame, live
		integratedTitlebar.Store(was)
	})
	integratedTitlebar.Store(false)
	return applied
}

// The choice is saved straight away (the next launch reads it before the
// window exists), as an opt-out from the default, and applied to the window
// only when it changes.
func TestWindowSetTitlebarSavesAndApplies(t *testing.T) {
	applied := stubWindowChrome(t)
	app := newWindowStateApp(t)

	for _, integrated := range []bool{true, true, false} {
		if _, err := app.windowSetTitlebar(map[string]any{"integrated": integrated}); err != nil {
			t.Fatal(err)
		}
		want := ""
		if !integrated {
			want = titlebarSystem
		}
		if got := loadWindowState(app.windowStatePath).Titlebar; got != want {
			t.Fatalf("integrated=%v: saved titlebar %q, want %q", integrated, got, want)
		}
	}
	want := []bool{}
	if integratedTitlebarSupported {
		want = []bool{true, false}
	}
	if len(*applied) != len(want) || (len(want) == 2 && ((*applied)[0] != true || (*applied)[1] != false)) {
		t.Fatalf("applied %v, want %v", *applied, want)
	}
}

func TestLoadWindowStateKeepsOnlyTheSystemTitlebarOptOut(t *testing.T) {
	app := newWindowStateApp(t)
	for saved, want := range map[string]string{"system": titlebarSystem, "integrated": "", "fancy": ""} {
		state := `{"width":900,"height":700,"titlebar":"` + saved + `"}`
		if err := os.WriteFile(app.windowStatePath, []byte(state), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := loadWindowState(app.windowStatePath).Titlebar; got != want {
			t.Fatalf("saved %q: titlebar %q, want %q", saved, got, want)
		}
	}
}

func TestWindowChromeReportsDesktopSettings(t *testing.T) {
	stubWindowChrome(t)
	integratedTitlebar.Store(true)
	app := newWindowStateApp(t)

	result, err := app.windowChrome()
	if err != nil {
		t.Fatal(err)
	}
	got := result.(map[string]any)
	if got["integrated"] != true || got["layout"] != "menu:close" || got["doubleClick"] != "toggle-maximize" {
		t.Fatalf("got %v", got)
	}
	if got["supported"] != integratedTitlebarSupported {
		t.Fatalf("supported = %v", got["supported"])
	}
}

// The close control goes through the window's own close, so close-to-tray
// applies to it exactly as to the title bar's close button.
func TestWindowControlsRouteToTheWindow(t *testing.T) {
	var calls []string
	minimise, toggle, close := windowMinimise, windowToggleMaximise, windowClose
	windowMinimise = func(context.Context) { calls = append(calls, "minimise") }
	windowToggleMaximise = func(context.Context) { calls = append(calls, "toggleMaximise") }
	windowClose = func() { calls = append(calls, "close") }
	t.Cleanup(func() { windowMinimise, windowToggleMaximise, windowClose = minimise, toggle, close })
	app := newWindowStateApp(t)

	for _, command := range []string{"window.minimise", "window.toggleMaximise", "window.close"} {
		if _, err := app.windowControl(command); err != nil {
			t.Fatal(err)
		}
	}
	if len(calls) != 3 || calls[0] != "minimise" || calls[1] != "toggleMaximise" || calls[2] != "close" {
		t.Fatalf("calls %v", calls)
	}
}

// Where the desktop draws the frame (KDE Plasma, X11 window managers), the
// option isn't offered and can't be switched on.
func TestIntegratedTitlebarNotOfferedOnADesktopFrame(t *testing.T) {
	applied := stubWindowChrome(t)
	windowDrawsFrame = func() bool { return false }
	integratedTitlebar.Store(true)
	app := newWindowStateApp(t)

	result, err := app.windowChrome()
	if err != nil {
		t.Fatal(err)
	}
	if got := result.(map[string]any); got["supported"] != false || got["integrated"] != false {
		t.Fatalf("got %v", got)
	}
	if _, err := app.windowSetTitlebar(map[string]any{"integrated": true}); err != nil {
		t.Fatal(err)
	}
	if got := loadWindowState(app.windowStatePath).Titlebar; got != "" {
		t.Fatalf("saved titlebar %q, want empty", got)
	}
	if len(*applied) != 1 || (*applied)[0] != false {
		t.Fatalf("applied %v, want [false]", *applied)
	}
}

// A saved choice read at startup, before the window shows whether GTK draws
// the frame, is not in effect where the desktop draws it.
func TestIntegratedTitlebarActiveNeedsAGtkFrame(t *testing.T) {
	stubWindowChrome(t)
	integratedTitlebar.Store(true)
	if !integratedTitlebarActive() {
		t.Fatal("GTK frame: want active")
	}
	windowDrawsFrame = func() bool { return false }
	if integratedTitlebarActive() {
		t.Fatal("desktop frame: want inactive")
	}
}

// Where the switch can't apply to the live window (Windows' frameless option
// is fixed at creation), the choice is saved and reported as wanted, and the
// title bar in effect stays until the next launch.
func TestWindowSetTitlebarWaitsForRestartWhereNotLive(t *testing.T) {
	applied := stubWindowChrome(t)
	titlebarSwitchesLive = false
	integratedTitlebar.Store(true)
	app := newWindowStateApp(t)

	if _, err := app.windowSetTitlebar(map[string]any{"integrated": false}); err != nil {
		t.Fatal(err)
	}
	if got := loadWindowState(app.windowStatePath).Titlebar; got != titlebarSystem {
		t.Fatalf("saved titlebar %q, want %q", got, titlebarSystem)
	}
	if len(*applied) != 0 || !integratedTitlebar.Load() {
		t.Fatalf("applied %v, integrated %v: want nothing until restart", *applied, integratedTitlebar.Load())
	}
	if !integratedTitlebarSupported {
		return
	}
	result, err := app.windowChrome()
	if err != nil {
		t.Fatal(err)
	}
	if got := result.(map[string]any); got["integrated"] != true || got["wanted"] != false {
		t.Fatalf("got %v, want integrated now and system wanted", got)
	}
}
