//go:build linux && !bindings

package main

/*
#cgo pkg-config: gtk+-3.0

#include <stdlib.h>
#include <gtk/gtk.h>

static gboolean applyPreferDarkTheme(gpointer data) {
	GtkSettings *settings = gtk_settings_get_default();
	if (settings != NULL) {
		g_object_set(settings, "gtk-application-prefer-dark-theme", data != NULL ? TRUE : FALSE, NULL);
	}
	return G_SOURCE_REMOVE;
}

static void setPreferDarkTheme(int dark) {
	g_idle_add(applyPreferDarkTheme, dark ? GINT_TO_POINTER(1) : NULL);
}

static GtkCssProvider *titlebarProvider = NULL;

// Takes ownership of css (a g_strdup'd string).
static gboolean applyTitlebarCss(gpointer data) {
	gchar *css = data;
	GdkScreen *screen = gdk_screen_get_default();
	if (screen != NULL) {
		if (titlebarProvider == NULL) {
			titlebarProvider = gtk_css_provider_new();
			gtk_style_context_add_provider_for_screen(screen, GTK_STYLE_PROVIDER(titlebarProvider),
				GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
		}
		gtk_css_provider_load_from_data(titlebarProvider, css, -1, NULL);
	}
	g_free(css);
	return G_SOURCE_REMOVE;
}

static void setTitlebarCss(const char *css) {
	g_idle_add(applyTitlebarCss, g_strdup(css));
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// setNativeWindowDark switches GTK to the dark variant of the current theme.
//
// That is what decorates the title bar: with client-side decorations GTK draws
// the header bar itself, and under a window manager GTK reflects the preference
// onto the toplevel's _GTK_THEME_VARIANT so the WM picks its dark frame.
//
// The property is set from a GTK idle callback because invoke() runs on a
// request goroutine, not the thread owning the GTK main loop.
func setNativeWindowDark(dark bool) {
	value := C.int(0)
	if dark {
		value = 1
	}
	C.setPreferDarkTheme(value)
}

// roundedDecorationCss rounds all four corners of the frame (outline and
// shadow) GTK draws around a floating window; stock GTK 3 rounds only the top
// two. The webview rounds its own bottom corners to match (html.window-rounded).
const roundedDecorationCss = `window.csd:not(.maximized):not(.fullscreen):not(.tiled):not(.tiled-top):not(.tiled-bottom):not(.tiled-left):not(.tiled-right) decoration {
	border-radius: 8px;
}
`

// setNativeTitlebarColors paints the title bar GTK draws itself (client-side
// decorations, e.g. GNOME on Wayland) in the side nav's colors, so the window
// top reads as one piece with the rail. Server-side frames drawn by the window
// manager ignore it and keep following setNativeWindowDark. Anything but an
// opaque #rrggbb pair clears the color override (the values are spliced into
// CSS); the rounded corners stay.
func setNativeTitlebarColors(bg, fg string) {
	css := roundedDecorationCss
	if opaqueHexColor.MatchString(bg) && opaqueHexColor.MatchString(fg) {
		css += fmt.Sprintf(`.titlebar.default-decoration, .titlebar.default-decoration:backdrop {
	background: %[1]s;
	color: %[2]s;
	border-color: %[1]s;
	box-shadow: none;
}
.titlebar.default-decoration button.titlebutton,
.titlebar.default-decoration:backdrop button.titlebutton {
	color: %[2]s;
}`, bg, fg)
	}
	cs := C.CString(css)
	defer C.free(unsafe.Pointer(cs))
	C.setTitlebarCss(cs)
}
