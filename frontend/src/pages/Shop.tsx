import { Component, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import SeoHead from '../components/SeoHead';
import { fetchSettings, } from '../services/api';
import './Shop.scss';

declare global {
    interface Window {
        ShopifyBuy: any;
    }
}

const ShopPage: Component = () => {
    let shopContainer: HTMLDivElement | undefined;
    const [loading, setLoading,] = createSignal(true,);
    const [error, setError,] = createSignal('',);
    let scriptEl: HTMLScriptElement | null = null;

    onMount(async () => {
        try {
            // Fetch Shopify config from settings
            const response = await fetchSettings();
            if (!response.success) {
                setError('Failed to load shop configuration.',);
                setLoading(false,);
                return;
            }

            const data = response.data as any;
            const shopifyDomain = data?.shopifyDomain;
            const shopifyToken = data?.shopifyStorefrontToken;

            if (!shopifyDomain || !shopifyToken) {
                setError('Shop is not configured yet. Please check back later.',);
                setLoading(false,);
                return;
            }

            // Check if SDK is already loaded
            if (window.ShopifyBuy) {
                initializeShopify(shopifyDomain, shopifyToken,);
                return;
            }

            // Load Shopify Buy Button SDK
            scriptEl = document.createElement('script',);
            scriptEl.src = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js';
            scriptEl.async = true;
            scriptEl.onload = () => {
                initializeShopify(shopifyDomain, shopifyToken,);
            };
            scriptEl.onerror = () => {
                setError('Failed to load shop. Please try again later.',);
                setLoading(false,);
            };
            document.head.appendChild(scriptEl,);
        } catch (e) {
            setError('Failed to load shop configuration.',);
            setLoading(false,);
        }
    },);

    onCleanup(() => {
        if (scriptEl && scriptEl.parentNode) {
            scriptEl.parentNode.removeChild(scriptEl,);
        }
    },);

    function initializeShopify(domain: string, token: string,) {
        const client = window.ShopifyBuy.buildClient({
            domain,
            storefrontAccessToken: token,
        },);

        window.ShopifyBuy.UI.onReady(client,).then((ui: any,) => {
            ui.createComponent('collection', {
                id: 'all',
                node: shopContainer,
                options: {
                    product: {
                        styles: {
                            product: {
                                '@media (min-width: 601px)': {
                                    'max-width': 'calc(33.33% - 30px)',
                                    'margin-left': '15px',
                                    'margin-right': '15px',
                                },
                            },
                            title: {
                                'font-family': 'inherit',
                                'font-weight': '600',
                                'color': '#1a1a1a',
                            },
                            price: {
                                'font-family': 'inherit',
                                'color': '#6b7280',
                            },
                            button: {
                                'background-color': '#e63946',
                                'border-radius': '8px',
                                'font-family': 'inherit',
                                'font-weight': '600',
                                ':hover': {
                                    'background-color': '#c5303c',
                                },
                            },
                        },
                        buttonDestination: 'checkout',
                        contents: {
                            img: true,
                            title: true,
                            price: true,
                            button: true,
                            description: false,
                        },
                        text: {
                            button: 'Buy Now',
                        },
                    },
                    cart: {
                        styles: {
                            button: {
                                'background-color': '#e63946',
                                'border-radius': '8px',
                                'font-family': 'inherit',
                                ':hover': {
                                    'background-color': '#c5303c',
                                },
                            },
                        },
                    },
                },
            },);
            setLoading(false,);
        },).catch(() => {
            setError('Failed to load products. Please try again later.',);
            setLoading(false,);
        },);
    }

    return (
        <div class="shop-page page-wrapper">
            <SeoHead
                title="Shop"
                description="Support independent journalism with official Surge Media merchandise."
                canonical={`${window.location.origin}/shop`}
                type="website"
                aeoSummary="Shop official Surge Media merchandise to support independent journalism."
            />

            <header class="page-header">
                <h1>Shop</h1>
                <p>Support Surge Media with our merchandise</p>
            </header>

            <Show when={loading()}>
                <div class="shop-page__loading">
                    <div class="shop-page__spinner" />
                    <p>Loading products...</p>
                </div>
            </Show>

            <Show when={error()}>
                <div class="shop-page__error">
                    <p>{error()}</p>
                </div>
            </Show>

            <div ref={shopContainer} class="shop-page__products" />
        </div>
    );
};

export default ShopPage;
