package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadWindowStateDefaultsToMaximised(t *testing.T) {
	path := filepath.Join(t.TempDir(), "window.json")
	want := windowState{Width: defaultWindowWidth, Height: defaultWindowHeight, Maximised: true}
	if got := loadWindowState(path); got != want {
		t.Fatalf("missing file: got %+v, want %+v", got, want)
	}
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadWindowState(path); got != want {
		t.Fatalf("corrupt file: got %+v, want %+v", got, want)
	}
}

func TestLoadWindowStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "window.json")
	saved := windowState{Width: 900, Height: 700, Maximised: false}
	if err := saveWindowState(path, saved); err != nil {
		t.Fatal(err)
	}
	if got := loadWindowState(path); got != saved {
		t.Fatalf("got %+v, want %+v", got, saved)
	}
}

func TestLoadWindowStateIgnoresTinySize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "window.json")
	if err := saveWindowState(path, windowState{Width: 10, Height: 10}); err != nil {
		t.Fatal(err)
	}
	want := windowState{Width: defaultWindowWidth, Height: defaultWindowHeight, Maximised: false}
	if got := loadWindowState(path); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

type fakeWindow struct {
	width, height int
	maximised     bool
	normal        bool
}

func stubWindowState(t *testing.T, w *fakeWindow) {
	t.Helper()
	size, isMaximised, isNormal := windowGetSize, windowIsMaximised, windowIsNormal
	windowGetSize = func(context.Context) (int, int) { return w.width, w.height }
	windowIsMaximised = func(context.Context) bool { return w.maximised }
	windowIsNormal = func(context.Context) bool { return w.normal }
	t.Cleanup(func() {
		windowGetSize, windowIsMaximised, windowIsNormal = size, isMaximised, isNormal
	})
}

func newWindowStateApp(t *testing.T) *App {
	t.Helper()
	path := filepath.Join(t.TempDir(), "window.json")
	app := &App{ctx: context.Background(), windowStatePath: path}
	app.window = loadWindowState(path)
	app.windowSaved = app.window
	app.closeToTray.Store(true)
	return app
}

// A resize followed by a maximise inside the save delay, then a quit: the size
// the resize left is what unmaximising goes back to next launch.
func TestResizeThenQuickMaximiseThenQuitKeepsResizedSize(t *testing.T) {
	w := &fakeWindow{width: 1000, height: 600, normal: true}
	stubWindowState(t, w)
	app := newWindowStateApp(t)

	app.windowResized()
	*w = fakeWindow{width: 1920, height: 1080, maximised: true}
	app.windowResized()
	app.quitting.Store(true)
	if app.beforeClose(app.ctx) {
		t.Fatal("quit was prevented")
	}

	want := windowState{Width: 1000, Height: 600, Maximised: true}
	if got := loadWindowState(app.windowStatePath); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestWindowResizedSavesOnceSettled(t *testing.T) {
	delay := windowSaveDelay
	windowSaveDelay = 20 * time.Millisecond
	t.Cleanup(func() { windowSaveDelay = delay })
	stubWindowState(t, &fakeWindow{width: 1000, height: 600, normal: true})
	app := newWindowStateApp(t)

	app.windowResized()
	if _, err := os.Stat(app.windowStatePath); !os.IsNotExist(err) {
		t.Fatalf("saved before settling: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	want := windowState{Width: 1000, Height: 600}
	for loadWindowState(app.windowStatePath) != want {
		if time.Now().After(deadline) {
			t.Fatalf("not saved after settling: got %+v", loadWindowState(app.windowStatePath))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRememberWindowStateSkipsMinimisedAndHidden(t *testing.T) {
	w := &fakeWindow{width: 1000, height: 600}
	stubWindowState(t, w)
	app := newWindowStateApp(t)

	app.rememberWindowState(app.ctx)
	if _, err := os.Stat(app.windowStatePath); !os.IsNotExist(err) {
		t.Fatalf("minimised window was saved: %v", err)
	}

	w.normal = true
	app.windowHidden.Store(true)
	app.rememberWindowState(app.ctx)
	if _, err := os.Stat(app.windowStatePath); !os.IsNotExist(err) {
		t.Fatalf("hidden window was saved: %v", err)
	}
}

func TestBeforeClose(t *testing.T) {
	if hideOnCloseNatively {
		t.Skip("the close button hides natively on this platform")
	}
	defer stubWindowCalls(t)()
	stubWindowState(t, &fakeWindow{width: 1000, height: 600, normal: true})

	app := newWindowStateApp(t)
	if !app.beforeClose(app.ctx) {
		t.Fatal("close-to-tray: close was not prevented")
	}
	if len(windowCalls) != 1 || windowCalls[0] != "hide" || !app.windowHidden.Load() {
		t.Fatalf("close-to-tray: window calls %v, hidden %v", windowCalls, app.windowHidden.Load())
	}

	app = newWindowStateApp(t)
	app.closeToTray.Store(false)
	if app.beforeClose(app.ctx) {
		t.Fatal("close-to-tray off: close was prevented")
	}

	app = newWindowStateApp(t)
	app.quitting.Store(true)
	if app.beforeClose(app.ctx) {
		t.Fatal("explicit quit: close was prevented")
	}
	if got := loadWindowState(app.windowStatePath); got.Maximised || got.Width != 1000 {
		t.Fatalf("explicit quit: state not saved, got %+v", got)
	}
}
