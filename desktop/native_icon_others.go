//go:build !linux || bindings

package main

// Only GTK has an icon theme to follow; elsewhere the page keeps its own icons.
func nativeIconFile(name string) string { return "" }
