import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const THEME_KEY = 'pg_theme';

// Restored synchronously at init — relying on post-paint timing (rAF) fails in
// background/not-composited tabs, and a delayed setState would flash the wrong
// theme. The lazy initializer is the standard, robust pattern.
const initialTheme = () => {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

// useTheme must live next to the provider it reads — exempt from fast-refresh.
// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(ThemeContext);
