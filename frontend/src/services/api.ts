import type { ApiResponse, } from '@surge/shared';

const API_BASE = '/api/v1';

function getCsrfToken(): string {
    const match = document.cookie.match(/csrf-token=([^;]+)/,);
    return match ? match[1] : '';
}

interface RequestOptions extends RequestInit {
    timeout?: number;
}

class ApiService {
    private baseUrl: string;
    private defaultTimeout: number;

    constructor(baseUrl: string = API_BASE, defaultTimeout: number = 30000,) {
        this.baseUrl = baseUrl;
        this.defaultTimeout = defaultTimeout;
    }

    private async request<T,>(
        endpoint: string,
        options: RequestOptions = {},
    ): Promise<ApiResponse<T>> {
        const { timeout = this.defaultTimeout, ...fetchOptions } = options;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout,);

        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken(),
                    ...fetchOptions.headers,
                },
                credentials: 'include',
            },);

            clearTimeout(timeoutId,);

            const data = await response.json();

            if (response.status === 401 && !endpoint.startsWith('/auth/',)) {
                window.location.href = '/login';
                return { success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired', }, };
            }

            if (!response.ok) {
                return {
                    success: false,
                    ...data,
                    error: data.error || {
                        code: 'UNKNOWN_ERROR',
                        message: 'An unknown error occurred',
                    },
                };
            }

            return data as ApiResponse<T>;
        } catch (error) {
            clearTimeout(timeoutId,);

            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    return {
                        success: false,
                        error: {
                            code: 'TIMEOUT',
                            message: 'Request timed out',
                        },
                    };
                }

                return {
                    success: false,
                    error: {
                        code: 'NETWORK_ERROR',
                        message: error.message || 'Network error occurred',
                    },
                };
            }

            return {
                success: false,
                error: {
                    code: 'UNKNOWN_ERROR',
                    message: 'An unknown error occurred',
                },
            };
        }
    }

    async get<T,>(endpoint: string, options?: RequestOptions,): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'GET', },);
    }

    async post<T,>(
        endpoint: string,
        body?: unknown,
        options?: RequestOptions,
    ): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, {
            ...options,
            method: 'POST',
            body: body ? JSON.stringify(body,) : undefined,
        },);
    }

    async put<T,>(
        endpoint: string,
        body?: unknown,
        options?: RequestOptions,
    ): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, {
            ...options,
            method: 'PUT',
            body: body ? JSON.stringify(body,) : undefined,
        },);
    }

    async patch<T,>(
        endpoint: string,
        body?: unknown,
        options?: RequestOptions,
    ): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, {
            ...options,
            method: 'PATCH',
            body: body ? JSON.stringify(body,) : undefined,
        },);
    }

    async delete<T,>(endpoint: string, options?: RequestOptions,): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { ...options, method: 'DELETE', },);
    }

    async upload<T,>(
        endpoint: string,
        file: File,
        fieldName: string = 'file',
        additionalData?: Record<string, string>,
    ): Promise<ApiResponse<T>> {
        const formData = new FormData();
        formData.append(fieldName, file,);

        if (additionalData) {
            Object.entries(additionalData,).forEach(([key, value,],) => {
                formData.append(key, value,);
            },);
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
            headers: {
                'X-CSRF-Token': getCsrfToken(),
            },
        },);

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.error || {
                    code: 'UPLOAD_ERROR',
                    message: 'Upload failed',
                },
            };
        }

        return data as ApiResponse<T>;
    }
}

export const api = new ApiService();

// Utility functions for common API calls
export const fetchPage = (slug: string, preview?: string,) => {
    const params = preview ? `?preview=${encodeURIComponent(preview,)}` : '';
    return api.get(`/pages/slug/${slug}${params}`,);
};

export const fetchPost = (slug: string, preview?: string,) =>
    api.get(`/posts/slug/${slug}${preview ? `?preview=${preview}` : ''}`,);

export const fetchPosts = (params?: { page?: number; limit?: number; tag?: string; category?: string; },) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page,),);
    if (params?.limit) searchParams.set('limit', String(params.limit,),);
    if (params?.tag) searchParams.set('tag', params.tag,);
    if (params?.category) searchParams.set('category', params.category,);
    return api.get(`/posts/public?${searchParams.toString()}`,);
};

export const fetchNavigation = () => api.get('/pages/navigation',);

export const fetchSettings = () => api.get('/settings/public',);

export const fetchCampaigns = (includePast = false,) => api.get(`/campaigns/public?includePast=${includePast}`,);

export const fetchCampaign = (slug: string,) => api.get(`/campaigns/slug/${slug}`,);

export const fetchForm = (slug: string,) => api.get(`/forms/slug/${slug}`,);

export const submitForm = (slug: string, answers: unknown[],) => api.post(`/forms/slug/${slug}/submit`, { answers, },);

export const fetchFormResults = (slug: string,) => api.get(`/forms/slug/${slug}/results`,);

export const submitContactMessage = (data: {
    name: string;
    email: string;
    subject?: string;
    message: string;
},) => api.post('/messages', data,);

export const fetchSocialPosts = (platform?: string, limit = 10,) => {
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform,);
    params.set('limit', String(limit,),);
    return api.get(`/social/posts?${params.toString()}`,);
};

export const fetchHomepageSocialPosts = () => api.get('/social/homepage',);
export const fetchLiveSocialFeed = (limit = 10,) => api.get(`/social/feed?limit=${limit}`,);
export const fetchLivePlatformFeed = (platform: string, limit = 20,) =>
    api.get(`/social/feed/${platform}?limit=${limit}`,);

export const fetchHeroSettings = () => api.get('/settings/homepage-hero',);

export const saveHeroSettings = (data: any,) => api.put('/settings/homepage-hero', data,);

export const search = (query: string, type?: string,) => {
    const params = new URLSearchParams();
    params.set('q', query,);
    if (type) params.set('type', type,);
    return api.get(`/search?${params.toString()}`,);
};

export const fetchSiteHeader = () => api.get('/settings/site-header',);
export const saveSiteHeader = (data: any,) => api.put('/settings/site-header', data,);
export const fetchSiteBranding = () => api.get('/settings/site-branding',);
export const saveSiteBranding = (data: any,) => api.put('/settings/site-branding', data,);

export const fetchCrons = () => api.get('/dev/crons',);

export const fetchAppearance = () => api.get('/settings/appearance',);
export const saveAppearance = (data: any,) => api.put('/settings/appearance', data,);

export const fetchBlockStyles = () => api.get('/block-styles',);
export const createBlockStyle = (data: any,) => api.post('/block-styles', data,);
export const updateBlockStyle = (id: string, data: any,) => api.put(`/block-styles/${id}`, data,);
export const deleteBlockStyle = (id: string,) => api.delete(`/block-styles/${id}`,);
