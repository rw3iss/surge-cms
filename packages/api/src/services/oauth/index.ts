import { ValidationError, } from '../../core/errors';
import { GoogleYouTubeOAuthProvider, } from './google';
import { InstagramOAuthProvider, } from './instagram';
import { ThreadsOAuthProvider, } from './threads';
import { TikTokBusinessOAuthProvider, TikTokOAuthProvider, } from './tiktok';
import type { OAuthProvider, OAuthProviderOptions, } from './types';

export type { OAuthProvider, OAuthProviderOptions, OAuthTokenResult, OAuthUserInfo, } from './types';

/** The connection row's saved credentials (appId/appSecret + anything else). */
type OAuthCredentials = Record<string, unknown> & { appId?: unknown; appSecret?: unknown; };

/**
 * Provider registry (Open/Closed): maps a provider key to a factory that
 * builds its `OAuthProvider`. Registering a new provider is one entry here —
 * `getOAuthProvider`/`isOAuthProvider` stay closed for modification.
 */
type OAuthProviderFactory = (credentials: OAuthCredentials, redirectUri: string,) => OAuthProvider & OAuthProviderOptions;
const id = (v: unknown,): string => String(v ?? '',);

const OAUTH_PROVIDERS: Record<string, OAuthProviderFactory> = {
    instagram: (credentials, redirectUri,) =>
        new InstagramOAuthProvider({
            appId: id(credentials.appId,),
            appSecret: id(credentials.appSecret,),
            redirectUri,
        },),
    // "Sign in with Google" for the YouTube connection: appId/appSecret hold the
    // Google OAuth client id/secret. Optional — an API key alone still works.
    youtube: (credentials, redirectUri,) =>
        new GoogleYouTubeOAuthProvider({
            clientId: id(credentials.appId,),
            clientSecret: id(credentials.appSecret,),
            redirectUri,
        },),
    // Threads: analytics-only connection (threads_basic + threads_manage_insights).
    threads: (credentials, redirectUri,) =>
        new ThreadsOAuthProvider({
            appId: id(credentials.appId,),
            appSecret: id(credentials.appSecret,),
            redirectUri,
        },),
    // TikTok Login Kit (Display API, basic analytics): appId/appSecret = Client key / Client secret.
    tiktok: (credentials, redirectUri,) =>
        new TikTokOAuthProvider({ appId: id(credentials.appId,), appSecret: id(credentials.appSecret,), redirectUri, },),
    // TikTok API for Business "Accounts" (upgraded analytics): a SECOND sign-in stored on the
    // 'tiktok' row, with its own app (businessAppId/businessAppSecret) and optional pasted authorize URL.
    tiktok_business: (credentials, redirectUri,) =>
        new TikTokBusinessOAuthProvider({
            appId: id(credentials.businessAppId,),
            appSecret: id(credentials.businessAppSecret,),
            authUrl: typeof credentials.businessAuthUrl === 'string' ? credentials.businessAuthUrl : null,
            redirectUri,
        },),
};

/** OAuth keys that store into ANOTHER connection row (a second sign-in on one connection). */
const OAUTH_CONNECTION: Record<string, string> = { tiktok_business: 'tiktok', };

/** The social_connections row an OAuth provider key reads and writes. */
export function oauthConnection(provider: string,): string {
    return OAUTH_CONNECTION[provider] ?? provider;
}

/** The app id/secret an OAuth provider uses from the row's credentials (null = not saved). */
export function oauthAppCredentials(provider: string, credentials: OAuthCredentials | null | undefined,): { appId: string; appSecret: string; } | null {
    if (!credentials) return null;
    const keys = provider === 'tiktok_business' ? ['businessAppId', 'businessAppSecret',] : ['appId', 'appSecret',];
    const appId = id(credentials[keys[0]],).trim();
    const appSecret = id(credentials[keys[1]],).trim();
    return appId && appSecret ? { appId, appSecret, } : null;
}

export function isOAuthProvider(provider: string,): boolean {
    return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, provider,);
}

export function getOAuthProvider(
    provider: string,
    credentials: OAuthCredentials,
    redirectUri: string,
): OAuthProvider & OAuthProviderOptions {
    const factory = OAUTH_PROVIDERS[provider];
    if (!factory) {
        throw new ValidationError(`OAuth provider "${provider}" is not supported`,);
    }
    return factory(credentials, redirectUri,);
}
