

Provider hookup:

Here's the full breakdown:

Per-Provider Requirements

YouTube — Easiest

- API Key only (no OAuth needed for public videos)
- Key never expires, no refresh needed
- Free (10,000 quota units/day)
- Already working in your codebase via YOUTUBE_API_KEY

Patreon — Easy

- Creator Access Token from your API client settings — never expires
- No OAuth needed for pulling your own creator posts
- Free
- Already working in your codebase via PATREON_CREATOR_ACCESS_TOKEN

Facebook — Easy once set up

- OAuth login once → get a Page Access Token
- Page token derived from a long-lived user token never expires (as long as user stays page admin)
- Free, requires Meta App + App Review
- Already built in codebase, just using a static token

Instagram — Needs token refresh

- Same Meta App as Facebook, OAuth login required
- Long-lived token: 60 days, refreshable indefinitely
- Needs a refresh cron (run every ~50 days)
- Free, account must be Business/Creator + linked to a Facebook Page
- Already built in codebase, but no refresh logic

TikTok — Needs token refresh

- OAuth login required, access token expires in 24 hours
- Refresh token lasts 365 days
- Needs a daily refresh cron
- Free, but app approval from TikTok can take days/weeks
- Not implemented in your codebase yet

Twitter/X — Costs money

- $200/month minimum for read access (Free tier is write-only)
- Bearer token never expires (sufficient for public tweets)
- Already built in codebase via TWITTER_BEARER_TOKEN
- The real question: is it worth $200/mo?
* Instead: We will have to manually "post" the X posts on the site, using the URL.


Summary

┌───────────┬─────────┬────────────────────┬────────────────┬──────────────────────┐
│ Platform  │  Cost   │     Auth Type      │ Token Expires? │ Auto-Refresh Needed? │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ YouTube   │ Free    │ API Key            │ Never          │ No                   │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ Patreon   │ Free    │ Creator Token      │ Never          │ No                   │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ Facebook  │ Free    │ OAuth → Page Token │ Never          │ No                   │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ Instagram │ Free    │ OAuth              │ 60 days        │ Yes (~monthly)       │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ TikTok    │ Free    │ OAuth              │ 24 hours       │ Yes (daily)          │
├───────────┼─────────┼────────────────────┼────────────────┼──────────────────────┤
│ X/Twitter │ $200/mo │ Bearer Token       │ Never          │ No                   │
└───────────┴─────────┴────────────────────┴────────────────┴──────────────────────┘

Bottom line: Only Instagram and TikTok need refresh logic. YouTube, Patreon, Facebook, and Twitter all use tokens that effectively never expire. The only provider that costs money is X/Twitter.