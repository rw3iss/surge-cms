import { InstagramOAuthProvider, } from './instagram';
import type { OAuthProvider, } from './types';

export type { OAuthProvider, OAuthTokenResult, OAuthUserInfo, } from './types';

interface OAuthCredentials {
    appId: string;
    appSecret: string;
}

const OAUTH_PROVIDERS = new Set(['instagram',]);

export function isOAuthProvider(provider: string,): boolean {
    return OAUTH_PROVIDERS.has(provider,);
}

export function getOAuthProvider(
    provider: string,
    credentials: OAuthCredentials,
    redirectUri: string,
): OAuthProvider {
    switch (provider) {
        case 'instagram':
            return new InstagramOAuthProvider({
                appId: credentials.appId,
                appSecret: credentials.appSecret,
                redirectUri,
            },);
        default:
            throw new Error(`OAuth provider "${provider}" is not supported`,);
    }
}
