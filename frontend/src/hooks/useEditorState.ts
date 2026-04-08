import type { ApiResponse, } from '@surge/shared';
import { createSignal, } from 'solid-js';

/**
 * Shared editor state hook for admin edit pages.
 * Provides consistent error/success/saving state management.
 */
export function useEditorState() {
    const [error, setError,] = createSignal('',);
    const [success, setSuccess,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);

    const clearMessages = () => {
        setError('',);
        setSuccess('',);
    };

    /** Start a save operation — clears messages and sets saving=true */
    const beginSave = () => {
        clearMessages();
        setSaving(true,);
    };

    /** Complete a save operation — sets saving=false */
    const endSave = () => {
        setSaving(false,);
    };

    /** Set error from a string or an ApiResponse */
    const showError = (
        errOrResponse: string | ApiResponse<unknown> | Error | unknown,
        fallback = 'An error occurred',
    ) => {
        if (typeof errOrResponse === 'string') {
            setError(errOrResponse,);
            return;
        }
        if (errOrResponse instanceof Error) {
            setError(errOrResponse.message || fallback,);
            return;
        }
        const response = errOrResponse as ApiResponse<unknown>;
        setError(response?.error?.message || fallback,);
    };

    const showSuccess = (message: string,) => {
        setSuccess(message,);
    };

    return {
        error,
        success,
        saving,
        setError,
        setSuccess,
        setSaving,
        clearMessages,
        beginSave,
        endSave,
        showError,
        showSuccess,
    };
}

/**
 * Extract an error message from a failed API response.
 * Returns the provided fallback if no message is found.
 */
export function getErrorMessage(
    response: ApiResponse<unknown> | unknown,
    fallback = 'An error occurred',
): string {
    const r = response as ApiResponse<unknown>;
    if (!r) return fallback;
    if (r.error?.message) return r.error.message;
    return fallback;
}
