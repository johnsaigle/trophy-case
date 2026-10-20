/**
 * Thin, dependency-free GitHub API wrapper around the `gh` CLI.
 *
 * Matches the convention of scripts/collect.js: no SDK, uses the authenticated
 * `gh` binary. Handles pagination and (coarsely) rate limits. Network only —
 * no deterministic logic lives here.
 */
const { execFileSync } = require("child_process");

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const SEARCH_INTERVAL_MS = 2200; // authenticated search: 30 req/min
const MAX_SEARCH_PAGES = 10; // search API hard-caps at 1000 results

function gh(endpoint, token, ...flags) {
  return JSON.parse(
    execFileSync("gh", ["api", endpoint, ...flags], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_TOKEN: token || TOKEN },
    })
  );
}

function isRateLimitError(err) {
  const msg = String(err && (err.stderr || err.message)).toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("secondary rate") ||
    msg.includes("abuse detection")
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch every page of a list endpoint. Returns an array. */
async function ghAllPages(endpoint, { token, maxPages = 100, pageParam = "page", attempts = 4 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const items = await withRateLimitRetry(
      () => gh(`${endpoint}${sep}${pageParam}=${page}&per_page=100`, token),
      { attempts }
    );
    if (!Array.isArray(items)) {
      throw new Error(`Expected an array from ${endpoint} (page ${page})`);
    }
    out.push(...items);
    if (items.length < 100) return out;
  }
  return out;
}

async function withRateLimitRetry(fn, { attempts = 4 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= attempts - 1 || !isRateLimitError(err)) throw err;
      const wait = 60000 * (i + 1);
      console.error(`Rate limited; waiting ${wait / 1000}s (attempt ${i + 1}/${attempts})`);
      await sleep(wait);
    }
  }
}

/**
 * Search the issue/PR index. Returns { total_count, items } for the first
 * `maxItems` hits. Callers must treat `total_count > items.length` as a
 * truncation signal and narrow their query (e.g. split the date window).
 */
async function ghSearch(query, { token, maxItems = 1000 } = {}) {
  const items = [];
  let total = null;
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    if (page > 1) await sleep(SEARCH_INTERVAL_MS);
    const res = await withRateLimitRetry(() =>
      gh(
        `search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}&advanced_search=true`,
        token
      )
    );
    if (typeof res.total_count !== "number") {
      throw new Error(`Search response missing total_count for: ${query}`);
    }
    total = res.total_count;
    items.push(...(res.items || []));
    if (!res.items || res.items.length < 100) break;
    if (items.length >= maxItems) break;
  }
  return { total_count: total, items };
}

module.exports = { gh, ghAllPages, ghSearch, withRateLimitRetry, sleep, SEARCH_INTERVAL_MS };
