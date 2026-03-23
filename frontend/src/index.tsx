/* @refresh reload */
import { render, } from 'solid-js/web';
import App from './App';

const root = document.getElementById('root',);

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
    throw new Error(
        'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
    );
}

// Remove the app shell loading indicator
const appShellLoading = root?.querySelector('.app-shell-loading',);
if (appShellLoading) {
    appShellLoading.remove();
}

render(() => <App />, root!,);

// Register service worker for PWA (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js',)
            .then((registration,) => {
                console.log('SW registered:', registration,);
            },)
            .catch((error,) => {
                console.log('SW registration failed:', error,);
            },);
    },);
}
