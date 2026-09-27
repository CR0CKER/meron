//go:build !linux

package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/options"
)

// startWindowState maximises the window as it opens when the last session
// ended maximised. Windows and macOS keep a sane restore geometry when a window
// starts maximised, so nothing else is needed there.
func startWindowState(maximised bool) options.WindowStartState {
	if maximised {
		return options.Maximised
	}
	return options.Normal
}

func maximiseOnDomReady(ctx context.Context, maximised bool) {}
