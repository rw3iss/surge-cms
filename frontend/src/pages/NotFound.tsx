import { Component } from 'solid-js';
import { A } from '@solidjs/router';
import { Title } from '@solidjs/meta';
import './NotFound.scss';

const NotFoundPage: Component = () => (
  <div class="not-found">
    <Title>Page Not Found - Surge Media</Title>
    <A href="/" class="not-found__logo-link">
      <img src="/images/surge_logo.svg" alt="Surge Media" class="not-found__logo" />
    </A>
    <h1 class="not-found__code">404</h1>
    <p class="not-found__message">Page Not Found</p>
    <p class="not-found__detail">The page you're looking for doesn't exist or has been moved.</p>
    <A href="/" class="not-found__btn">Go Home</A>
  </div>
);

export default NotFoundPage;
