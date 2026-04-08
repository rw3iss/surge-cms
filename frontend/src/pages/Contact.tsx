import { Component, createSignal, Show, } from 'solid-js';
import SeoHead from '../components/SeoHead';
import { submitContactMessage, } from '../services/api';
import './Contact.scss';

const ContactPage: Component = () => {
    const [name, setName,] = createSignal('',);
    const [email, setEmail,] = createSignal('',);
    const [subject, setSubject,] = createSignal('',);
    const [message, setMessage,] = createSignal('',);
    const [status, setStatus,] = createSignal<'idle' | 'loading' | 'success' | 'error'>('idle',);
    const [errorMsg, setErrorMsg,] = createSignal('',);

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setStatus('loading',);
        setErrorMsg('',);

        try {
            const response = await submitContactMessage({
                name: name(),
                email: email(),
                subject: subject(),
                message: message(),
            },);

            if (response.success) {
                setStatus('success',);
                setName('',);
                setEmail('',);
                setSubject('',);
                setMessage('',);
            } else {
                setErrorMsg(response.error?.message || 'Failed to send message. Please try again.',);
                setStatus('error',);
            }
        } catch {
            setErrorMsg('Something went wrong. Please check your connection and try again.',);
            setStatus('error',);
        }
    };

    const resetForm = () => {
        setStatus('idle',);
        setErrorMsg('',);
    };

    return (
        <div class="contact page-wrapper">
            <SeoHead
                title="Contact"
                description="Get in touch with Surge Media. Send us a message, question, or story tip."
                canonical={`${window.location.origin}/contact`}
                type="website"
                aeoSummary="Contact page for Surge Media — send a message or story tip to our team."
                aeoEntityType="ContactPage"
            />

            <div class="contact__container">
                <div class="page-header">
                    <h1>Get in Touch</h1>
                    <p>We'd love to hear from you</p>
                </div>

                <div class="contact__card">
                    <Show when={status() === 'success'}>
                        <div class="contact__success">
                            <svg
                                class="contact__success-icon"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            <h2 class="contact__success-title">Message Sent</h2>
                            <p class="contact__success-text">
                                Thank you for reaching out. We'll get back to you as soon as possible.
                            </p>
                            <button type="button" class="contact__success-btn" onClick={resetForm}>
                                Send Another Message
                            </button>
                        </div>
                    </Show>

                    <Show when={status() !== 'success'}>
                        <form class="contact__form" onSubmit={handleSubmit}>
                            <Show when={status() === 'error'}>
                                <div class="contact__error">
                                    <svg
                                        class="contact__error-icon"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                    >
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="15" y1="9" x2="9" y2="15" />
                                        <line x1="9" y1="9" x2="15" y2="15" />
                                    </svg>
                                    <span>{errorMsg()}</span>
                                </div>
                            </Show>

                            <div class="contact__row">
                                <div class="contact__field">
                                    <label for="contact-name" class="contact__label">Name</label>
                                    <input
                                        type="text"
                                        id="contact-name"
                                        class="contact__input"
                                        value={name()}
                                        onInput={(e,) => setName(e.currentTarget.value,)}
                                        required
                                        disabled={status() === 'loading'}
                                        placeholder="Your name"
                                    />
                                </div>

                                <div class="contact__field">
                                    <label for="contact-email" class="contact__label">Email</label>
                                    <input
                                        type="email"
                                        id="contact-email"
                                        class="contact__input"
                                        value={email()}
                                        onInput={(e,) => setEmail(e.currentTarget.value,)}
                                        required
                                        disabled={status() === 'loading'}
                                        placeholder="you@example.com"
                                    />
                                </div>
                            </div>

                            <div class="contact__field">
                                <label for="contact-subject" class="contact__label">Subject</label>
                                <input
                                    type="text"
                                    id="contact-subject"
                                    class="contact__input"
                                    value={subject()}
                                    onInput={(e,) => setSubject(e.currentTarget.value,)}
                                    disabled={status() === 'loading'}
                                    placeholder="What is this about?"
                                />
                            </div>

                            <div class="contact__field">
                                <label for="contact-message" class="contact__label">Message</label>
                                <textarea
                                    id="contact-message"
                                    class="contact__textarea"
                                    value={message()}
                                    onInput={(e,) => setMessage(e.currentTarget.value,)}
                                    required
                                    disabled={status() === 'loading'}
                                    placeholder="Tell us what's on your mind..."
                                />
                            </div>

                            <button
                                type="submit"
                                class="contact__btn"
                                disabled={status() === 'loading'}
                            >
                                <Show when={status() === 'loading'}>
                                    <div class="contact__spinner" />
                                </Show>
                                {status() === 'loading' ? 'Sending...' : 'Send Message'}
                            </button>
                        </form>
                    </Show>
                </div>
            </div>
        </div>
    );
};

export default ContactPage;
