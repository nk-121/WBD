/**
 * Token Manager for ChessHive Frontend
 * ======================================
 * Handles JWT access/refresh token storage, automatic refresh, and request interception.
 * Access tokens expire in 30 minutes; refresh tokens last 7 days.
 */

const BACKEND_BASE = 'http://localhost:3000';

// ─── Token Storage Keys ──────────────────────────────────────────
const ACCESS_TOKEN_KEY = 'chesshive_access_token';
const REFRESH_TOKEN_KEY = 'chesshive_refresh_token';
const TOKEN_EXPIRY_KEY = 'chesshive_token_expiry';
const USER_KEY = 'chesshive_jwt_user';

// ─── Refresh state ───────────────────────────────────────────────
let isRefreshing = false;
let refreshPromise = null;
let refreshTimer = null;

// ─── Token Storage Operations ────────────────────────────────────

/**
 * Store tokens after login/signup/refresh
 */
export function storeTokens({ accessToken, refreshToken, expiresIn, user }) {
  try {
    if (accessToken) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(ACCESS_TOKEN_KEY + '_backup', accessToken);
    }
    if (refreshToken) {
      sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      localStorage.setItem(REFRESH_TOKEN_KEY + '_backup', refreshToken);
    }
    if (expiresIn) {
      const expiryTimestamp = Date.now() + (expiresIn * 1000);
      sessionStorage.setItem(TOKEN_EXPIRY_KEY, expiryTimestamp.toString());
      localStorage.setItem(TOKEN_EXPIRY_KEY + '_backup', expiryTimestamp.toString());
    }
    if (user) {
      const userStr = JSON.stringify(user);
      sessionStorage.setItem(USER_KEY, userStr);
      localStorage.setItem(USER_KEY + '_backup', userStr);
    }

    // Schedule automatic refresh before expiry
    scheduleTokenRefresh(expiresIn);
  } catch (e) {
    console.warn('Failed to store tokens:', e);
  }
}

/**
 * Get the current access token
 */
export function getAccessToken() {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY)
      || localStorage.getItem(ACCESS_TOKEN_KEY + '_backup')
      || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get the current refresh token
 */
export function getRefreshToken() {
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY)
      || localStorage.getItem(REFRESH_TOKEN_KEY + '_backup')
      || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get stored user info from JWT
 */
export function getStoredUser() {
  try {
    const userStr = sessionStorage.getItem(USER_KEY)
      || localStorage.getItem(USER_KEY + '_backup');
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if the access token is expired or about to expire (within 2 min buffer)
 */
export function isTokenExpired() {
  try {
    const expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY)
      || localStorage.getItem(TOKEN_EXPIRY_KEY + '_backup');
    if (!expiry) return true;

    const expiryMs = parseInt(expiry, 10);
    const bufferMs = 2 * 60 * 1000; // 2 minute buffer
    return Date.now() >= (expiryMs - bufferMs);
  } catch (e) {
    return true;
  }
}

/**
 * Check if user has any valid tokens (access or refresh)
 */
export function hasValidSession() {
  return !!(getAccessToken() || getRefreshToken());
}

/**
 * Clear all stored tokens (for logout)
 */
export function clearTokens() {
  try {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY + '_backup');
    localStorage.removeItem(REFRESH_TOKEN_KEY + '_backup');
    localStorage.removeItem(TOKEN_EXPIRY_KEY + '_backup');
    localStorage.removeItem(USER_KEY + '_backup');

    // Also clear legacy token keys
    sessionStorage.removeItem('chesshive_token');
    localStorage.removeItem('chesshive_token_backup');

    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  } catch (e) {
    console.warn('Failed to clear tokens:', e);
  }
}

// ─── Token Refresh ───────────────────────────────────────────────

/**
 * Refresh the access token using the refresh token.
 * Uses a singleton promise to prevent multiple concurrent refresh calls.
 * @returns {Promise<string|null>} New access token or null if refresh failed
 */
export async function refreshAccessToken() {
  // If already refreshing, return the in-flight promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const currentRefreshToken = getRefreshToken();
  if (!currentRefreshToken) {
    console.warn('No refresh token available');
    clearTokens();
    return null;
  }

  isRefreshing = true;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BACKEND_BASE}/api/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: currentRefreshToken })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        console.error('Token refresh failed:', data.message);
        clearTokens();
        // Dispatch a custom event so the app knows to redirect to login
        window.dispatchEvent(new CustomEvent('chesshive:session-expired', {
          detail: { message: data.message || 'Session expired' }
        }));
        return null;
      }

      // Store new tokens (includes rotation – new refresh token)
      storeTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        user: data.user
      });

      console.log('Token refreshed successfully');
      return data.accessToken;
    } catch (err) {
      console.error('Token refresh network error:', err);
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Schedule automatic token refresh before expiry
 */
function scheduleTokenRefresh(expiresInSeconds) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  if (!expiresInSeconds || expiresInSeconds <= 0) return;

  // Refresh 3 minutes before expiry (or at half-life if less than 6 min)
  const refreshBeforeMs = Math.min(3 * 60 * 1000, (expiresInSeconds * 1000) / 2);
  const refreshInMs = (expiresInSeconds * 1000) - refreshBeforeMs;

  if (refreshInMs > 0) {
    refreshTimer = setTimeout(() => {
      console.log('Auto-refreshing token before expiry...');
      refreshAccessToken();
    }, refreshInMs);
  }
}

// ─── Authenticated Fetch ─────────────────────────────────────────

/**
 * Enhanced fetch that automatically attaches JWT token and handles 401s with refresh.
 * Drop-in replacement for fetch() in authenticated requests.
 * 
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function authenticatedFetch(url, options = {}) {
  // Ensure we have a valid access token
  let accessToken = getAccessToken();

  // If token is expired, try refreshing before making the request
  if (isTokenExpired() && getRefreshToken()) {
    accessToken = await refreshAccessToken();
    if (!accessToken) {
      // Refresh failed, proceed without token (will likely get 401)
      return fetch(url, { credentials: 'include', ...options });
    }
  }

  // Attach Authorization header
  const headers = {
    ...(options.headers || {}),
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const mergedOptions = {
    credentials: 'include',
    ...options,
    headers
  };

  let response = await fetch(url, mergedOptions);

  // If 401 with TOKEN_EXPIRED, try one refresh and retry
  if (response.status === 401) {
    const errorData = await response.clone().json().catch(() => ({}));
    if (errorData.code === 'TOKEN_EXPIRED') {
      const newToken = await refreshAccessToken();
      if (newToken) {
        // Retry the request with the new token
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, {
          credentials: 'include',
          ...options,
          headers
        });
      }
    }
  }

  return response;
}

// ─── Logout ──────────────────────────────────────────────────────

/**
 * Perform a full logout – revoke refresh token on server & clear local storage
 */
export async function logoutUser() {
  const refreshToken = getRefreshToken();

  try {
    const accessToken = getAccessToken();
    await fetch(`${BACKEND_BASE}/api/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
      },
      credentials: 'include',
      body: JSON.stringify({ refreshToken })
    });
  } catch (e) {
    console.warn('Logout API call failed:', e);
  }

  clearTokens();
}

// ─── Initialize ──────────────────────────────────────────────────

/**
 * Initialize token manager on app start.
 * Checks if existing tokens are valid and schedules refresh if needed.
 */
export function initTokenManager() {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!accessToken && !refreshToken) {
    return; // No session
  }

  if (accessToken && !isTokenExpired()) {
    // Token still valid – schedule refresh
    const expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY)
      || localStorage.getItem(TOKEN_EXPIRY_KEY + '_backup');
    if (expiry) {
      const remainingMs = parseInt(expiry, 10) - Date.now();
      const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
      scheduleTokenRefresh(remainingSec);
    }
    return;
  }

  if (refreshToken) {
    // Access token expired but refresh token available – refresh immediately
    console.log('Access token expired, refreshing on startup...');
    refreshAccessToken();
  }
}

export default {
  storeTokens,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  isTokenExpired,
  hasValidSession,
  clearTokens,
  refreshAccessToken,
  authenticatedFetch,
  logoutUser,
  initTokenManager
};
