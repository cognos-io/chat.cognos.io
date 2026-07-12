package main

import (
	"slices"
	"testing"
)

func TestCompareDeploymentFiles(t *testing.T) {
	files := []string{
		"index.html",
		"assets/logo.svg",
		"chunk-DLS757DM.js",
		"main.0123456789abcdef.js",
		"de/index.html",
		"styles.abcdef0123456789.css",
	}
	want := []string{
		"chunk-DLS757DM.js",
		"main.0123456789abcdef.js",
		"styles.abcdef0123456789.css",
		"assets/logo.svg",
		"de/index.html",
		"index.html",
	}

	slices.SortFunc(files, compareDeploymentFiles)
	if !slices.Equal(files, want) {
		t.Errorf("compareDeploymentFiles(%v) sorted = %v, want %v", files, files, want)
	}
}

func TestStorageURL(t *testing.T) {
	t.Parallel()
	got := storageURL("https://storage.bunnycdn.com/", "cognos app", "assets/a b.svg")
	want := "https://storage.bunnycdn.com/cognos%20app/assets/a%20b.svg"
	if got != want {
		t.Errorf("storageURL(%q, %q, %q) = %q, want %q", "https://storage.bunnycdn.com/", "cognos app", "assets/a b.svg", got, want)
	}
}
