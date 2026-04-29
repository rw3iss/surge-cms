# Ryan Weiss Website

A modern, fast-loading website for Ryan Weiss' portfolio with a comprehensive admin portal.

## Table of Contents

- [Getting Started](#getting-started)
- [Administrator Guide](#administrator-guide)
  - [Accessing the Admin Portal](#accessing-the-admin-portal)
  - [Dashboard Overview](#dashboard-overview)
  - [Managing Pages](#managing-pages)
  - [Managing Posts (Blog)](#managing-posts-blog)
  - [Managing Campaigns (Donations)](#managing-campaigns-donations)
  - [Managing Forms/Questionnaires](#managing-formsquestionnaires)
  - [Managing Users](#managing-users)
  - [Viewing Contact Messages](#viewing-contact-messages)
  - [Media Library](#media-library)
  - [Site Settings](#site-settings)
- [Technical Setup](#technical-setup)

---

## Getting Started

### For Administrators

If you're an administrator looking to manage the website content, skip to the [Administrator Guide](#administrator-guide) section.

### For Developers

See the [Technical Setup](#technical-setup) section at the end of this document.

---

## Administrator Guide

### Accessing the Admin Portal

1. Navigate to `https://yoursite.com/admin` in your web browser
2. Log in with your administrator email and password
3. You'll see the Admin Dashboard with quick stats and navigation

**Note:** Only users with the "admin" role can access the admin portal. Regular users and Patreon members cannot access this area.

---

### Dashboard Overview

The Dashboard is your home base in the admin portal. It shows:

- **Total Pages**: Number of pages on your site
- **Total Posts**: Number of blog posts published
- **Active Campaigns**: Donation campaigns currently running
- **Pending Messages**: Contact form submissions awaiting review

Use the sidebar navigation on the left to access different sections.

---

### Managing Pages

Pages are the main content sections of your website (like "About Us", "Team", etc.).

#### Viewing All Pages

1. Click **"Pages"** in the sidebar
2. You'll see a table with all pages showing:
   - Title
   - URL Slug (the part after yoursite.com/)
   - Status (draft or published)

#### Creating a New Page

1. Click the **"New Page"** button
2. Fill in the page details:
   - **Title**: The page name (shown in browser tab and heading)
   - **Slug**: The URL path (e.g., "about-us" creates yoursite.com/about-us)
   - **Status**: Choose "draft" to hide or "published" to make visible

#### Editing a Page

1. Click on a page title to open the editor
2. Modify the title, slug, or status as needed
3. Click **"Save"** to apply changes

#### Working with Blocks

Pages are built using "blocks" - individual content sections. Available block types:

| Block Type | Description |
|------------|-------------|
| **Rich Text** | Formatted text content (paragraphs, headings, lists, links) |
| **Posts** | Displays a list of your blog posts |
| **Form** | Embeds a form/questionnaire |
| **Media** | Images, videos, or other media files |
| **Social Feed** | Shows posts from connected social media accounts |
| **Campaign** | Displays a donation campaign with progress |
| **HTML** | Custom HTML code (advanced users only) |

**To add a block:**
1. In the page editor, click **"Add Block"**
2. Select the block type
3. Configure the block settings
4. Drag blocks to reorder them

**To remove a block:**
1. Click the trash icon next to the block
2. Confirm deletion

---

### Managing Posts (Blog)

Posts are blog articles or news updates.

#### Viewing All Posts

1. Click **"Posts"** in the sidebar
2. You'll see a table with:
   - Title
   - Status (draft/published)
   - Category
   - Publication date

#### Creating a New Post

1. Click **"New Post"** button
2. Fill in the post details:
   - **Title**: The headline of your post
   - **Slug**: URL path (auto-generated from title, but editable)
   - **Category**: Assign to a category for organization
   - **Excerpt**: Short summary shown in post listings
   - **Content**: The main body of your post (supports rich text formatting)
   - **Featured Image**: Select from Media Library or upload new
   - **Status**: "draft" (hidden) or "published" (visible)

#### Editing a Post

1. Click on a post title to open the editor
2. Make your changes
3. Click **"Save"** or **"Publish"**

#### Post Statuses

- **Draft**: Only visible in admin, not on public site
- **Published**: Visible to all visitors
- **Archived**: Hidden from listings but accessible via direct URL

---

### Managing Campaigns (Donations)

Campaigns are fundraising initiatives displayed on the Donate page.

#### Viewing All Campaigns

1. Click **"Campaigns"** in the sidebar
2. See all campaigns with:
   - Title
   - Goal amount
   - Amount raised
   - Status

#### Creating a Campaign

1. Click **"New Campaign"**
2. Fill in campaign details:
   - **Title**: Campaign name
   - **Slug**: URL path for campaign page
   - **Description**: Explain what you're raising money for
   - **Goal Amount**: Target amount in dollars
   - **Featured Image**: Visual for the campaign
   - **Status**: "draft", "active", or "completed"

#### Understanding Campaign Stats

- **Goal**: Target amount to raise
- **Raised**: Current total from all donations
- **Progress**: Percentage of goal reached
- **Donors**: Number of people who contributed

#### How Donations Work

1. Visitors click "Donate" on a campaign
2. They enter their amount and payment details
3. Payment is processed securely via Stripe
4. The campaign total updates automatically
5. If donor chose to be public, they appear in the donor list

---

### Managing Forms/Questionnaires

Forms collect information from visitors through custom questionnaires.

#### Viewing All Forms

1. Click **"Forms"** in the sidebar
2. See forms with:
   - Title
   - Status
   - Number of submissions

#### Creating a Form

1. Click **"New Form"**
2. Set form properties:
   - **Title**: Form name
   - **Slug**: URL path (yoursite.com/forms/your-slug)
   - **Description**: Instructions for respondents
   - **Status**: "draft" or "active"

#### Adding Questions

Each form contains questions. Question types:

| Type | Use Case |
|------|----------|
| **Text** | Short answers (name, email, etc.) |
| **Textarea** | Long answers (comments, descriptions) |
| **Select** | Dropdown with predefined choices |
| **Radio** | Single choice from options |
| **Checkbox** | Multiple choices allowed |
| **Number** | Numeric values only |
| **Date** | Date picker |

**To add a question:**
1. Click **"Add Question"**
2. Enter the question text
3. Select the question type
4. If applicable, add answer options
5. Check "Required" if answer is mandatory
6. Drag to reorder questions

#### Viewing Form Submissions

1. Click on a form to open it
2. Click **"View Submissions"** tab
3. See all responses in a table format
4. Click a submission to see full details
5. Export to CSV for spreadsheet analysis

---

### Managing Users

View and manage registered users.

#### Viewing All Users

1. Click **"Users"** in the sidebar
2. See users with:
   - Email address
   - Display name
   - Role (user/admin)
   - Status (Active/Inactive/Banned)

#### User Statuses

- **Active**: Normal account in good standing
- **Inactive**: Account not yet activated or deactivated
- **Banned**: User is blocked from the site

#### Banning a User

1. Click on a user to view details
2. Click **"Ban User"**
3. Enter a reason for the ban
4. Set ban duration (temporary or permanent)
5. Click **"Confirm Ban"**

Banned users cannot log in or interact with the site.

#### Unbanning a User

1. Find the banned user
2. Click **"Unban User"**
3. Confirm the action

#### User Roles

| Role | Access Level |
|------|-------------|
| **user** | Public site only, can donate and submit forms |
| **editor** | Can manage content (pages, posts) |
| **admin** | Full access to all admin features |

---

### Viewing Contact Messages

Messages submitted through the Contact page.

#### Viewing Messages

1. Click **"Messages"** in the sidebar
2. See all messages with:
   - Sender name
   - Email address
   - Subject
   - Status
   - Date received

#### Message Statuses

- **new**: Unread message
- **read**: Message has been viewed
- **replied**: You've responded to this message
- **archived**: Stored but hidden from main list

#### Responding to Messages

1. Click on a message to read the full content
2. Note the sender's email address
3. Send your reply via your regular email client
4. Mark the message as "replied" to track your response

---

### Media Library

Store and manage images, videos, and files.

#### Viewing Media

1. Click **"Media"** in the sidebar
2. Browse all uploaded files
3. Use search to find specific files

#### Uploading Files

1. Click **"Upload"** or drag files into the media area
2. Supported formats:
   - **Images**: JPG, PNG, GIF, WebP, SVG
   - **Videos**: MP4, WebM
   - **Documents**: PDF

3. Files are automatically optimized for web

#### Using Media in Content

When editing pages or posts:
1. Click the media/image button
2. Select from existing files or upload new
3. The file is inserted into your content

#### Deleting Media

1. Select the file(s) to delete
2. Click **"Delete"**
3. Confirm deletion

**Warning:** Deleting media may break pages or posts using those files.

---

### Site Settings

Global configuration for your website.

#### Accessing Settings

1. Click **"Settings"** in the sidebar

#### Available Settings

| Setting | Description |
|---------|-------------|
| **Site Name** | Your organization name (shown in browser tab, header) |
| **Tagline** | Short description/slogan |
| **Contact Email** | Email shown on Contact page |
| **Analytics ID** | Google Analytics tracking ID |
| **Maintenance Mode** | Enable to show "Under Maintenance" message to visitors |

#### Saving Settings

1. Make your changes
2. Click **"Save Settings"**
3. Changes take effect immediately

---

### Social Media Connections

Connect your social media accounts to display recent posts on the homepage and embed individual posts in blog articles.

#### Supported Providers

| Provider | Auth Method | Cost | Token Refresh |
|----------|------------ |------|---------------|
| **Instagram** | OAuth (Meta App) | Free | Automatic (every 7 days) |
| **YouTube** | API Key | Free | None needed (key never expires) |
| **Facebook** | Page Access Token | Free | None needed (page token never expires) |
| **Twitter/X** | Bearer Token | $200/mo for read access | None needed (bearer never expires) |
| **TikTok** | OAuth | Free | Automatic (daily) |
| **Patreon** | Creator Token | Free | None needed (token never expires) |

#### Connecting Instagram (OAuth)

Instagram requires an OAuth flow through a Meta Developer App:

1. Go to [developers.facebook.com](https://developers.facebook.com) and create a Meta App (free)
2. Your Instagram account must be a **Business** or **Creator** account linked to a Facebook Page
3. In the admin portal, go to **Settings > Connections**
4. Click **Setup** on Instagram
5. Enter your Meta **App ID** and **App Secret**, then click **Save**
6. Click **Authorize Instagram** -- you'll be redirected to Facebook to approve the connection
7. Once approved, the system stores a long-lived token and automatically refreshes it every 7 days

#### Connecting API-Key Providers (YouTube, Twitter, etc.)

For providers that use static API keys or tokens:

1. Go to **Settings > Connections**
2. Click **Setup** on the provider
3. Enter the **Access Token** or **API Key** from the provider's developer portal
4. Click **Save**

#### How Social Posts Display

Social posts appear in two ways:

- **Homepage feed**: The "Follow Our Journey" section automatically shows the latest posts from all connected providers. Posts are fetched live from each provider's API and cached for 15 minutes -- no database storage required.
- **Embedded in blog posts**: When editing a blog post, add a "Social Media" content block, select a provider, and pick a specific post to embed. The post renders using the provider's native embed format (iframe).

#### Auto-Publish Setting

Each connection has an optional **Auto-publish** toggle with a post count limit. This controls how many recent posts are fetched from the provider when syncing. The admin can manually trigger a sync from the admin panel regardless of this setting.

#### Disconnecting a Provider

1. Go to **Settings > Connections**
2. Click **Disconnect** on the provider
3. Confirm -- this removes the access token and stops any automatic token refresh
4. App credentials (App ID/Secret) are preserved so you can reconnect easily

#### Developer Tools

The **Developer** section in the admin sidebar shows all registered background jobs (cron), including token refresh schedules, last run status, and next run time.

---

## Technical Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Environment Variables

Copy `.env.example` to `.env` in the backend folder and configure:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/rw

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Patreon OAuth
PATREON_CLIENT_ID=your-client-id
PATREON_CLIENT_SECRET=your-client-secret
PATREON_REDIRECT_URI=https://yoursite.com/api/auth/patreon/callback

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM=noreply@yoursite.com

# Social Media APIs (optional - can also be configured in Admin > Settings > Connections)
YOUTUBE_API_KEY=xxx
YOUTUBE_CHANNEL_ID=xxx
TWITTER_BEARER_TOKEN=xxx
TWITTER_USERNAME=xxx
FACEBOOK_APP_ID=xxx
FACEBOOK_APP_SECRET=xxx
FACEBOOK_PAGE_ID=xxx
FACEBOOK_ACCESS_TOKEN=xxx
# Instagram is configured via OAuth in the admin portal (no env vars needed)
```

### Installation

The recommended path is the **first-run setup wizard**: start the app with no config, open `/setup`, and the wizard handles env, migrations, seed, and admin creation in one go.

```bash
# 1. Install dependencies
npm install

# 2. Make sure PostgreSQL is reachable (locally, via Docker, or hosted).
#    The wizard can either use an existing database or create one for you
#    (the latter requires superuser credentials, used only during install).

# 3. Start the dev servers — no .env required for first boot.
npm run dev
```

Then open <http://localhost:3000/setup>. The wizard will:

1. Detect what's already configured (DB, Redis, JWT secret, admin user).
2. Walk you through General, Database, Admin user, Redis, Storage, Security, and Email sections.
3. Validate each input live ("Test connection" buttons for DB / Redis / SMTP / S3).
4. On submit: run migrations, seed default settings, create the admin user (if requested), and atomically write a `.env`.
5. Restart the backend so the new config takes effect, then redirect you to `/admin/login`.

If you prefer manual install (CI / scripted deploys), copy `.env.example` to `.env`, fill in values, then:

```bash
npm run db:migrate -w backend
npm run db:seed -w backend       # demo content: add --demo
npm run dev
```

### Building for Production

```bash
# Build all packages
npm run build

# Start production server
npm start -w backend
```

### Project Structure

```
rw-cms/
├── frontend/          # SolidJS frontend application
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API client
│   │   ├── stores/      # State management
│   │   └── styles/      # SCSS stylesheets
│   └── vite.config.ts
├── backend/           # Express.js API server
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Business logic
│   │   ├── middleware/  # Auth, error handling
│   │   └── db/          # Database schema & queries
│   └── package.json
└── shared/            # Shared TypeScript types
    └── src/types/
```

### Deployment

The frontend builds to static files suitable for CDN hosting (CloudFront, Netlify, Vercel).

The backend requires a Node.js hosting environment with PostgreSQL and Redis access.

---

## Support

For technical issues, contact your development team.

For content questions, refer to this guide or reach out to a fellow administrator.
