Ok, let's make some more changes:

The Pages list page, edit page, and the Posts list and edit page, and the Messages, Media, and Settings pages ... and any list or edit page, should be styled nicely, similar to how the Campaigns and Forms list pages and edit forms are styled.
All list pages and edit pages should share the same styling for any layout, lists, inputs, etc. Everything should be uniform.
The styles should be abstracted cleanly so they can be edited, and will be reflected on all pages.

There should also be a new section called "Connections" which lists out any third party social connections that the site will use, ie. for Instagram, or Facebook, or TikTok, or Patreon, etc.
The connections page should list out all available connection providers (including those four to begin with). If a provider is not connected, it should show a button to 'connect' it, and when clicked should open the edit form to connect the provider using that providers means to do so (ie. opening a popup to connect, or entering API credentials, etc).

There can be separate or unique configuration classes for each, but they should share the same or similar functionality for connecting or editing them.
If a provider is connected, there should be options to 'edit' the provider, or disconnect it. If editing it, it should allow the user to enable or disable the provider (but keep it connected), or edit other properties or options for the provider. This same edit form can be used on the Connect page as well, or they can be the same page (show the connect option, with disconnect option, and edit options).

There should be options to "automatically publish" an "X" amount of recent posts from the provider, or a checkbox to "publish all" posts from that provider.
If those options are enabled, later we will design a page that will automatically pull in the posts from any of the connected providers, to show on some page as normal posts.
The Connections list page should also allow the providers to be sorted, so more prominent or important providers will be viewed first when reading the posts elsewhere.

Currently there is also a bug in the Posts list page, where it doesn't automatically pull in or read the existing posts. It only shows the list after I add a new post.

On the Posts edit page, when editing a post, let's change how the user edits content blocks, and adds social media provider posts to the currently edited RW post.

I would like the user to be able to add an infinite number of "blocks" of content.
So change the Content input textarea to text that says "Add" with a dropdown next to it, that allows the user to select what kind of content they want to add.
When the user selects a specific type of content to add, it should add a new block on the page, in a list that is sortable (the content blocks should be able to dragged up and down in the list, with overlay animations or highlights signifying the movement as they drag).
The different types of input blocks should render custom components for each type of content.
The "Add <type>" button should stay at the bottom of the list of content blocks, so the user can continue to add content.
Each block that is added should include the edit form for that content type, as well as a button to 'Save' the content (or cancel to remove it). The block should be in edit mode when it is first added.
If the content is saved for that block, the form should go from edit mode to view mode, and the Save button should turn into an 'edit' button, also with a trashcan icon button next to it that deleted that block after confirming in a modal.

This dropdown of content types should include these options and edit components for each type:
* "Text Content" - show a text area to enter static content (ie. like the textarea is now, just not as big).
* "Social Media Post" - when selected, add an area which shows a dropdown to select from the connected providers (created above), with the 'Save' button displaying 'Add' text instead. When a provider is selected, it should render a horizontal grid of recently published items from that provider's account or social media page, using the abstracted connected provider classeto retrieve the content using the connected credentials. The user should be able to select (highlight) a given post. If the user reaches the end of the scrollable row, there should be a button to 'load more' which will fetch the next set of posts from the provider (ie. 10 at a time).
Once a post is selected, the 'Add' button should link that post as a new block content item, with its associated metadata (ie. url) connected to it. The Social Media block should go from edit mode to view mode, when added, and show the post and its media in the list of content blocks for this RW Post.
There should also be options in the 'Social Media Post' edit form to 'display comments' as well, for that post, which should later trigger loading of the comments to be displayed on this Page.
* "Image" - show an edit form to selet an image to upload, then when clicking the 'Save' button, it should show the image inline. This edit form should also include options for a maximum width and height for displaying the image.
* "Video" - show an edit form to select a video to upload, then when clicking the 'Save' button, it should show the video inline. This edit form should also include options for a maximum width and height for displaying the video, as well as options to autoplay it, and also to play it on repeat when it finished playing.
* "Document" - show an edit form to select a document to upload, which can be any arbitrary file. When Added, the file name and a url to it should render, as well as an icon representing the file type, and also metadata showing the size of the file.
* "URL Link" - show an edit form to enter a url of an external link, which when entered, should try to request the url metadata, and render a preview for it on the block content.

Whenever a new content block is added, it should create a piece of data that contains all necessary information and metadata to store, render, preview, or download the media, that will then get added to our backend for the RW post's list of content blocks. The backend Posts table needs to be modified to support a one-to-many relationship of the post to any number of content blocks, so be sure to add a new post_content table that can handle that, and accepts any arbitrary json for the different types of content blocks, as well as indexes and columns for any important metadata to reference the posts or its data when searching or sorting (ie. added/modified date, etc).

The content blocks need to be sortable as well, so be sure to include and manage the sorting index for the content blocks.
Editing a content block should turn the read view of that block into the edit view again, and allow for updating the content. All blocks should also include a trashcan icon to delete that block upon confirmation.

When the user is finished editing or adding content, they should click the 'Save' button for the post to commit the new set of content blocks to the backend.