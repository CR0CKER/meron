package main

import (
	"errors"
	"strings"
	"testing"
)

func stubNativeIcon(t *testing.T, files map[string]string, contents map[string]string) *[]string {
	t.Helper()
	oldLookup, oldRead := lookupNativeIcon, readIconFile
	t.Cleanup(func() { lookupNativeIcon, readIconFile = oldLookup, oldRead })
	looked := []string{}
	lookupNativeIcon = func(name string) string {
		looked = append(looked, name)
		return files[name]
	}
	readIconFile = func(path string) ([]byte, error) {
		content, ok := contents[path]
		if !ok {
			return nil, errors.New("missing")
		}
		return []byte(content), nil
	}
	return &looked
}

func iconSvg(t *testing.T, name any) string {
	t.Helper()
	reply, err := (&App{}).nativeIcon(map[string]any{"name": name})
	if err != nil {
		t.Fatal(err)
	}
	return reply.(map[string]any)["svg"].(string)
}

func TestNativeIconReturnsTheThemesSvg(t *testing.T) {
	svg := `<svg viewBox="0 0 16 16"><path d="m1 2h14v2h-14z"/></svg>`
	stubNativeIcon(t, map[string]string{"open-menu-symbolic": "/theme/open-menu-symbolic.svg"},
		map[string]string{"/theme/open-menu-symbolic.svg": svg})
	if got := iconSvg(t, "open-menu-symbolic"); got != svg {
		t.Fatalf("svg = %q", got)
	}
}

func TestNativeIconOnlyLooksUpSymbolicNames(t *testing.T) {
	looked := stubNativeIcon(t, nil, nil)
	for _, name := range []any{"", "open-menu", "../../etc/passwd-symbolic", "Open-Menu-symbolic", "a b-symbolic", 42, nil} {
		if got := iconSvg(t, name); got != "" {
			t.Fatalf("%v: svg = %q", name, got)
		}
	}
	if len(*looked) != 0 {
		t.Fatalf("looked up %v", *looked)
	}
}

func TestNativeIconFallsBackWhenTheThemeHasNoUsableSvg(t *testing.T) {
	stubNativeIcon(t,
		map[string]string{
			"png-symbolic":     "/theme/png-symbolic.png",
			"huge-symbolic":    "/theme/huge-symbolic.svg",
			"missing-symbolic": "/theme/gone.svg",
		},
		map[string]string{
			"/theme/png-symbolic.png":  "\x89PNG",
			"/theme/huge-symbolic.svg": "<svg>" + strings.Repeat(" ", maxIconSize) + "</svg>",
		})
	for _, name := range []string{"absent-symbolic", "png-symbolic", "huge-symbolic", "missing-symbolic"} {
		if got := iconSvg(t, name); got != "" {
			t.Fatalf("%s: svg = %q", name, got)
		}
	}
}
