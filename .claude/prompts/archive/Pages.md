
I'd like to add the ability to 'preview' posts and pages, showing the current UNSAVED changes on a page or post edit page.
This 'Preview Changes' button should show in the upper right, to the left of the 'View Page' button, and only show if there are unsaved changes, or if the post or page is in
'draft' mode. The 'View Page' or 'View Post' buttons should only show if the post or page is 'published'.

Ideally the preview would open the page in a kind of 'draft' mode, with the temporary new settings, but I can't think of an efficient way to do this without saving the draft or
record data somewhere on the backend, for the preview links to utilize.
Otherwise, do you think it's worthwhile to create a simple 'Page Preview' (and similar 'Post Preview') components, which can just receive all of current (edited) page or post
data, and then render out the actual Post's page, or Page's page, as if it were live, somewhere in a site route, or otherwise custom overlay? The page or preview component needs
to receive the data. It can either load the page component itself, and have it load in the data through some other 'preview means' (ie. pass it through local storage or something,
 as the data source), or it can just separate the page or post rendering logic to a centralized place, and use it on both the page live views, given a block of data or property
objects, as well as in these preview site overlays, given the same blocks of data, or props.

Can you design some kind of preview mechanism that will let us preview unsaved/edited post or pages, using all of the existing content on that post or page's edit page, including
the block content that is saved in the draft on that page as well? Ideally we could share code, and use the same components or rendering mechanisms on the live main site output
rendering for those same pages.
The preview components, or overlays, when opened, should open the entire site shell, including the site header, etc, as if the user was viewing the main site on that page, but
just loaded with the unsaved data changes the user wants to preview on it. The preview should incude a 'close' button overlay in the upper right, which should exit the page or
post preview, and show the edit page again.

Perhaps there could be a custom /preview route, as a subroute to the edit pages, so I could link to it, and it should then open that page in the preview overlay automatically,
with it's existing data, ie:
http://127.0.0.1:3000/admin/pages/1bfa1c5f-d3e9-41b3-bdcb-77c91c05c937/preview

When clicking the 'Preview Page' or "Preview Post" buttons, the url should change to that, the preview overlay should open, showing the page in the wrapped site components, and
include the close button to exist the preview in the upper right, which when clicked, should change the url back to
http://127.0.0.1:3000/admin/pages/1bfa1c5f-d3e9-41b3-bdcb-77c91c05c937

The background edit page should not change or leave the view... it should retain it's state as the user is previewing its changes.

Can you implement that preview functionality for both the Edit Page, and the Edit Post pages, for Posts and Pages, just the same?