RW Philly
https://ryanweiss.net/



embed instagram

clothing -> linked to shopify

release written content and articles

patreon (subscribe)

about section
	- about us

--------------------------------------------------------------------------------

Content previews from our social media accounts where people can view our shorts without leaving the site.
- Shouldn't be too hard. I need:  all of the social media outlets you will use (ie. Facebook and Instagram, or others? I don't need access or anything, just need to know which. Page links will help later, but don't need them now so much).
Allow Patreon members to view exclusive content without leaving the site.
- Hmm, can most likely do this, but have to see how Patreon treats the session/user data. Normally this will require some connection (either your users will need to 'login through patreon' from your site, or they will need to be logged into the same "Google" or other SSO account on both sites). Let me know if you have any other info in that regard, but I will look into it. Seems wordpress handles it automatically through a plugin, so I will see how they do it.
Seamless form integration that we could connect with a CRM like Groundhogg and GiveButter so that we can stay on top of outreach as things start to pick up.
- K, yeah we can integrate forms somehow. I will look into those two, haven't used them before.
A design that helps with brand legitimacy.
- I don't want to call myself a designer, but I can probably design better than a lot of people, though I just get caught up in it (too much time), heh. However, I have a good design eye, and can make the site responsive/look good on mobile etc. if you have specific ideas or directions, feel free to compile and shoot them over.
SEO optimization so that we come up high in the search engines and to have it where people can click on multiple pages not just the homepage from the search engine.
- Easy enough.

--------------------------------------------------------------------------------

# AI:

Admin login:

Email: admin@ryanweiss.net
Password: ChangeThisPassword123!


--------------------------------------------------------------------------------

# AI TODO:

* ABOUT PAGE:
- Pull content from the existing rw website: https://ryanweiss.net/

--------------------------------------------------------------------------------

I need you to help scaffold out and build a new website for a small news organization. It will be a refactor of their current website at: https://ryanweiss.net/
The frontend will display essentially blog posts, and other media from third party outlets that we will hook up, such as Patreon, YouTube, Instagram, Facebook, X, and others.
Users of the site will sign in with the Patreon SSO module in order to retrieve private content. We will use the Patreon user base as our own user base, for any backend functionality that will require authentication.
If users are not logged in through Patreon, we will consider them anonymous. There will also be administrators that will administer the content through this site.

Here is the technical stack I would like you to create for me:

# Frontend:
- The frontend client should be written in SolidJS, and employ an optimally designed implementation so that the site will load immediately with an app shell as PWA, with initial CSS, and then dynamically load the site's content and data thereafter, as a modern web application.
- The client will be served as a static bundle, and hosted on a CDN (such as CloudFront).
- The client should integrate and use all possible means for optimal SEO, so that all content and pages will be able to be indexed as best as possible, using all modern SEO techniques. This is important.
- As mentioned, the client needs to rely on a user system that is authenticated through Patreon, using an API key we will create. The frontend and backend should be well-architected enough to support the user system based around Patreon.
- There will also be an admin portion of the website, where Patreon users who are classified as admins (or otherwise through some special login or flag) can access to manage some content. I will explain the design for the admin pages later, but for now they can sit at a /admin route, which should only allow administrators to see. If a user is not an adminstrator, but they are logged in, it should show an error.
- If users try to access private pages, and they are not logged in, it should forward them to the /login page, and redirect them back to the private page after the login.
- The frontend /login page should allow logging in through Patreon, or a static email or password for some special users (such as administrators that don't work directly with patreon). We can keep track of users in a backend database if need be.
- The frontend needs to be absolutely responsive, so that it looks perfect on all environments: desktop, mobile, and tablets.
- The frontend should utilize SCSS for styles, external to the JSX components.
- The frontend homepage and navigation bar should dynamically pull its content from the backend as described below, so that administrators can customize the content there, and the frontend should pick it up.
- The frontend should utilize caching if possible, as well as the backend.
- There should be a page for users to 'donate'. The donation page should list all current Campaigns for the site (that are live/published). There should also be an option to see past campaigns. Each campaign should be clickable to load a larger page explaining the campaign, and see the breakdown of it, including: title, description, monetary goal (with a graph showing the progress towards it), and a list of all users that have donated, including any messages they might have submitted for that campaign. Users should be able to donate to individual campaigns, or make a general donation without any specific campaign. They should also be able to select optionally whether to show their name in the donations list, or show it as anonymous, or not at all. The donations feature should utilize a third party donations service to submit payments to the website. Our backend can handle allocating the funds to the specific campaigns (it should insert them to the donations table), but the actual payment processing can be handled by a third party such as Stripe, or something simpler if you are aware of any that would be better designed for this purpose, but still allow us the flexibility of managing the custom campaigns and all.

# Admin Portal:
- The /admin portal should offer a place for administrators to manage the content. It should include multiple pages for the content, including:
	- A page to manage Homepage content:
		- This page should allow the admins to select from the connected platforms (ie. Facebook, Instagram, X, Youtube, etc), and then select content from those platforms to be shown on the homepage in a specific order.
	- There should be a 'Pages' page to otherwise create and manage all pages on the site. The page should list all existing pages, including the Homepage, and the "About" page, or any other custom page. Their should be options to toggle whether any of these pages should show in the navigation bar, or if they should be public or private (requiring users be authenticated).
		- The admin should be able to click on a page to edit it's settings and content. When editing a page, it should show a list of "blocks" of dynamic content, which can be added, edited, hidden/disabled, or sorted. The admin should be able to edit any block, which will show a rich text editor to edit the content for that block, as well as upload media (images, videos) to be inserted into the block's content. Blocks should also be able to reference custom "posts" (ie. their can be a block "type" which is "post", and then a search bar to search for a post to use in that block, and the frontend can render the post on the page).
		- Besides blocks being actual custom content, or a reference to a "post", they should also be able to reference other types of content, such as "forms". If a block references a published form (see below), then it will render that form in place in the block, for that current page, so that users can submit the form questions.
	- There should be a page to create new "posts" (similar to blog posts), as previously described, so that custom content can be published. The posts can include the block-editing, and also have the ability to upload media and customize the text. Posts will be referenced from the "blocks" on the other custom pages in the Page Editor.
	- There should be a page to see and manage all users, their memberships, and any other relevant user information for them, including searching, and also the ability to ban or disable users of a specific email address, or IP address (in a users_banned table).
	- There should be a page to manage Campaigns for donations. Campaigns can be created with a monetary goal, and users can contribute donations to a specific campaign, or donate to the general pool. The admins should be able to define the campaigns name, a description, the monetary goal, and an option to publish or unpublish it (ie. make it live/acceptable, or not). The main campaigns admin page should show a "Total" contibutions for all campaigns (including non-categorized), or show a filter to show donations for specific campaigns.
	- An admin page to see all message submissions that users will submit. The message submissions will get emailed to the site administrators, but there should also be a page to see all of the messages in a list, including the user's information or other details.
	- There needs to be a page to manage "Forms", which will be questionnaires for users to answer. The forms page should allow for creation of questions, and then selections of answers. Each questions should define a type, including: radio-button type of lists with specific answers to choose from, or a single-line input answer, or a text-area answer input. The admin should be able to create a new form and add any number of questions to them. The forms should also have the ability to be 'published' or unpublished. Published forms will be able to be linked to so users can submit and answer them. Forms should also have an option to 'show results' or not. If the forms allows showing the results, then on the frontend client users will be able to see the results of the form in the page (ie. for polls). When an adminstrator is viewing a form in the admin page, they should be able to see all of the results and form submissions, if there are any for the current form they are looking at.

# Backend:
- The backend should handle any necessary requests for the frontend, however most of the data will be pulled from the client directly from the third party services. The backend needs to be able to handle adminstrative actions and content management. The frontend will expose pages and methods to organize and manage the content, and the backend can keep track of it in a database, allowing for searchability.
- The backend database should utilize postgres, and include tables for custom content posts, including the ability to handle referencs to files or other links in a related way.
- The backend should also be able to handle file uploads from the administrators, so they can attach files to certain custom content pieces. The file uploads will be associated with block content on the various pages.
- The backend should utilize a caching layer so that the content can be compiled and cached, and returned as fast as possible for users. For example, if adminstrators change any of the content on any pages, those pages should be cache-busted, and the data refetched for them.
- Their should be endpoints to search all content, including the posts, blocks, users, campaigns, and anything else.
- Design all backend tables needed for the site's custom content, including the pages, blocks, posts, users, campaigns, campaign donations/submissions, forms, form submissions/answers, contact messages, and anything else necessary for the site to operate smoothly and be flexible and extensible. For any complicated or custom data models (ie. form submissions/answers), you can store the content as a JSON blob. Otherwise, create strict types for the data models.


Go ahead and take your time to architect all of that inside of this folder, without skipping any of it (pay attention to details). You can fill in missing pieces or better design the components as needed, as you see fit, however ensure all of the requirements are basically met. Use modern best practices, separate the backend and frontend into separate folders, as well as anything else, and keep all of the code clean, well-organized, and architected using SOLID principles and best practices. Implement all code in modern TypeScript.
Be sure to create a readme on how to operate any of the sections for administrators, so I can show the readme to non-developers on how to use the site.
The site should be as secure as possible, and not expose any sensitive data to potential hackers.

Any configuration variables, such as the various social media accounts, the Patreon api key, etc, should be extracted to configuration files so that non-developers can edit them easily.

--------------------------------------------------------------------------------



## Other services to research for me, and provide analysis of which would be the best to integrate into this website for a modern application:
- form integrations + ability to create/edit them, and see results.
- donations (third party) - ability for users to submit a donation, add a message, optionally be show on the website in a donors list. Ability to add 'goals' or pools of causes, and see their progress. Users can allocate their money to a specific pool.

