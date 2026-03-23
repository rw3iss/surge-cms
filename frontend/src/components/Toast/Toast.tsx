import { createContext, createSignal, For, JSX, useContext, } from 'solid-js';
import './Toast.scss';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type?: ToastType,) => void;
    success: (message: string,) => void;
    error: (message: string,) => void;
    info: (message: string,) => void;
    warning: (message: string,) => void;
}

const ToastContext = createContext<ToastContextType>();

export function ToastProvider(props: { children: JSX.Element; },) {
    const [toasts, setToasts,] = createSignal<Toast[]>([],);
    let nextId = 0;

    const addToast = (message: string, type: ToastType = 'info',) => {
        const id = nextId++;
        setToasts(prev => [...prev, { id, message, type, },]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000,);
    };

    const context: ToastContextType = {
        addToast,
        success: (msg,) => addToast(msg, 'success',),
        error: (msg,) => addToast(msg, 'error',),
        info: (msg,) => addToast(msg, 'info',),
        warning: (msg,) => addToast(msg, 'warning',),
    };

    return (
        <ToastContext.Provider value={context}>
            {props.children}
            <div class="toast-container">
                <For each={toasts()}>
                    {(toast,) => (
                        <div class={`toast toast--${toast.type}`}>
                            <span class="toast__message">{toast.message}</span>
                            <button
                                class="toast__close"
                                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                            >
                                &times;
                            </button>
                        </div>
                    )}
                </For>
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextType {
    const context = useContext(ToastContext,);
    if (!context) throw new Error('useToast must be used within ToastProvider',);
    return context;
}
