package main

import "testing"

func TestGreeting(t *testing.T) {
	if got := greeting(""); got != "Hello, world!" {
		t.Fatalf("got %q", got)
	}
	if got := greeting("OmniTerm"); got != "Hello, OmniTerm!" {
		t.Fatalf("got %q", got)
	}
}
