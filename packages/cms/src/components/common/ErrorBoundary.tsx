import { ErrorBoundary as SolidErrorBoundary, } from 'solid-js';

export function AppErrorBoundary(props: { children: any; },) {
    return (
        <SolidErrorBoundary
            fallback={(err, reset,) => (
                <div class="error-boundary">
                    <h2>Something went wrong</h2>
                    <p>{err.message || 'An unexpected error occurred'}</p>
                    <button onClick={reset}>Try Again</button>
                </div>
            )}
        >
            {props.children}
        </SolidErrorBoundary>
    );
}
