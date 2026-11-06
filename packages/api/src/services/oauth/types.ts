export interface OAuthTokenResult {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType: string;
    rawData: Record<string, unknown>;
}

export interface OAuthUserInfo {
    accountId: string;
    displayName: string;
    avatarUrl?: string;
    rawData?: Record<string, unknown>;
}

export interface OAuthProvider {
    /** Build the authorization URL the admin is redirected to. */
    getAuthorizationUrl(state: string,): string;

    /** Exchange an authorization code for tokens. */
    exchangeCode(code: string,): Promise<OAuthTokenResult>;

    /** Fetch the connected account info using the access token. */
    getUserInfo(accessToken: string,): Promise<OAuthUserInfo>;

    /** Refresh the access token. Returns null if refresh is not supported. */
    refreshToken(currentToken: string, credentials: Record<string, unknown>,): Promise<OAuthTokenResult | null>;
}

/**
 * Optional hooks for providers that do not fit the default "one OAuth per
 * connection row, tokens under accessToken/refreshToken" shape (connections.ts
 * reads them; every member is optional, so existing providers are unchanged).
 */
export interface OAuthProviderOptions {
    /** The social_connections row it belongs to (default: the provider key). A
     *  second sign-in on one connection — e.g. TikTok's Business API — uses its
     *  own key ('tiktok_business') but stores into the 'tiktok' row. */
    connection?: string;
    /** Which saved credentials are this provider's app id/secret (default appId/appSecret). */
    appCredentials?(credentials: Record<string, unknown>,): { appId: string; appSecret: string; } | null;
    /** The credentials patch to store for a token (default accessToken/refreshToken/tokenExpiresAt). */
    tokenCredentials?(token: OAuthTokenResult,): Record<string, unknown>;
    /** A secondary sign-in: keeps the row's display name / account id when they are already set. */
    secondary?: boolean;
    /** Credential keys removed by "disconnect sign-in". */
    credentialKeys?: string[];
}
