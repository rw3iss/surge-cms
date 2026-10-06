/**
 * Minimal headless Surge CMS consumer.
 *
 *   CMS_URL=https://cms.example.com CMS_KEY=ssk_… npm start
 *
 * Issue a scoped read key in the admin: Settings → API Keys.
 */
import { createClient } from '@sitesurge/client';
import type { Post } from '@sitesurge/types';

const cms = createClient({
  baseUrl: process.env.CMS_URL ?? 'http://localhost:3001',
  auth: process.env.CMS_KEY ? { apiKey: process.env.CMS_KEY } : { mode: 'cookie' },
});

// Paginated list → { data, meta }. Single-entity GETs return the entity directly.
const { data: posts, meta } = await cms.posts.list({ limit: 10 });

console.log(`${meta.total} posts total — latest ${posts.length}:`);
for (const post of posts as Post[]) {
  console.log(`  • ${post.title}  (/posts/${post.slug})`);
}

// Fetch one by slug:
if (posts[0]) {
  const full = await cms.posts.getBySlug(posts[0].slug);
  console.log(`\nFirst post has ${full.contentBlocks?.length ?? 0} content blocks.`);
}
