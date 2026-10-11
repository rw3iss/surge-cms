import { ValidationError, } from '../../core/errors';
import { GoogleYouTubeOAuthProvider, } from './google';
import { InstagramOAuthProvider, } from './instagram';
import type { OAuthProvider, } from './types';

export type { OAuthProvider, OAuthTokenResult, OAuthUserInfo, } from './types';

interface OAuthCredentials {
    appId: string;
    appSecret: string;
}

/**
 * Provider registry (Open/Closed): maps a provider key to a factory that
 * builds its `OAuthProvider`. Registering a new provider is one entry here —
 * `getOAuthProvider`/`isOAuthProvider` stay closed for modification.
 */
type OAuthProviderFactory = (credentials: OAuthCredentials, redirectUri: string,) => OAuthProvider;

const OAUTH_PROVIDERS: Record<string, OAuthProviderFactory> = {
    instagram: (credentials, redirectUri,) =>
        new InstagramOAuthProvider({
            appId: credentials.appId,
            appSecret: credentials.appSecret,
            redirectUri,
        },),
    // "Sign in with Google" for the YouTube connection: appId/appSecret hold the
    // Google OAuth client id/secret. Optional — an API key alone still works.
    youtube: (credentials, redirectUri,) =>
        new GoogleYouTubeOAuthProvider({
            clientId: credentials.appId,
            clientSecret: credentials.appSecret,
            redirectUri,
        },),
};

export function isOAuthProvider(provider: string,): boolean {
    return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, provider,);
}

export function getOAuthProvider(
    provider: string,
    credentials: OAuthCredentials,
    redirectUri: string,
): OAuthProvider {
    const factory = OAUTH_PROVIDERS[provider];
    if (!factory) {
        throw new ValidationError(`OAuth provider "${provider}" is not supported`,);
    }
    return factory(credentials, redirectUri,);
}
