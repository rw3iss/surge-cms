import { logger, } from '../../utils/logger';
import type { OAuthProvider, OAuthTokenResult, OAuthUserInfo, } from './types';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface InstagramConfig {
    appId: string;
    appSecret: string;
    redirectUri: string;
}

export class InstagramOAuthProvider implements OAuthProvider {
    constructor(private config: InstagramConfig,) {}

    getAuthorizationUrl(state: string,): string {
        const params = new URLSearchParams({
            client_id: this.config.appId,
            redirect_uri: this.config.redirectUri,
            scope: 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement',
            response_type: 'code',
            state,
        },);

        return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
    }

    async exchangeCode(code: string,): Promise<OAuthTokenResult> {
        // Step 1: Exchange code for short-lived token
        const shortTokenRes = await fetch(`${GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
            client_id: this.config.appId,
            client_secret: this.config.appSecret,
            redirect_uri: this.config.redirectUri,
            code,
        },),);

        if (!shortTokenRes.ok) {
            const err = await shortTokenRes.json() as any;
            logger.error('Instagram code exchange failed', { error: err, },);
            throw new Error(err?.error?.message || 'Failed to exchange authorization code',);
        }

        const shortTokenData = await shortTokenRes.json() as {
            access_token: string;
            token_type: string;
        };

        // Step 2: Exchange short-lived token for long-lived token (60 days)
        const longTokenRes = await fetch(`${GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: this.config.appId,
            client_secret: this.config.appSecret,
            fb_exchange_token: shortTokenData.access_token,
        },),);

        if (!longTokenRes.ok) {
            const err = await longTokenRes.json() as any;
            logger.error('Instagram long-lived token exchange failed', { error: err, },);
            throw new Error(err?.error?.message || 'Failed to exchange for long-lived token',);
        }

        const longTokenData = await longTokenRes.json() as {
            access_token: string;
            token_type: string;
            expires_in: number;
        };

        return {
            accessToken: longTokenData.access_token,
            expiresIn: longTokenData.expires_in,
            tokenType: longTokenData.token_type,
            rawData: longTokenData as unknown as Record<string, unknown>,
        };
    }

    async getUserInfo(accessToken: string,): Promise<OAuthUserInfo> {
        // Step 1: Get Facebook Pages the user manages
        const pagesRes = await fetch(
            `${GRAPH_BASE}/me/accounts?access_token=${accessToken}`,
        );

        if (!pagesRes.ok) {
            const err = await pagesRes.json() as any;
            throw new Error(err?.error?.message || 'Failed to fetch Facebook pages',);
        }

        const pagesData = await pagesRes.json() as {
            data: Array<{ id: string; name: string; access_token: string; }>;
        };

        if (!pagesData.data?.length) {
            throw new Error('No Facebook Pages found. Instagram Business accounts must be linked to a Facebook Page.',);
        }

        // Step 2: Find which page has an Instagram Business Account
        for (const page of pagesData.data) {
            const igRes = await fetch(
                `${GRAPH_BASE}/${page.id}?fields=instagram_business_account&access_token=${accessToken}`,
            );

            if (!igRes.ok) continue;

            const igData = await igRes.json() as {
                instagram_business_account?: { id: string; };
            };

            if (igData.instagram_business_account?.id) {
                const igAccountId = igData.instagram_business_account.id;

                // Step 3: Get Instagram account info
                const profileRes = await fetch(
                    `${GRAPH_BASE}/${igAccountId}?fields=id,username,profile_picture_url,name&access_token=${accessToken}`,
                );

                if (!profileRes.ok) {
                    const err = await profileRes.json() as any;
                    throw new Error(err?.error?.message || 'Failed to fetch Instagram profile',);
                }

                const profile = await profileRes.json() as {
                    id: string;
                    username?: string;
                    name?: string;
                    profile_picture_url?: string;
                };

                return {
                    accountId: igAccountId,
                    displayName: profile.username || profile.name || igAccountId,
                    avatarUrl: profile.profile_picture_url,
                    rawData: { pageId: page.id, pageName: page.name, ...profile, },
                };
            }
        }

        throw new Error(
            'No Instagram Business Account found linked to your Facebook Pages. ' +
            'Make sure your Instagram account is a Business or Creator account connected to a Facebook Page.',
        );
    }

    async refreshToken(currentToken: string,): Promise<OAuthTokenResult | null> {
        const res = await fetch(
            `${GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
                grant_type: 'fb_exchange_token',
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                fb_exchange_token: currentToken,
            },),
        );

        if (!res.ok) {
            const err = await res.json() as any;
            logger.error('Instagram token refresh failed', { error: err, },);
            throw new Error(err?.error?.message || 'Token refresh failed',);
        }

        const data = await res.json() as {
            access_token: string;
            token_type: string;
            expires_in: number;
        };

        return {
            accessToken: data.access_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type,
            rawData: data as unknown as Record<string, unknown>,
        };
    }
}
