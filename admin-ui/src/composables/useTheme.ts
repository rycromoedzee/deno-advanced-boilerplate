import { ref, watch } from "vue";

const THEME_STORAGE_KEY = "admin_theme";

export function useTheme() {
  const isDark = ref<boolean>(false);

  // Initialize from localStorage or system preference
  const initializeTheme = () => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    isDark.value = stored === "dark" || (!stored && systemPrefersDark);
    applyTheme();
  };

  const applyTheme = () => {
    if (isDark.value) {
      document.documentElement.classList.add("theme-dark");
    } else {
      document.documentElement.classList.remove("theme-dark");
    }
  };

  const toggleTheme = () => {
    isDark.value = !isDark.value;
    localStorage.setItem(THEME_STORAGE_KEY, isDark.value ? "dark" : "light");
    applyTheme();
  };

  // Watch for changes
  watch(isDark, applyTheme);

  return {
    isDark,
    toggleTheme,
    initializeTheme,
  };
}
