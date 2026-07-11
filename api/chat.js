export const config = { maxDuration: 60 };

const rateLimit = new Map();
const REQUESTS_PER_DAY = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getRateLimitKey(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.headers['x-real-ip']
    || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimit.get(ip);
  if (!record || now - record.windowStart > MS_PER_DAY) {
    rateLimit.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (record.count >= REQUESTS_PER_DAY) {
    const resetIn = Math.ceil((MS_PER_DAY - (now - record.windowStart)) / 1000 / 60 / 60);
    return { allowed: false, resetIn };
  }
  record.count++;
  return { allowed: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getRateLimitKey(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return res.status(429).json({
      error: `Daily limit reached. Resets in ${limit.resetIn} hour${limit.resetIn !== 1 ? 's' : ''}.`
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  // Abort the upstream call a little before Vercel's maxDuration so we can
  // always return a clean JSON error instead of a hard function timeout.
  // NOTE: maxDuration (see config above and vercel.json) only takes effect on
  // Vercel Pro. On the free Hobby plan functions are capped at ~10s, so if you
  // see 504s on Hobby, either upgrade to Pro or keep generations small/fast.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      // Surface the real Anthropic error so the client can show something useful
      // (e.g. an invalid model name, which is a common cause of failures).
      const message = (data && data.error && data.error.message) || 'The AI service returned an error.';
      return res.status(response.status).json({ error: message });
    }

    return res.status(200).json(data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'The AI took too long to respond. Please try again.' });
    }
    return res.status(500).json({ error: 'Something went wrong reaching the AI. Please try again.' });
  } finally {
    clearTimeout(timeoutId);
  }
}
