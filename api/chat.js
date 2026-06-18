export const config = {
  maxDuration: 30,
};

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
    return { allowed: true, remaining: REQUESTS_PER_DAY - 1 };
  }

  if (record.count >= REQUESTS_PER_DAY) {
    const resetIn = Math.ceil((MS_PER_DAY - (now - record.windowStart)) / 1000 / 60 / 60);
    return { allowed: false, resetIn };
  }

  record.count++;
  return { allowed: true, remaining: REQUESTS_PER_DAY - record.count };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getRateLimitKey(req);
  const limit = checkRateLimit(ip);

  if (!limit.allowed) {
    return res.status(429).json({
      error: `Daily limit reached. You can search ${REQUESTS_PER_DAY} trips per day. Resets in ${limit.resetIn} hour${limit.resetIn !== 1 ? 's' : ''}.`
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      const message = (data.error && data.error.message) || 'The AI service returned an error.';
      return res.status(response.status).json({ error: message });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
