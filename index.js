// Load .env
require("dotenv").config();

const express = require("express");
const Airtable = require("airtable");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Small helper: Railway sometimes shows values with quotes in the UI.
 * This removes only WRAPPING quotes:  "value" -> value
 */
function stripQuotes(v) {
  return (v || "").replace(/^"|"$/g, "");
}

/**
 * -------------------------
 * Basic routes
 * -------------------------
 */
app.get("/", (req, res) => {
  res.send("Hello from pc-sync 👋");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

/**
 * -------------------------
 * OAuth: Start + Callback
 * -------------------------
 *
 * /oauth/start
 *   Redirects you to Planning Center to approve access.
 *
 * /oauth/callback
 *   Receives ?code=... and exchanges it for tokens.
 *
 * NOTE: Token endpoint commonly expects x-www-form-urlencoded. :contentReference[oaicite:1]{index=1}
 */

// Start OAuth (redirect to Planning Center)
app.get("/oauth/start", (req, res) => {
  const PCO_APP_ID = stripQuotes(process.env.PCO_APP_ID);
  const PCO_REDIRECT_URI = stripQuotes(process.env.PCO_REDIRECT_URI);

  if (!PCO_APP_ID || !PCO_REDIRECT_URI) {
    return res.status(500).json({
      ok: false,
      error: "Missing OAuth env vars",
      hasPCO_APP_ID: !!PCO_APP_ID,
      hasPCO_REDIRECT_URI: !!PCO_REDIRECT_URI,
    });
  }

  const params = new URLSearchParams({
    client_id: PCO_APP_ID,
    redirect_uri: PCO_REDIRECT_URI,
    response_type: "code",
    scope: "calendar", // your working scope
    state: String(Date.now()),
  });

  const authUrl = `https://api.planningcenteronline.com/oauth/authorize?${params.toString()}`;

  // debug=1 returns the URL instead of redirecting
  if (req.query.debug === "1") {
    return res.json({ authUrl });
  }

  return res.redirect(authUrl);
});

// OAuth callback (exchange code -> tokens)
app.get("/oauth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing authorization code");

  const PCO_APP_ID = stripQuotes(process.env.PCO_APP_ID);
  const PCO_SECRET = stripQuotes(process.env.PCO_SECRET);
  const PCO_REDIRECT_URI = stripQuotes(process.env.PCO_REDIRECT_URI);

  if (!PCO_APP_ID || !PCO_SECRET || !PCO_REDIRECT_URI) {
    return res.status(500).send("Server missing PCO_APP_ID / PCO_SECRET / PCO_REDIRECT_URI");
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: PCO_REDIRECT_URI,
      client_id: PCO_APP_ID,
      client_secret: PCO_SECRET,
    });

    const tokenResponse = await axios.post(
      "https://api.planningcenteronline.com/oauth/token",
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Don’t log tokens
    console.log("OAuth success: token received");

    // OPTIONAL: temporarily show tokens in-browser so you can copy them into Railway vars.
    // Turn this on only when you need it:
    //   Railway var: OAUTH_SHOW_TOKENS=true
    if (stripQuotes(process.env.OAUTH_SHOW_TOKENS) === "true") {
      return res.type("html").send(`
        <h2>OAuth Successful ✅</h2>
        <p>Copy these into Railway Variables, then set <code>OAUTH_SHOW_TOKENS</code> back to <code>false</code>.</p>
        <pre>
PCO_ACCESS_TOKEN=${access_token}
PCO_REFRESH_TOKEN=${refresh_token}
PCO_TOKEN_EXPIRES_IN=${expires_in}
        </pre>
      `);
    }

    return res.send("OAuth successful ✅ You can close this window.");
  } catch (err) {
    console.error("OAuth failed:", err.response?.data || err.message);
    return res.status(500).send("OAuth failed");
  }
});

/**
 * -------------------------
 * Airtable helper
 * -------------------------
 */
function getAirtableBase() {
  const AIRTABLE_API_KEY = stripQuotes(process.env.AIRTABLE_API_KEY);
  const AIRTABLE_BASE_ID = stripQuotes(process.env.AIRTABLE_BASE_ID);

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error("Airtable environment variables not set");
  }

  Airtable.configure({ apiKey: AIRTABLE_API_KEY });
  return Airtable.base(AIRTABLE_BASE_ID);
}

/**
 * -------------------------
 * Planning Center OAuth token handling
 * -------------------------
 *
 * For API calls, we use:
 *   Authorization: Bearer <access_token>
 *
 * If you set PCO_REFRESH_TOKEN, we can refresh automatically using /oauth/token. :contentReference[oaicite:2]{index=2}
 */

const tokenCache = {
  accessToken: stripQuotes(process.env.PCO_ACCESS_TOKEN),
  refreshToken: stripQuotes(process.env.PCO_REFRESH_TOKEN),
  // If you don't have this, we can still try the access token as-is.
  expiresAtMs: 0,
};

async function refreshAccessToken() {
  const PCO_APP_ID = stripQuotes(process.env.PCO_APP_ID);
  const PCO_SECRET = stripQuotes(process.env.PCO_SECRET);

  if (!PCO_APP_ID || !PCO_SECRET) {
    throw new Error("Missing PCO_APP_ID / PCO_SECRET (needed to refresh tokens)");
  }
  if (!tokenCache.refreshToken) {
    throw new Error("Missing PCO_REFRESH_TOKEN (needed to refresh access token)");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenCache.refreshToken,
    client_id: PCO_APP_ID,
    client_secret: PCO_SECRET,
  });

  const resp = await axios.post(
    "https://api.planningcenteronline.com/oauth/token",
    body.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    }
  );

  const { access_token, refresh_token, expires_in } = resp.data;

  tokenCache.accessToken = access_token;
  // refresh ~60 seconds early
  tokenCache.expiresAtMs = Date.now() + (Number(expires_in || 3600) * 1000) - 60_000;

  // Some providers may return a new refresh token. If that happens, keep it in memory.
  // If you ever see auth break after a restart, re-run /oauth/start and update Railway vars.
  if (refresh_token && refresh_token !== tokenCache.refreshToken) {
    tokenCache.refreshToken = refresh_token;
    console.log("OAuth: refresh token was updated (not logging value). Consider updating Railway var PCO_REFRESH_TOKEN.");
  }

  return tokenCache.accessToken;
}

async function getPcoAccessToken() {
  // If we have a non-expired cached token, use it
  if (tokenCache.accessToken && tokenCache.expiresAtMs && Date.now() < tokenCache.expiresAtMs) {
    return tokenCache.accessToken;
  }

  // If we have a refresh token, refresh each time as needed
  if (tokenCache.refreshToken) {
    return await refreshAccessToken();
  }

  // No refresh token: fall back to whatever access token you set in env
  if (!tokenCache.accessToken) {
    throw new Error("Missing PCO_ACCESS_TOKEN (and no PCO_REFRESH_TOKEN to refresh)");
  }

  return tokenCache.accessToken;
}

async function pcoGet(path, params = {}) {
  const accessToken = await getPcoAccessToken();
  return axios.get(`https://api.planningcenteronline.com${path}`, {
    params,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * -------------------------
 * /sync (secured)
 * -------------------------
 */
app.post("/sync", async (req, res) => {
  const expectedSecret = stripQuotes(process.env.SYNC_SECRET);
  const providedSecret = req.headers["x-sync-secret"];

  if (!expectedSecret) {
    return res.status(500).json({ ok: false, error: "Server misconfigured: SYNC_SECRET not set" });
  }
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    // 1) Read Airtable (your current “dry run”)
    const base = getAirtableBase();
    const tableName = stripQuotes(process.env.AIRTABLE_TABLE_NAME);
    if (!tableName) throw new Error("AIRTABLE_TABLE_NAME not set");

    const records = await base(tableName).select({ maxRecords: 5 }).firstPage();

    // Minimal logging (no secrets)
    console.log(`Fetched ${records.length} Airtable records`);

    // 2) Test Planning Center access token by fetching 1 event
    const pcoResp = await pcoGet("/calendar/v2/events", { per_page: 1 });

    const firstEventName = pcoResp.data?.data?.[0]?.attributes?.name || null;

    return res.json({
      ok: true,
      message: "Sync triggered (Airtable read + PCO auth test)",
      airtable: { recordCount: records.length },
      pco: { firstEventName },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Sync error:", err.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

/**
 * -------------------------
 * Start server (keep at the bottom)
 * -------------------------
 */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
