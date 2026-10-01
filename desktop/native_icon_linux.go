//go:build linux && !bindings

package main

/*
#cgo pkg-config: gtk+-3.0

#include <stdlib.h>
#include <gtk/gtk.h>

typedef struct {
	const char *name;
	gchar *filename;
	gboolean done;
	GMutex mutex;
	GCond condition;
} IconLookup;

// The file of a symbolic icon in the user's icon theme, as GTK resolves it
// for its own widgets (Adwaita on stock GNOME). GTK is only used from its
// main loop, so the lookup runs there.
static gboolean runIconLookup(gpointer data) {
	IconLookup *lookup = data;
	GtkIconInfo *info = gtk_icon_theme_lookup_icon(gtk_icon_theme_get_default(), lookup->name, 16,
		GTK_ICON_LOOKUP_FORCE_SVG | GTK_ICON_LOOKUP_FORCE_SIZE);
	if (info != NULL) {
		const gchar *filename = gtk_icon_info_get_filename(info);
		if (filename != NULL) lookup->filename = g_strdup(filename);
		g_object_unref(info);
	}
	g_mutex_lock(&lookup->mutex);
	lookup->done = TRUE;
	g_cond_signal(&lookup->condition);
	g_mutex_unlock(&lookup->mutex);
	return G_SOURCE_REMOVE;
}

static gchar *lookupIconFile(const char *name) {
	IconLookup lookup = {0};
	lookup.name = name;
	g_mutex_init(&lookup.mutex);
	g_cond_init(&lookup.condition);
	if (g_main_context_is_owner(g_main_context_default())) {
		runIconLookup(&lookup);
	} else {
		g_mutex_lock(&lookup.mutex);
		g_idle_add(runIconLookup, &lookup);
		while (!lookup.done) g_cond_wait(&lookup.condition, &lookup.mutex);
		g_mutex_unlock(&lookup.mutex);
	}
	g_cond_clear(&lookup.condition);
	g_mutex_clear(&lookup.mutex);
	return lookup.filename;
}
*/
import "C"

import "unsafe"

// nativeIconFile returns the file GTK would draw for a symbolic icon name in
// the user's icon theme, or "" when the theme has none.
func nativeIconFile(name string) string {
	cname := C.CString(name)
	defer C.free(unsafe.Pointer(cname))
	file := C.lookupIconFile(cname)
	if file == nil {
		return ""
	}
	defer C.g_free(C.gpointer(unsafe.Pointer(file)))
	return C.GoString(file)
}
