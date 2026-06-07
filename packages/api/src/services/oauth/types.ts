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
