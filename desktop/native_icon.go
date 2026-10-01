package main

import (
	"bytes"
	"os"
	"regexp"
)

// symbolicIconName limits lookups to freedesktop symbolic icon names, so the
// page can't use the bridge to probe arbitrary theme files.
var symbolicIconName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*-symbolic$`)

// maxIconSize caps what is read back: symbolic icons are a few hundred bytes.
const maxIconSize = 64 << 10

// Swappable for tests.
var (
	lookupNativeIcon = nativeIconFile
	readIconFile     = os.ReadFile
)

// nativeIcon returns a symbolic icon from the desktop's icon theme as SVG
// text, so the pane headers can draw the same icons as GNOME's own header bars
// in whatever theme the user picked. An empty svg means "keep your own icon":
// not on GTK, no such icon, or not an SVG.
func (a *App) nativeIcon(payload map[string]any) (any, error) {
	name, _ := payload["name"].(string)
	if !symbolicIconName.MatchString(name) {
		return map[string]any{"svg": ""}, nil
	}
	file := lookupNativeIcon(name)
	if file == "" {
		return map[string]any{"svg": ""}, nil
	}
	data, err := readIconFile(file)
	if err != nil || len(data) > maxIconSize || !bytes.Contains(data, []byte("<svg")) {
		return map[string]any{"svg": ""}, nil
	}
	return map[string]any{"svg": string(data)}, nil
}
