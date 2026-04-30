import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeCtx {
  theme: Theme;
  /** 实际生效的（用 system 时这里是 light/dark 之一） */
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

const LS_KEY = "theme";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    return (localStorage.getItem(LS_KEY) as Theme) || defaultTheme;
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? resolveSystem() : (theme as "light" | "dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const next = theme === "system" ? resolveSystem() : (theme as "light" | "dark");
    root.classList.remove("light", "dark");
    root.classList.add(next);
    setResolvedTheme(next);
    try {
      localStorage.setItem(LS_KEY, theme);
    } catch {
      // noop
    }

    if (theme !== "system") return;
    // system 模式下监听 OS 切换
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      const v = e.matches ? "dark" : "light";
      root.classList.remove("light", "dark");
      root.classList.add(v);
      setResolvedTheme(v);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
