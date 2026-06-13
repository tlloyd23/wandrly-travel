export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.UNSPLASH_ACCESS_KEY) {
    return res.status(200).json({ photo: null });
  }

  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
    );

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      return res.status(200).json({
        photo: {
          url: result.urls.small,
          credit: result.user.name,
          link: result.user.links.html
        }
      });
    }

    return res.status(200).json({ photo: null });

  } catch (err) {
    return res.status(200).json({ photo: null });
  }
}
