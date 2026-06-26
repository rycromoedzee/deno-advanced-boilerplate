import { computed, ref } from "vue";
import { useRouter } from "vue-router";

const ADMIN_TOKEN_KEY = "admin_token";

// Initialize token from URL on first load
function initTokenFromUrl(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get("admin_token");
  if (urlToken) {
    localStorage.setItem(ADMIN_TOKEN_KEY, urlToken);
    // Clean URL without reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);
  }
}

// Run on module load
initTokenFromUrl();

// Get token helper - can be called without router
export function getToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function useAuth() {
  const router = useRouter();
  const token = ref<string | null>(getToken());

  const isAuthenticated = computed(() => !!token.value);

  const setToken = (newToken: string) => {
    token.value = newToken;
    localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
  };

  const clearToken = () => {
    token.value = null;
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  };

  const logout = () => {
    clearToken();
    router.push("/internal/__admin/404");
  };

  // Debug logging
  const debugAuth = () => {
    console.log("[Auth Debug]");
    console.log("  Token in state:", token.value?.substring(0, 20) + "...");
    console.log("  Token in localStorage:", localStorage.getItem(ADMIN_TOKEN_KEY)?.substring(0, 20) + "...");
    console.log("  Is authenticated:", isAuthenticated.value);
  };

  return {
    token,
    isAuthenticated,
    setToken,
    clearToken,
    logout,
    debugAuth,
  };
}
