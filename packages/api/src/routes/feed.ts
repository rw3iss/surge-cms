/**
 * RSS 2.0 feed of recent published posts.
 *
 * Mounted at `/feed.xml` and `/api/v1/feed.xml` (app.ts). The XML build
 * + Redis cache live in `services/feed.ts`; this route is a thin raw
 * responder that owns the `application/rss+xml` Content-Type and bytes.
 */
import { defineRoute, } from '../api/defineRoute';
import { EMPTY_FEED_XML, getFeedXml, } from '../services/feed';
import { logger, } from '../utils/logger';

export const feedRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'public', raw: true,
        summary: 'RSS 2.0 feed (application/rss+xml) of recent published posts.',
        handler: async ({ res, },) => {
            try {
                const xml = await getFeedXml();
                res.set('Content-Type', 'application/rss+xml; charset=utf-8',);
                res.send(xml,);
            } catch (error) {
                logger.error('Error generating RSS feed', { error, },);
                // Empty-but-valid feed on error so aggregators don't
                // blacklist the URL during a transient DB outage.
                res.status(500,).set('Content-Type', 'application/rss+xml; charset=utf-8',).send(EMPTY_FEED_XML,);
            }
        },
    },),
];
