package service

import "testing"

func TestIsValidLinuxUsername(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"ubuntu", true},
		{"user_01", true},
		{"_system", true},
		{"a", true},
		{"", false},
		{"0user", false},
		{"-user", false},
		{"USER", false},
		{"user name", false},
		{"user;rm", false},
		{"user'x", false},
		{"user`x", false},
		{"user$x", false},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false}, // 33 chars
	}
	for _, c := range cases {
		if got := isValidLinuxUsername(c.in); got != c.want {
			t.Errorf("isValidLinuxUsername(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestShellSingleQuote(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"ubuntu", "'ubuntu'"},
		{"a b c", "'a b c'"},
		{"it's", `'it'\''s'`},
		{"''", `''\'''\'''`},
		{"", "''"},
		{`$(whoami)`, `'$(whoami)'`},
	}
	for _, c := range cases {
		if got := shellSingleQuote(c.in); got != c.want {
			t.Errorf("shellSingleQuote(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
