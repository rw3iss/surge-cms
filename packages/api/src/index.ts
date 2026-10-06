/**
 * Runnable entry for the Surge CMS server (`node dist/index.js`).
 *
 * Used by the systemd unit, the Docker image, and `pnpm start`. It's a thin
 * wrapper — all boot logic + the embeddable API live in `./lib`
 * (`@sitesurge/server`), so importing the package does NOT auto-start a server.
 */
import { startServer, } from './lib';
import { logger, } from './utils/logger';

startServer().catch((error,) => {
    logger.error('Failed to start server', { error, },);
    process.exit(1,);
},);
