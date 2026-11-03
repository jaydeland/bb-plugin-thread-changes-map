// Shared by server.ts and app.tsx. Keep it free of server-only imports.

/** The realtime channel the server publishes on after every map or state change. */
export const MAP_CHANNEL = "map-changed";
