// ============================================
// CLOUDFLARE WORKER: Roblox API Proxy
// ============================================
// Deploys to: https://<your-worker-name>.<your-subdomain>.workers.dev
//
// Routes:
//   /friends/v1/users/{userId}/friends/count    → friends.roblox.com
//   /friends/v1/users/{userId}/followers/count  → friends.roblox.com
//   /users/v1/users/{userId}                    → users.roblox.com
//
// Usage from your Roblox game:
//   https://<your-worker>.workers.dev/friends/v1/users/123456/friends/count
// ============================================

// Allowed Roblox API hosts (security: only proxy to these)
const ALLOWED_HOSTS = {
  "friends": "https://friends.roblox.com",
  "users":   "https://users.roblox.com",
  "groups":  "https://groups.roblox.com",
  "thumbnails": "https://thumbnails.roblox.com",
};

// Cache TTL per endpoint type (seconds)
// Cloudflare caches responses at the edge — multiple requests to same URL
// only hit Roblox once during this window
const CACHE_TTL = {
  "friends":    300,   // 5 min - friend/follower counts
  "users":      900,   // 15 min - user info (verified badge, etc.)
  "groups":     600,   // 10 min - group memberships
  "thumbnails": 3600,  // 1 hour - avatar URLs
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(p => p.length > 0);

    // URL format: /{host}/v1/...
    // Example: /friends/v1/users/123/friends/count
    if (pathParts.length < 2) {
      return new Response("Usage: /<host>/v1/...\nAllowed hosts: " +
        Object.keys(ALLOWED_HOSTS).join(", "), {
        status: 400,
        headers: { "Content-Type": "text/plain" }
      });
    }

    const hostKey = pathParts[0];
    const targetBase = ALLOWED_HOSTS[hostKey];

    if (!targetBase) {
      return new Response(`Unknown host: ${hostKey}`, { status: 400 });
    }

    // Build target URL: remove host prefix, keep rest
    const remainingPath = "/" + pathParts.slice(1).join("/");
    const targetUrl = targetBase + remainingPath + url.search;

    // Check edge cache first
    const cacheKey = new Request(targetUrl, { method: "GET" });
    const cache = caches.default;

    let response = await cache.match(cacheKey);
    if (response) {
      // Cached hit — add header so you can verify in browser/Roblox
      const headers = new Headers(response.headers);
      headers.set("X-Proxy-Cache", "HIT");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    // Cache miss — fetch from Roblox
    try {
      response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "Roblox-Cloudflare-Proxy/1.0",
        },
        cf: {
          // Cloudflare's request-level caching
          cacheTtl: CACHE_TTL[hostKey] || 300,
          cacheEverything: true,
        },
      });

      // Build new response with cache headers
      const headers = new Headers(response.headers);
      headers.set("X-Proxy-Cache", "MISS");
      headers.set("Cache-Control", `public, max-age=${CACHE_TTL[hostKey] || 300}`);
      headers.set("Access-Control-Allow-Origin", "*");

      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      // Store in edge cache for future requests
      if (response.status === 200) {
        ctx.waitUntil(cache.put(cacheKey, newResponse.clone()));
      }

      return newResponse;
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" }
      });
    }
  }
};
