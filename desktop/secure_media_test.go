package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDecryptedAttachmentKeysResolveInsideTheSecureDir(t *testing.T) {
	t.Setenv("XDG_RUNTIME_DIR", t.TempDir())
	path, err := mediaFilePath("e2ee/acc/INBOX/7/0.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, secureMediaDir()+string(filepath.Separator)) {
		t.Fatalf("decrypted attachment resolved outside the secure dir: %s", path)
	}
	if _, err := mediaFilePath("e2ee/../../etc/passwd"); err == nil {
		if p, _ := mediaFilePath("e2ee/../../etc/passwd"); !strings.HasPrefix(p, secureMediaDir()) {
			t.Fatalf("traversal escaped the secure dir: %s", p)
		}
	}
	plain, err := mediaFilePath("acc/INBOX/7/0.txt")
	if err != nil || !strings.HasPrefix(plain, mediaDir()) {
		t.Fatalf("plain attachment moved: %s %v", plain, err)
	}
}

func TestSidecarGetsTheSecureMediaDir(t *testing.T) {
	t.Setenv("XDG_RUNTIME_DIR", t.TempDir())
	want := "MERON_SECURE_MEDIA_DIR=" + secureMediaDir()
	for _, kv := range sidecarEnv() {
		if kv == want {
			return
		}
	}
	t.Fatalf("sidecar env lacks %s", want)
}
