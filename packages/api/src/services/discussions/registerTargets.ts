/**
 * Side-effect imports: each feature's comment targets register themselves.
 * Add one line per feature that attaches comments to something.
 */
import '../comments/targets';
// Comments: reply emails + staff notifications.
import '../comments/notify';
// Discovery: anonymous-feed cache listener + read-only comment/forum_thread entity types.
import './discovery';
import '../forum/targets';
import '../forum/notify';
// Gallery: comments on gallery items + the read-only gallery_item entity type.
import '../gallery/targets';
import '../gallery/entity';
