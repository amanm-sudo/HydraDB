// server/config.js
// Pure, testable environment-variable configuration resolution.
// Accepts an env-var-like object (e.g. process.env) rather than reading
// process.env internally, so tests can pass arbitrary generated env
// combinations without mutating global state.

export const DEFAULT_BOLT_URI = 'bolt://127.0.0.1:7687';
export const DEFAULT_AUTH_TOKEN = 'local-development-token-32-bytes';
export const DEFAULT_PORT = 3001;

/**
 * Resolve a single config value from an env-var-like object, falling back
 * to `defaultValue` when the variable is unset or empty.
 *
 * @param {Record<string, string | undefined>} envVars
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function resolveConfig(envVars, key, defaultValue) {
  const value = envVars?.[key];
  return value === undefined || value === '' ? defaultValue : value;
}

/**
 * Resolve the HydraDB Bolt URI from an env-var-like object.
 * @param {Record<string, string | undefined>} envVars
 */
export function resolveBoltUri(envVars) {
  return resolveConfig(envVars, 'HYDRADB_BOLT_URI', DEFAULT_BOLT_URI);
}

/**
 * Resolve the HydraDB auth token from an env-var-like object.
 * @param {Record<string, string | undefined>} envVars
 */
export function resolveAuthToken(envVars) {
  return resolveConfig(envVars, 'HYDRADB_TOKEN', DEFAULT_AUTH_TOKEN);
}

/**
 * Resolve the API server listening port from an env-var-like object.
 * @param {Record<string, string | undefined>} envVars
 */
export function resolvePort(envVars) {
  return resolveConfig(envVars, 'PORT', DEFAULT_PORT);
}
